require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PublicArtworkService } = require('../src/web/artwork')
const { parseArtwork, ProviderError } = require('../src/services/artwork')
const flush = () => new Promise((resolve) => setImmediate(resolve))
function fixture(fetchArtwork, initial = null) {
  let row = initial,
    calls = 0,
    writes = 0
  const db = {
    mediaTitle: {
      async findUnique() {
        return row
      },
      async upsert({ create, update }) {
        writes++
        row = row ? { ...row, ...update } : create
        return row
      },
    },
  }
  const service = new PublicArtworkService(db, async (...args) => {
    calls++
    return fetchArtwork(...args)
  })
  const get = (type = 'movie', id = '42') => {
    const url = new URL(service.url(type, id), 'https://example.com')
    return service.get(type, id, url.searchParams.get('ticket'))
  }
  return {
    service,
    db,
    get,
    calls: () => calls,
    writes: () => writes,
    row: () => row,
  }
}
test('artwork lookups deduplicate and persist URLs without changing an existing title', async (t) => {
  let release
  const before = new Date('2020-01-01')
  const f = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
    { title: 'Saved title', normalizedTitle: 'saved title', fetchedAt: before },
  )
  t.after(() => f.service.close())
  const first = f.get(),
    second = f.get()
  await flush()
  assert.equal(f.calls(), 1)
  release({
    title: 'Provider title',
    imageUrl: 'https://image.tmdb.org/t/p/w500/art.jpg',
  })
  assert.equal(await first, 'https://image.tmdb.org/t/p/w500/art.jpg')
  assert.equal(await second, await first)
  assert.equal(await f.get(), await first)
  assert.equal(f.calls(), 1)
  assert.equal(f.writes(), 1)
  assert.equal(f.row().title, 'Saved title')
  assert.equal(f.row().fetchedAt, before)
  const restarted = new PublicArtworkService(f.db, () => {
    throw Error('must use persisted image')
  })
  t.after(() => restarted.close())
  const ticket = new URL(
    restarted.url('movie', '42'),
    'https://example.com',
  ).searchParams.get('ticket')
  assert.equal(await restarted.get('movie', '42', ticket), await first)
})
test('missing artwork and provider failures are cached without fabricating images', async (t) => {
  for (const load of [
    async () => ({ title: 'Film', imageUrl: null }),
    async () => {
      throw Error('offline')
    },
  ]) {
    const f = fixture(load)
    t.after(() => f.service.close())
    assert.equal(await f.get(), null)
    assert.equal(await f.get(), null)
    assert.equal(f.calls(), 1)
  }
})
test('artwork tickets reject tampered, expired and arbitrary provider requests', async (t) => {
  const f = fixture(() => {
    throw Error('must not call')
  })
  t.after(() => f.service.close())
  const ticket = new URL(
    f.service.url('game', '42'),
    'https://example.com',
  ).searchParams.get('ticket')
  for (const [type, id, token] of [
    ['game', '43', ticket],
    ['movie', '42', ticket],
    ['game', '42', ticket + 'bad'],
    ['game', '42', null],
  ])
    await assert.rejects(
      f.service.get(type, id, token),
      (e) => e.status === 403,
    )
  assert.equal(f.service.url('game', '1; drop all'), null)
  const realNow = Date.now
  Date.now = () => realNow() + 3600000
  try {
    await assert.rejects(
      f.service.get('game', '42', ticket),
      (e) => e.status === 403,
    )
  } finally {
    Date.now = realNow
  }
  assert.equal(f.calls(), 0)
})
test('provider throttling spaces lookups and honours rate-limit cooldown across titles', async (t) => {
  const starts = []
  const f = fixture(async () => {
    starts.push(Date.now())
    return { title: 'Film', imageUrl: 'https://image.tmdb.org/t/p/w500/a.jpg' }
  })
  t.after(() => f.service.close())
  await Promise.all([f.get('movie', '41'), f.get('series', '42')])
  assert.equal(starts.length, 2)
  assert.ok(starts[1] - starts[0] >= 450)
  const failed = fixture(async () => {
    throw new ProviderError(429, 120000)
  })
  t.after(() => failed.service.close())
  assert.equal(await failed.get('movie', '41'), null)
  assert.equal(await failed.get('series', '42'), null)
  assert.equal(failed.calls(), 1)
})
test('metadata parsing only needs the provider ID, title and optional image', () => {
  assert.deepEqual(
    parseArtwork('game', '42', [
      {
        id: 42,
        name: 'Game',
        cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/a.jpg' },
      },
    ]),
    {
      title: 'Game',
      imageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/a.jpg',
    },
  )
  assert.deepEqual(
    parseArtwork('series', '42', { id: 42, name: 'Show', poster_path: null }),
    { title: 'Show', imageUrl: null },
  )
  assert.deepEqual(
    parseArtwork('movie', '42', {
      id: 42,
      title: 'Film',
      poster_path: '/art.jpg',
    }),
    { title: 'Film', imageUrl: 'https://image.tmdb.org/t/p/w500/art.jpg' },
  )
  assert.equal(
    parseArtwork('music', 'abc', { id: 'abc', name: 'Album', images: [] })
      .imageUrl,
    null,
  )
  assert.throws(() => parseArtwork('movie', '42', { id: 43, title: 'Other' }))
})

test('failed lookups retry after their cooldown and pending artwork work is bounded', async (t) => {
  const f = fixture(async () => {
    throw Error('offline')
  })
  t.after(() => f.service.close())
  await f.get()
  const realNow = Date.now
  Date.now = () => realNow() + 61000
  try {
    await f.get()
    assert.equal(f.calls(), 2)
  } finally {
    Date.now = realNow
  }
  const blocked = fixture(
    (_, __, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(Error('cancelled')), {
          once: true,
        }),
      ),
  )
  t.after(() => blocked.service.close())
  const jobs = Array.from({ length: 32 }, (_, i) =>
    blocked.get('movie', String(i + 1)),
  )
  await flush()
  await assert.rejects(blocked.get('movie', '100'), (e) => e.status === 503)
  assert.equal(blocked.calls(), 1)
  blocked.service.close()
  assert.ok((await Promise.all(jobs)).every((url) => url === null))
})
