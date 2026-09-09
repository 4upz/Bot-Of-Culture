require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  parseQuery,
  CursorCodec,
  eligiblePipeline,
  serializeReview,
} = require('../src/web/query')
test('query treats search as bounded literal and rejects invalid inputs', () => {
  assert.equal(parseQuery({ q: '  Ａ  B ' }).q, 'a b')
  assert.throws(() => parseQuery({ type: 'bad' }))
  assert.throws(() => parseQuery({ limit: '1000' }))
})
test('signed cursors bind scope, generation and query', () => {
  const now = Date.now()
  const c = new CursorCodec('test')
  const token = c.encode({
    scope: 'u:1',
    generation: 'a',
    q: '',
    type: 'all',
    asOf: now,
    last: { id: 'x' },
  })
  assert.equal(
    c.decode(token, { scope: 'u:1', generation: 'a', q: '', type: 'all' }).asOf,
    now,
  )
  assert.throws(() =>
    c.decode(token, { scope: 'u:2', generation: 'a', q: '', type: 'all' }),
  )
  assert.throws(() =>
    c.decode(token, { scope: 'u:1', generation: 'b', q: '', type: 'all' }),
  )
  assert.throws(() => c.decode(token + 'x', {}))
})
test('eligibility precedes grouping and excludes private or invalid preference states', () => {
  const p = eligiblePipeline('movie', { members: ['1'], asOf: new Date(0) })
  assert.equal(p[0].$match.isPrivate, false)
  assert.deepEqual(p[0].$match.userId, { $in: ['1'] })
  assert.ok(JSON.stringify(p).includes('ReviewPreference'))
  assert.ok(JSON.stringify(p).includes('$eq'))
})
test('serialization allowlists origin and suppresses unavailable copied text', () => {
  const r = serializeReview(
    {
      _id: { $oid: 'a' },
      type: 'movie',
      mediaId: '1',
      userId: '2',
      username: 'A',
      score: 4,
      comment: '**hi**',
      _createdAt: { $date: '2020-01-01T00:00:00Z' },
      originGuildId: 'other',
      sharedFromUserId: 'secret',
      sharedFromUsername: 'Hidden',
      sharedFromComment: 'private',
      isPrivate: false,
    },
    'here',
  )
  assert.equal(r.reviewedInAnotherServer, true)
  assert.equal(r.comment, '**hi**')
  assert.equal(r.sharedFromUsername, undefined)
  assert.equal(r.originGuildId, undefined)
  assert.equal(r.sharedFromUserId, undefined)
})
const { MembershipService } = require('../src/web/membership')
test('membership fails closed until complete snapshot; leave applies immediately; stale fails', async () => {
  let now = 0
  const members = new Map([
    ['1', {}],
    ['2', {}],
  ])
  const guild = {
    name: 'Server',
    memberCount: 2,
    members: { fetch: async () => members },
  }
  const bot = {
    isReady: () => true,
    guilds: { cache: new Map([['g', guild]]) },
  }
  const service = new MembershipService(bot, () => now)
  assert.throws(() => service.get('g'))
  await service.sync('g')
  assert.deepEqual(service.get('g').members, ['1', '2'])
  service.change('g', '2', false)
  assert.deepEqual(service.get('g').members, ['1'])
  now = 300001
  assert.throws(() => service.get('g'))
})

test('disconnect during a full fetch cannot publish the stale snapshot', async () => {
  let finish
  const bot = {
    isReady: () => true,
    guilds: {
      cache: new Map([
        [
          '1',
          {
            name: 'Guild',
            memberCount: 1,
            members: {
              fetch: () =>
                new Promise((resolve) => {
                  finish = resolve
                }),
            },
          },
        ],
      ]),
    },
  }
  const service = new MembershipService(bot)
  const sync = service.sync('1')
  service.invalidate()
  finish(new Map([['2', {}]]))
  await sync
  assert.throws(() => service.get('1'))
})

test('co-sign source attribution never serializes a copied excerpt', () => {
  const review = serializeReview({
    _id: '1',
    type: 'movie',
    mediaId: '2',
    userId: '3',
    username: 'A',
    score: 4,
    _createdAt: new Date(),
    sharedFromUserId: '4',
    sharedFromUsername: 'B',
    sharedFromComment: 'copied',
    isQuote: false,
    _sourceAllowed: true,
  })
  assert.equal(review.sharedFromComment, undefined)
  assert.equal(review.sharedFromUsername, 'B')
})
