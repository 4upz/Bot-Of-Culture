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
