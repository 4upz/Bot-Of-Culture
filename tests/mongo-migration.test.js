'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { MongoClient, ObjectId, BSON } = require('mongodb')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { checksum, COLLECTIONS } = require('../scripts/review-web/migration-core')
const exec = promisify(execFile)
const uri = process.env.BOC_MONGO_TEST_URL
// The suite may only touch the dedicated local replica set and its disposable test database.
if (uri && !/^mongodb:\/\/127\.0\.0\.1:27028\/(?:boc_review_web_test[a-z0-9_]*)?(?:\?.*)?$/.test(uri)) throw new Error('BOC_MONGO_TEST_URL must target the dedicated localhost:27028 test instance')
const databaseName = `boc_review_web_test_migration_${process.pid}`
const fixture = (id, extra = {}) => ({ _id: new ObjectId(id.toString(16).padStart(24, '0')), userId: '123456789012345678', username: 'Alice', guildId: 'production', _createdAt: new Date('2020-01-01'), score: new BSON.Int32(3), comment: 'full original', futureField: { binary: new BSON.Binary(Buffer.from([0, 255, 128])), integer: BSON.Long.fromString('9223372036854775807'), safeLong: BSON.Long.fromNumber(42), integralDouble: new BSON.Double(4.0), decimal: BSON.Decimal128.fromString('123.4500') }, ...extra })
test('replica-set migration archives, atomic preconditions, interruption resume, verification and rollback', { skip: !uri }, async t => {
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(databaseName)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'boc-migration-test-'))
  t.after(async () => { await db.dropDatabase(); await client.close(); await fs.rm(dir, { recursive: true, force: true }) })
  let manifestPath = path.join(dir, 'manifest.json')
  const cli = (mode, extra = []) => exec(process.execPath, ['scripts/review-web/migrate.js', mode, '--database', databaseName, '--manifest', manifestPath, ...extra], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, MIGRATION_DATABASE_URL: uri } })
  const originals = {}
  const rawChecksums = new Map()
  const rawChecksum = async (collection, id) => checksum(BSON.deserialize(await db.collection(collection).findOne({ _id: id }, { raw: true }), { promoteValues: false }))
  let sequence = 1
  for (const [collection, field] of Object.entries(COLLECTIONS)) {
    originals[collection] = [fixture(sequence++, { [field]: '123', isPrivate: true, updatedAt: new Date('2025-01-01') }), fixture(sequence++, { [field]: '123', guildId: 'test', _createdAt: new Date('2021-01-01'), score: 5 }), fixture(sequence++, { [field]: '456', userId: 'another-user', isPrivate: false })]
    await db.collection(collection).insertMany(originals[collection])
    for (const doc of originals[collection]) rawChecksums.set(String(doc._id), await rawChecksum(collection, doc._id))
  }
  await db.collection('ReviewPreference').insertOne({ userId: '123456789012345678', isPublic: false })
  await cli('dryrun', ['--production-guild', 'production', '--test-guilds', 'test', '--legacy-public-confirmed', '--legacy-origin-confirmed'])
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  assert.equal(manifest.plan.groups.filter(g => g.testWinnerOverProduction).length, 4)
  assert.equal(await db.collection('ReviewMigrationArchive').countDocuments(), 0, 'dryrun does not archive')
  assert.equal((await fs.stat(manifestPath)).mode & 0o777, 0o600)
  await assert.rejects(cli('apply'), 'apply requires writer-pause assertion')

  // Deliberately change a duplicate after auditing. Canonical replacement happens first
  // inside the transaction, so this later conflict must roll it back atomically.
  const group = manifest.plan.groups[0]
  const duplicate = group.entries.find(e => e.recordKind === 'DUPLICATE')
  const coll = db.collection(group.sourceCollection)
  await coll.updateOne({ _id: new ObjectId(duplicate.originalReviewId) }, { $set: { comment: 'concurrent edit' } })
  await assert.rejects(cli('apply', ['--writers-paused']))
  const before = group.entries[0]
  assert.equal(checksum(await coll.findOne({ _id: new ObjectId(before.originalReviewId) }, { promoteValues: false })), before.sourceChecksum, 'canonical update rolled back')
  assert.equal(await coll.countDocuments(), 3, 'no duplicate deleted on failed transaction')
  assert.equal(await db.collection('ReviewMigrationArchive').countDocuments(), group.entries.length, 'archive is durable before source transaction')
  await coll.replaceOne({ _id: new ObjectId(duplicate.originalReviewId) }, BSON.EJSON.parse(duplicate.originalDocumentEjson, { relaxed: false }))

  // Corrupted persisted archive must stop deletion on resume, never be overwritten.
  const archive = db.collection('ReviewMigrationArchive')
  await archive.updateOne({ originalReviewId: duplicate.originalReviewId }, { $set: { originalDocumentEjson: '{}' } })
  await assert.rejects(cli('apply', ['--writers-paused']))
  assert.equal(await coll.countDocuments(), 3)
  await archive.updateOne({ originalReviewId: duplicate.originalReviewId }, { $set: { originalDocumentEjson: duplicate.originalDocumentEjson } })
  await cli('apply', ['--writers-paused'])
  await cli('apply', ['--writers-paused'])
  await cli('verify')
  assert.equal(await archive.countDocuments(), 12, 'includes canonical singleton before-images')
  for (const collection of Object.keys(COLLECTIONS)) assert.equal(await db.collection(collection).countDocuments(), 2)
  assert.equal((await coll.findOne({ _id: new ObjectId(group.canonicalReviewId) }, { promoteValues: false })).isPrivate, true)
  const uniqueIndex = await coll.createIndex({ userId: 1, movieId: 1 }, { unique: true })
  await assert.rejects(cli('rollback', ['--writers-paused']), 'global unique index must prevent duplicate restoration')
  assert.equal(await coll.countDocuments(), 2)
  assert.equal(checksum(await coll.findOne({ _id: new ObjectId(group.canonicalReviewId) }, { promoteValues: false })), group.expectedPostChecksum, 'failed rollback is atomic')
  await coll.dropIndex(uniqueIndex)

  // Post-migration edits and newly created reviews/preferences survive rollback.
  const newRecord = fixture(999, { movieId: 'new-media' })
  await db.collection('MovieReview').insertOne(newRecord)
  await coll.updateOne({ _id: new ObjectId(group.canonicalReviewId) }, { $set: { comment: 'post migration edit' } })
  await assert.rejects(cli('rollback', ['--writers-paused']))
  assert.equal((await coll.findOne({ _id: new ObjectId(group.canonicalReviewId) }, { promoteValues: false })).comment, 'post migration edit')
  assert.equal(await coll.countDocuments(), 3, 'conflicting group is not partially restored')
  await coll.replaceOne({ _id: new ObjectId(group.canonicalReviewId) }, BSON.EJSON.parse(group.postDocumentEjson, { relaxed: false }))
  await cli('rollback', ['--writers-paused'])
  await cli('rollback', ['--writers-paused'])
  for (const [collection, docs] of Object.entries(originals)) {
    for (const original of docs) {
      const restored = await db.collection(collection).findOne({ _id: original._id }, { promoteValues: false })
      assert.equal(checksum(restored), checksum(original), 'exact BSON restored')
      assert.equal(await rawChecksum(collection, original._id), rawChecksums.get(String(original._id)), 'raw BSON canonical checksum restored')
      assert.equal(restored.futureField.safeLong._bsontype, 'Long')
      assert.equal(restored.futureField.integralDouble._bsontype, 'Double')
      assert.equal(restored.futureField.decimal._bsontype, 'Decimal128')
      assert.equal(restored.score._bsontype, 'Int32')
    }
  }
  assert.equal(checksum(await db.collection('MovieReview').findOne({ _id: newRecord._id }, { promoteValues: false })), checksum(newRecord))
  assert.equal((await db.collection('ReviewPreference').findOne({ userId: '123456789012345678' })).isPublic, false)
  assert.equal(await archive.countDocuments({ operationState: 'RESTORED' }), 12)
  await db.collection('MovieReview').insertOne(fixture(1000, { movieId: 'invalid', score: 99 }))
  manifestPath = path.join(dir, 'blocked.json')
  await assert.rejects(cli('dryrun', ['--production-guild', 'production', '--test-guilds', 'test', '--legacy-public-confirmed']))
  const blocked = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  assert.equal(blocked.status, 'BLOCKED')
  assert.match(blocked.plan.auditErrors[0].reason, /Invalid score.*0000000000000000000003e8/)
  await assert.rejects(cli('apply', ['--writers-paused']))
  assert.equal(await db.collection('MovieReview').countDocuments(), 5)
  assert.equal(await archive.countDocuments(), 12)
})

test('real MongoDB title backfill distinct IDs, namespaces, resume and retained last-known names', { skip: !uri }, async t => {
  const client = new MongoClient(uri)
  await client.connect()
  const name = `${databaseName}_titles`, db = client.db(name)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'boc-title-test-'))
  t.after(async () => { await db.dropDatabase(); await client.close(); await fs.rm(dir, { recursive: true, force: true }) })
  await db.collection('MovieReview').insertMany([{ movieId: '123' }, { movieId: '123' }, { movieId: '999' }])
  await db.collection('SeriesReview').insertOne({ seriesId: '123' })
  await db.collection('GameReview').insertOne({ gameId: '123' })
  await db.collection('MusicReview').insertOne({ musicId: 'abcdefghijklmnopqrstuv' })
  await db.collection('MediaTitle').insertOne({ type: 'movie', mediaId: '999', title: 'Retained name', normalizedTitle: 'retained name', fetchedAt: new Date('2020-01-01') })
  // Provider transport is deliberately fixture-only; all title persistence is actual MongoDB.
  const hook = path.join(dir, 'provider-fixture.cjs')
  await fs.writeFile(hook, `global.fetch = async (url, init) => { const game = url.includes('igdb'); const series = url.includes('/tv/'); const music = url.includes('spotify'); const id = music ? 'abcdefghijklmnopqrstuv' : 123; const body = game ? [{id,name:'Game without cover'}] : {id, title:' Movie   Name ', name:series?'Series Name':'Album without artwork'}; return {ok:true,json:async()=>body} };`)
  const cli = mode => exec(process.execPath, ['--require', hook, 'scripts/review-web/backfill-titles.js', mode, '--database', name], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, MIGRATION_DATABASE_URL: uri, TMDB_TOKEN: 'fixture', IGDB_CLIENT_ID: 'fixture', IGDB_ACCESS_TOKEN: 'fixture', SPOTIFY_ACCESS_TOKEN: 'fixture' } })
  const dry = JSON.parse((await cli('dryrun')).stdout)
  assert.equal(dry.missing, 4)
  assert.equal(await db.collection('MediaTitle').countDocuments(), 1)
  assert.equal(JSON.parse((await cli('apply')).stdout).written, 4)
  assert.equal(JSON.parse((await cli('apply')).stdout).written, 0)
  assert.equal(await db.collection('MediaTitle').countDocuments(), 5)
  assert.equal((await db.collection('MediaTitle').findOne({ type: 'movie', mediaId: '123' })).normalizedTitle, 'movie name')
  assert.equal((await db.collection('MediaTitle').findOne({ type: 'series', mediaId: '123' })).title, 'Series Name')
  assert.equal((await db.collection('MediaTitle').findOne({ type: 'movie', mediaId: '999' })).title, 'Retained name')
})
