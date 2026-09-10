require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PublicReviewService } = require('../src/web/service')
const roster = {
  get: () => ({
    members: ['1'],
    generation: 1,
    name: 'Test',
    syncedAt: Date.now(),
  }),
}
function fixture(run) {
  const calls = []
  const model = {
    aggregateRaw: async (args) => {
      calls.push(args)
      return run ? run(args, calls.length) : []
    },
  }
  return {
    calls,
    service: new PublicReviewService(
      {
        db: { reviewPreference: model, mediaTitle: model, movieReview: model },
      },
      roster,
      { value: 0 },
    ),
  }
}
test('expired and cancelled reads do not start database work', async () => {
  for (const context of [
    { deadline: Date.now() - 1 },
    { deadline: Date.now() + 8000, signal: AbortSignal.abort() },
  ]) {
    const { service, calls } = fixture()
    await assert.rejects(
      service.read('guild', '10', {}, undefined, undefined, context),
      (e) => e.status === 503,
    )
    assert.equal(calls.length, 0)
  }
})
test('remaining deadline bounds Mongo execution and cancellation waits for active query', async () => {
  let release
  const controller = new AbortController()
  const { service, calls } = fixture(
    () =>
      new Promise((r) => {
        release = r
      }),
  )
  let settled = false
  const pending = service
    .read('guild', '10', {}, undefined, undefined, {
      deadline: Date.now() + 900,
      signal: controller.signal,
    })
    .finally(() => {
      settled = true
    })
  await new Promise((r) => setImmediate(r))
  assert.equal(calls.length, 1)
  assert.ok(calls[0].options.maxTimeMS > 0 && calls[0].options.maxTimeMS <= 900)
  controller.abort()
  await new Promise((r) => setImmediate(r))
  assert.equal(settled, false)
  release([])
  await assert.rejects(pending, (e) => e.status === 503)
  assert.equal(calls.length, 1)
})

test('batched eligibility filters each collection before lookups and omits source title joins', () => {
  const { unionPipeline } = require('../src/web/query')
  const keys = [
    { type: 'movie', mediaId: 'm', userId: '1' },
    { type: 'game', mediaId: 'g', userId: '2' },
  ]
  const base = unionPipeline('all', {
    asOf: new Date(),
    members: ['1', '2'],
    keys,
    omitMedia: true,
  })
  const branches = [
    base.pipeline,
    ...base.pipeline
      .filter((s) => s.$unionWith)
      .map((s) => s.$unionWith.pipeline),
  ]
  const types = ['movie', 'series', 'game', 'music']
  for (const [index, pipeline] of branches.entries()) {
    const type = types[index],
      selected = keys.filter((key) => key.type === type)
    const match = pipeline[0].$match
    assert.equal(match.isPrivate, false)
    assert.deepEqual(match.userId, { $in: ['1', '2'] })
    if (selected.length)
      assert.deepEqual(
        match.$or,
        selected.map((key) => ({
          [type + 'Id']: key.mediaId,
          userId: key.userId,
        })),
      )
    else assert.deepEqual(match[type + 'Id'], { $in: [] })
    assert.ok(
      pipeline.some((stage) => stage.$lookup?.from === 'ReviewPreference'),
    )
    assert.ok(!pipeline.some((stage) => stage.$lookup?.from === 'MediaTitle'))
  }
})

test('public responses include cached Discord avatars and never fetch missing users', async () => {
  const row = {
    _id: 'a',
    type: 'movie',
    mediaId: '42',
    userId: '1',
    username: 'Reviewer',
    score: 4,
    _createdAt: new Date(),
    media: {
      title: 'Film',
      imageUrl: 'https://image.tmdb.org/t/p/w500/art.jpg',
    },
  }
  const model = {
    aggregateRaw: async ({ pipeline }) =>
      pipeline.some((s) => s.$sort?._createdAt) ? [row] : [],
  }
  const { Client, GatewayIntentBits, User } = require('discord.js')
  const bot = new Client({ intents: [GatewayIntentBits.Guilds] })
  bot.db = { reviewPreference: model, movieReview: model }
  bot.users.fetch = () => {
    throw new Error('Public reads must not fetch Discord users')
  }
  bot.users.cache.set(
    '1',
    new User(bot, {
      id: '1',
      username: 'Reviewer',
      discriminator: '0',
      avatar: 'abc',
    }),
  )
  const service = new PublicReviewService(bot, roster, { value: 0 })
  const result = await service.read('profile', '1', {})
  assert.equal(
    result.items[0].avatarUrl,
    'https://cdn.discordapp.com/avatars/1/abc.webp?size=128',
  )
  assert.equal(result.profile.avatarUrl, result.items[0].avatarUrl)
  assert.equal(
    result.items[0].media.imageUrl,
    'https://image.tmdb.org/t/p/w500/art.jpg',
  )
  bot.users.cache.clear()
  assert.equal(
    (await service.read('profile', '1', {})).items[0].avatarUrl,
    null,
  )
  bot.destroy()
})
