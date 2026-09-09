require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const command = require('../src/commands/reviews/web').default
const { getWebVisibility, publicReviewUrl } = require('../src/reviews/preferences')
const { redactDiscordSource } = require('../src/reviews/writeStore')

function interaction(sub, state, db, guildId = 'server') {
  const replies = []
  let bumps = 0
  return {
    user: { id: 'caller' }, guildId,
    options: { getSubcommand: () => sub, getString: () => state, getUser: () => ({ id: 'someone-else' }) },
    client: { db, webRevision: { bump() { bumps++ } } },
    async deferReply(payload) { assert.equal(payload.ephemeral, true) },
    async editReply(text) { replies.push(text) },
    replies, bumps: () => bumps,
  }
}
test('visibility absent defaults public; read failure and invalid data do not', async () => {
  assert.equal(await getWebVisibility({ reviewPreference: { findUnique: async () => null } }, 'caller'), true)
  await assert.rejects(getWebVisibility({ reviewPreference: { findUnique: async () => ({ isPublic: 'bad' }) } }, 'caller'))
  await assert.rejects(getWebVisibility({ reviewPreference: { findUnique: async () => { throw new Error('db') } } }, 'caller'))
})
test('visibility writes caller only, succeeds after storage and bumps revision', async () => {
  let stored = false
  const i = interaction('visibility', 'hidden', { reviewPreference: { async upsert({ where, create, update }) {
    assert.equal(where.userId, 'caller'); assert.equal(create.userId, 'caller'); assert.equal(update.isPublic, false)
    stored = true
  } } })
  await command.execute(i)
  assert.equal(stored, true)
  assert.match(i.replies[0], /hidden/)
  assert.equal(i.bumps(), 1)
})
test('failed visibility write never acknowledges success or bumps revision', async () => {
  const i = interaction('visibility', 'hidden', { reviewPreference: { async upsert() { throw new Error('db') } } })
  await command.execute(i)
  assert.match(i.replies[0], /temporarily unavailable/)
  assert.equal(i.bumps(), 0)
})
test('missing visibility state inspects without writing', async () => {
  const i = interaction('visibility', null, { reviewPreference: { async findUnique() { return null } } })
  await command.execute(i)
  assert.match(i.replies[0], /public/)
  assert.equal(i.bumps(), 0)
})
test('server link rejects DMs', async () => {
  const i = interaction('server', null, {}, null)
  await command.execute(i)
  assert.match(i.replies[0], /inside a server/)
})
test('URLs use configured base and disabled links degrade gracefully', async () => {
  const oldEnabled = process.env.WEB_ENABLED, oldBase = process.env.PUBLIC_WEB_BASE_URL
  try {
    process.env.WEB_ENABLED = 'true'; process.env.PUBLIC_WEB_BASE_URL = 'https://reviews.example'
    assert.equal(publicReviewUrl('user', '123'), 'https://reviews.example/u/123')
    assert.equal(publicReviewUrl('guild', '456'), 'https://reviews.example/g/456')
    process.env.WEB_ENABLED = 'false'
    assert.equal(publicReviewUrl('user', '123'), null)
    const i = interaction('profile', null, {})
    await command.execute(i)
    assert.match(i.replies[0], /not enabled/)
  } finally {
    if (oldEnabled === undefined) delete process.env.WEB_ENABLED; else process.env.WEB_ENABLED = oldEnabled
    if (oldBase === undefined) delete process.env.PUBLIC_WEB_BASE_URL; else process.env.PUBLIC_WEB_BASE_URL = oldBase
  }
})
test('source deleted or made private elsewhere redacts copied Discord content', async () => {
  const review = { userId: 'quote-author', movieId: '42', score: 4, comment: 'My thoughts', sharedFromUserId: 'source', sharedFromUsername: 'Secret', sharedFromComment: 'Private words' }
  for (const source of [null, { isPrivate: true, originGuildId: 'elsewhere' }]) {
    const output = await redactDiscordSource(review, { findFirst: async () => source }, 'movie', 'here')
    assert.equal(output.comment, 'My thoughts')
    assert.equal(output.sharedFromComment, null)
    assert.equal(output.sharedFromUserId, null)
    assert.equal(output.sharedFromUsername, null)
  }
})
