require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { saveGlobalReview, canDisplayReview, rememberMediaTitle } = require('../src/reviews/writeStore')

function fixture(initial) {
  let row = initial
  const collection = {
    async findFirst() { return row && { ...row } },
    async create({ data }) { row = { id: 'one', createdAt: new Date('2020-01-01'), ...data }; return { ...row } },
    async update({ data }) { row = { ...row, ...data }; return { ...row } },
  }
  return { collection, row: () => row }
}
for (const type of ['movie', 'series', 'game', 'music']) {
  test(`${type}: global edit preserves creation origin/privacy and dates on no-op`, async () => {
    const createdAt = new Date('2020-01-01')
    const f = fixture({ id: 'one', userId: 'a', [`${type}Id`]: '42', score: 4, createdAt, originGuildId: 'old', guildId: 'old', isPrivate: true, updatedAt: null })
    await saveGlobalReview(f.collection, type, { userId: 'a', [`${type}Id`]: '42', score: 4, guildId: 'new', username: 'new' })
    assert.equal(f.row().originGuildId, 'old')
    assert.equal(f.row().guildId, 'old')
    assert.equal(f.row().isPrivate, true)
    assert.equal(f.row().updatedAt, null)
    await saveGlobalReview(f.collection, type, { userId: 'a', [`${type}Id`]: '42', score: 5, guildId: 'new' })
    assert.equal(f.row().createdAt, createdAt)
    assert.ok(f.row().updatedAt instanceof Date)
  })
}
test('new review records origin and public default, no invented edit date', async () => {
  const f = fixture()
  await saveGlobalReview(f.collection, 'movie', { userId: 'a', movieId: '42', score: 3, guildId: 'origin' })
  assert.equal(f.row().originGuildId, 'origin')
  assert.equal(f.row().originSource, 'observed_creation')
  assert.equal(f.row().isPrivate, false)
  assert.equal(f.row().updatedAt, null)
})
test('private source restricts copy and private source never displays across guilds', async () => {
  const f = fixture({ id: 'one', isPrivate: false, score: 4 })
  await saveGlobalReview(f.collection, 'movie', { userId: 'a', movieId: '42', score: 4 }, true)
  assert.equal(f.row().isPrivate, true)
  assert.equal(canDisplayReview({ isPrivate: true, originGuildId: 'a' }, 'b'), false)
  assert.equal(canDisplayReview({ isPrivate: true, originGuildId: 'a' }, 'a'), true)
  assert.equal(canDisplayReview({ isPrivate: true, originGuildId: null, guildId: null }, null), false)
})
test('concurrent first save retries unique conflict as global edit', async () => {
  let reads = 0
  const collection = {
    async findFirst() { return reads++ ? { id: 'existing', score: 3, isPrivate: true, originGuildId: 'winner' } : null },
    async create() { throw Object.assign(new Error('conflict'), { code: 'P2002' }) },
    async update({ data }) { return { id: 'existing', originGuildId: 'winner', isPrivate: true, ...data } },
  }
  const { review } = await saveGlobalReview(collection, 'movie', { userId: 'a', movieId: '42', score: 4, guildId: 'loser' })
  assert.equal(review.originGuildId, 'winner')
  assert.equal(review.isPrivate, true)
  assert.equal(review.score, 4)
})
test('title enrichment failure does not fail review completion', async () => {
  await assert.doesNotReject(rememberMediaTitle({ mediaTitle: { findUnique: async () => null, upsert: async () => { throw new Error('offline') } } }, 'movie', '42', { title: 'A Film' }))
})
test('score-only save preserves existing comment and optional content; clear counts as edit', async () => {
  const f = fixture({ id: 'one', score: 4, comment: 'Original words', hoursPlayed: 20, updatedAt: null })
  await saveGlobalReview(f.collection, 'game', { userId: 'a', gameId: '42', score: 4, comment: undefined })
  assert.equal(f.row().comment, 'Original words')
  assert.equal(f.row().hoursPlayed, 20)
  assert.equal(f.row().updatedAt, null)
  await saveGlobalReview(f.collection, 'game', { userId: 'a', gameId: '42', comment: null })
  assert.equal(f.row().comment, null)
  assert.ok(f.row().updatedAt instanceof Date)
})
test('title upsert namespaces identical provider IDs by media type', async () => {
  const calls = []
  const db = { mediaTitle: { async findUnique() { return null }, async upsert(input) { calls.push(input) } } }
  await rememberMediaTitle(db, 'movie', '42', { title: 'A FILM' })
  await rememberMediaTitle(db, 'series', '42', { title: 'A SHOW' })
  assert.deepEqual(calls.map(c => c.where.type_mediaId), [{ type: 'movie', mediaId: '42' }, { type: 'series', mediaId: '42' }])
  assert.equal(calls[0].create.normalizedTitle, 'a film')
})
test('delete helper removes caller global review from any guild and invalidates cursors', async () => {
  const { deleteReviewForTarget } = require('../src/commands/reviews/buttons/deleteReview')
  let deleted = null, bumps = 0, reply
  const collection = {
    async findFirst({ where }) { assert.deepEqual(where, { movieId: '42', userId: 'caller' }); return { id: 'canonical' } },
    async delete({ where }) { deleted = where.id },
  }
  await deleteReviewForTarget({ user: { id: 'caller' }, guildId: 'different', client: { getCollection: () => collection, webRevision: { bump() { bumps++ } } }, async editReply(value) { reply = value } }, 'movie', '42')
  assert.equal(deleted, 'canonical')
  assert.equal(bumps, 1)
  assert.match(reply.content, /successfully deleted/)
})
test('ordinary composer updates private review globally without broadcasting outside origin', async () => {
  const { saveReview } = require('../src/commands/reviews/utils')
  const f = fixture({ id: 'one', userId: 'caller', movieId: '42', score: 4, isPrivate: true, originGuildId: 'old', createdAt: new Date('2020-01-01') })
  let broadcasts = 0, reply
  const bot = { getCollection: () => f.collection, db: { mediaTitle: { async findUnique() { return null }, async upsert() {} } }, movies: { async getById() { return { title: 'Film' } } } }
  await saveReview({ client: bot, user: { id: 'caller', username: 'Caller' }, guildId: 'different', customId: 'reviewScore_movie_button_42_5', isModalSubmit: () => false, async deferReply() {}, async editReply(value) { reply = value }, channel: { async send() { broadcasts++ } } })
  assert.equal(f.row().score, 5)
  assert.equal(f.row().originGuildId, 'old')
  assert.equal(broadcasts, 0)
  assert.match(reply, /private review was not posted/)
})
test('stale share submission rechecks deleted or cross-guild private source before writing', async () => {
  const { saveSharedReview } = require('../src/commands/reviews/utils/saveSharedReview')
  for (const currentSource of [null, { userId: 'source', isPrivate: true, originGuildId: 'elsewhere' }]) {
    let writes = 0, reply
    const collection = { async findFirst() { return currentSource }, async create() { writes++ }, async update() { writes++ } }
    await saveSharedReview({ user: { id: 'caller' }, guildId: 'here', client: { getCollection: () => collection }, async deferReply() {}, async editReply(value) { reply = value } }, 'movie', '42', { userId: 'source' }, true, 'My thoughts')
    assert.equal(writes, 0)
    assert.match(reply, /no longer available/)
  }
})
test('unchanged title does not change fetchedAt or cursor generations', async () => {
  let updates = 0
  const db = { mediaTitle: { async findUnique() { return { title: 'A Film', normalizedTitle: 'a film' } }, async upsert() { updates++ } } }
  await rememberMediaTitle(db, 'movie', '42', { title: 'A Film' })
  assert.equal(updates, 0)
})
test('title normalization collapses whitespace consistently with search', async () => {
  let normalized
  const db = { mediaTitle: { async findUnique() { return null }, async upsert({ create }) { normalized = create.normalizedTitle } } }
  await rememberMediaTitle(db, 'movie', '42', { title: '  Ａ  FILM\nTitle ' })
  assert.equal(normalized, 'a film title')
})
test('sharing private source restricts existing public review and invalidates public cursors', async () => {
  const { saveSharedReview } = require('../src/commands/reviews/utils/saveSharedReview')
  let row = { id: 'mine', userId: 'caller', movieId: '42', score: 4, isPrivate: false, originGuildId: 'old-origin' }
  let bumps = 0
  const source = { userId: 'source', movieId: '42', username: 'Source', score: 3, isPrivate: true, originGuildId: 'here' }
  const collection = {
    async findFirst({ where }) { return where.userId === 'source' ? source : row },
    async update({ data }) { row = { ...row, ...data }; return row },
  }
  await saveSharedReview({ user: { id: 'caller', username: 'Caller' }, guildId: 'here', client: { getCollection: () => collection, webRevision: { bump() { bumps++ } } }, async deferReply() {}, async editReply() {} }, 'movie', '42', source, true, 'My own words')
  assert.equal(row.isPrivate, true)
  assert.equal(row.originGuildId, 'old-origin')
  assert.equal(bumps, 1)
})
