const test = require('node:test')
const assert = require('node:assert/strict')
const { ObjectId, BSON } = require('mongodb')
const { planCollection, checksum, encode, decode, assertArchive, transition } = require('../scripts/review-web/migration-core')
const { extractTitle, fetchTitle } = require('../scripts/review-web/backfill-titles')
const options = { productionGuildId: 'prod', testGuildIds: ['test'], legacyPublicConfirmed: true, legacyOriginConfirmed: true }
const review = (id, date, extra = {}) => ({ _id: new ObjectId(id.padStart(24, '0')), movieId: '123', userId: '123456789012345678', guildId: 'prod', _createdAt: new Date(date), score: 4, username: 'Alice', ...extra })
const fixture = () => [review('1', '2020-01-01', { updatedAt: new Date('2025-01-01'), isPrivate: true, comment: 'older', futureField: { binary: new BSON.Binary(Buffer.from([0, 255])), value: BSON.Long.fromString('9223372036854775807') } }), review('2', '2021-01-01'), review('3', '2021-01-01', { guildId: 'test', comment: 'winner' })]
test('newest creation wins regardless of edits; ObjectId breaks ties, test winner reported and privacy inherited', () => {
  const [g] = planCollection('MovieReview', fixture(), options)
  assert.equal(g.canonicalReviewId, '000000000000000000000003')
  assert.equal(g.testWinnerOverProduction, true)
  const after = BSON.EJSON.parse(g.postDocumentEjson)
  assert.equal(after.isPrivate, true)
  assert.equal(after.originGuildId, 'test')
  assert.equal(after.updatedAt, undefined)
  assert.equal(g.entries.length, 3)
})
test('canonical EJSON round-trips unknown BSON and remains deterministic across key order', () => {
  const original = fixture()[0]
  assert.equal(checksum(original), checksum(decode(encode(original))))
  assert.equal(checksum(original), checksum(Object.fromEntries(Object.entries(original).reverse())))
  assert.equal(decode(encode(original)).futureField.value.toString(), '9223372036854775807')
})
test('archive corruption blocks; interrupted apply resumes; postwrites block rollback', () => {
  const [g] = planCollection('MovieReview', fixture(), options)
  const canonical = g.entries[0], duplicate = g.entries[1]
  assertArchive(canonical, canonical)
  assert.throws(() => assertArchive({ ...duplicate, originalDocumentEjson: '{}' }, duplicate))
  assert.equal(transition(decode(canonical.originalDocumentEjson), canonical, g), 'replace')
  assert.equal(transition(decode(g.postDocumentEjson), canonical, g), 'skip')
  assert.equal(transition(null, duplicate, g), 'skip')
  assert.equal(transition(null, duplicate, g, true), 'restore')
  assert.equal(transition(decode(g.postDocumentEjson), canonical, g, true), 'restore')
  assert.throws(() => transition({ ...decode(g.postDocumentEjson), comment: 'new edit' }, canonical, g, true), /Rollback conflict/)
  assert.throws(() => transition({ ...decode(duplicate.originalDocumentEjson), comment: 'new edit' }, duplicate, g), /Source changed/)
})
test('malformed score/privacy/date block audit; unknown origin stays unknown', () => {
  for (const extra of [{ score: 6 }, { isPrivate: null }, { _createdAt: null }]) assert.throws(() => planCollection('MovieReview', [review('1', '2020-01-01', extra)], options))
  const [g] = planCollection('MovieReview', [review('1', '2020-01-01', { guildId: undefined })], options)
  assert.equal(BSON.EJSON.parse(g.postDocumentEjson).originGuildId, undefined)
})
test('title-only extraction tolerates missing artwork and rejects mismatched IDs', () => {
  assert.equal(extractTitle('game', '123', [{ id: 123, name: 'Untitled Goose Game' }]), 'Untitled Goose Game')
  assert.equal(extractTitle('series', '123', { id: 123, name: 'Show' }), 'Show')
  assert.equal(extractTitle('music', 'abc', { id: 'abc', name: 'Album' }), 'Album')
  assert.throws(() => extractTitle('movie', '123', { id: 456, title: 'Other' }))
})
test('provider retries are bounded and unsafe provider IDs rejected before fetch', async () => {
  process.env.TMDB_TOKEN = 'fixture'
  let calls = 0
  await assert.rejects(fetchTitle('movie', '123', async () => { calls++; return { status: 503, ok: false } }, async () => {}))
  assert.equal(calls, 3)
  await assert.rejects(fetchTitle('game', '1; delete all', () => { throw new Error('must not fetch') }))
  delete process.env.TMDB_TOKEN
})

test('BSON numeric scores validate without changing archived tags or leaking wrappers into report scores', () => {
  for (const score of [new BSON.Int32(4), new BSON.Double(4), BSON.Long.fromNumber(4), BSON.Decimal128.fromString('4.0')]) {
    const original = review('1', '2020-01-01', { score, unknown: { safeLong: BSON.Long.fromNumber(42), double: new BSON.Double(4), decimal: BSON.Decimal128.fromString('123.4500') } })
    const [group] = planCollection('MovieReview', [original], options)
    assert.equal(group.entries[0].score, 4)
    assert.equal(decode(group.entries[0].originalDocumentEjson).score._bsontype, score._bsontype)
    assert.equal(checksum(decode(group.entries[0].originalDocumentEjson)), checksum(original))
  }
  for (const score of ['4', { valueOf: () => 4 }, true, null, new BSON.Double(4.5)]) {
    assert.throws(() => planCollection('MovieReview', [review('1', '2020-01-01', { score })], options), /Invalid score/)
  }
})

const { validateWinnerOverrides, assertWinnerOverridesApplied } = require('../scripts/review-web/migration-core')
const overrideFor = docs => ({ collection: 'MovieReview', userId: docs[0].userId, mediaId: docs[0].movieId, canonicalReviewId: String(docs[0]._id), expectedSources: docs.map(doc => ({ originalReviewId: String(doc._id), sourceChecksum: checksum(doc) })) })
test('approved exact older winner retains privacy and all beforeimages with BSON rollback', () => {
  const docs = fixture(), override = overrideFor(docs)
  const [g] = planCollection('MovieReview', docs, { ...options, winnerOverrides: [override] })
  assert.equal(g.canonicalReviewId, String(docs[0]._id))
  assert.equal(g.selectionReason.kind, 'APPROVED_WINNER_OVERRIDE')
  assert.equal(g.selectionReason.defaultCanonicalReviewId, String(docs[2]._id))
  assert.equal(g.selectionReason.approvedOverrideChecksum, checksum(override))
  assert.equal(decode(g.postDocumentEjson).isPrivate, true)
  assert.equal(g.entries.find(e => e.recordKind === 'CANONICAL_BEFOREIMAGE').originalReviewId, String(docs[0]._id))
  for (const entry of g.entries) {
    const current = entry.recordKind === 'CANONICAL_BEFOREIMAGE' ? decode(g.postDocumentEjson) : null
    assert.equal(transition(current, entry, g, true), 'restore')
    assert.equal(checksum(decode(entry.originalDocumentEjson)), entry.sourceChecksum)
  }
  assertWinnerOverridesApplied([g], [override])
})
test('winner overrides reject stale, added, unmatched, singleton and invalid choices', () => {
  const docs = fixture(), valid = overrideFor(docs)
  const plan = (records, override = valid) => planCollection('MovieReview', records, {...options, winnerOverrides:[override]})
  assert.throws(()=>plan(docs.map((d,i)=>i ? d : {...d,comment:'changed'})), /source/i)
  assert.throws(()=>plan([...docs,review('4','2022-01-01')]), /source/i)
  assert.throws(()=>plan(docs.slice(1)), /source|winner/i)
  assert.throws(()=>plan(docs,{...valid,mediaId:'unmatched'}), /unmatched/i)
  assert.throws(()=>plan([docs[0]],overrideFor([docs[0]])), /duplicate|singleton/i)
  for(const override of [{...valid,collection:'constructor'},{...valid,canonicalReviewId:'bad'},{...valid,userId:''},{...valid,extra:true},{...valid,expectedSources:[valid.expectedSources[0],valid.expectedSources[0]]},{...valid,expectedSources:valid.expectedSources.map(s=>({...s,sourceChecksum:'bad'}))}]) assert.throws(()=>validateWinnerOverrides([override]))
  assert.throws(()=>validateWinnerOverrides([valid,valid]), /duplicate/i)
  assert.throws(()=>assertWinnerOverridesApplied([], [valid]), /unmatched/i)
})
test('migration CLI rejects unknown, duplicate, missing and non-dryrun override options',()=>{
  const {parseArgs}=require('../scripts/review-web/migrate')
  for(const args of [['dryrun','--prefer-production'],['dryrun','--winner-overrides'],['dryrun','--manifest','a','--manifest','b'],['apply','--winner-overrides','a']]) assert.throws(()=>parseArgs(args))
})

test('metadata backfill extracts optional provider artwork without depending on it for titles', async () => {
  const { extractMetadata, fetchMetadata } = require('../scripts/review-web/backfill-titles')
  assert.deepEqual(extractMetadata('movie', '123', { id: 123, title: 'Film', poster_path: '/poster.jpg' }), { title: 'Film', imageUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg' })
  assert.deepEqual(extractMetadata('series', '123', { id: 123, name: 'Show', poster_path: null }), { title: 'Show', imageUrl: null })
  assert.equal(extractMetadata('game', '123', [{ id: 123, name: 'Game', cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/art.jpg' } }]).imageUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/art.jpg')
  assert.equal(extractMetadata('music', 'abc', { id: 'abc', name: 'Album', images: [{ url: 'https://i.scdn.co/image/album' }] }).imageUrl, 'https://i.scdn.co/image/album')
  assert.equal(extractMetadata('music', 'abc', { id: 'abc', name: 'Album', images: [{ url: 'javascript:alert(1)' }] }).imageUrl, null)
  const oldToken = process.env.IGDB_ACCESS_TOKEN, oldId = process.env.IGDB_CLIENT_ID
  process.env.IGDB_ACCESS_TOKEN = 'fixture'
  process.env.IGDB_CLIENT_ID = 'fixture'
  try {
    const result = await fetchMetadata('game', '123', async (_, options) => {
      assert.match(options.body, /fields name, cover.url;/)
      return { ok: true, json: async () => [{ id: 123, name: 'Game' }] }
    })
    assert.deepEqual(result, { title: 'Game', imageUrl: null })
  } finally {
    if (oldToken === undefined) delete process.env.IGDB_ACCESS_TOKEN; else process.env.IGDB_ACCESS_TOKEN = oldToken
    if (oldId === undefined) delete process.env.IGDB_CLIENT_ID; else process.env.IGDB_CLIENT_ID = oldId
  }
})
