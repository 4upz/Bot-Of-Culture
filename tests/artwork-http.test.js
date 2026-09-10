require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { createWebApp } = require('../src/web/server')
const { PublicReviewService } = require('../src/web/service')

test(
  'review pages return before artwork, and eight waiting images cannot occupy review admission',
  { timeout: 10000 },
  async (t) => {
    const original = PublicReviewService.prototype.read
    const titles = Array.from({ length: 8 }, (_, i) => ({
      type: 'movie',
      mediaId: String(i + 1),
      media: { title: 'Film ' + (i + 1), imageUrl: null },
    }))
    PublicReviewService.prototype.read = async () => ({
      items: titles,
      nextCursor: null,
    })
    let release,
      lookups = 0,
      calls = 0
    const stored = new Map()
    const bot = {
      db: {
        mediaTitle: {
          async findUnique({ where }) {
            lookups++
            return stored.get(where.type_mediaId.mediaId)
          },
          async upsert({ create }) {
            stored.set(create.mediaId, create)
            return create
          },
        },
      },
      movies: {
        async getArtwork(id) {
          calls++
          if (calls === 1)
            await new Promise((resolve) => {
              release = resolve
            })
          return {
            title: 'Film ' + id,
            imageUrl: 'https://image.tmdb.org/t/p/w500/art.jpg',
          }
        },
      },
    }
    const web = createWebApp(bot, {}, {})
    const server = web.app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(async () => {
      release?.()
      PublicReviewService.prototype.read = original
      web.close()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    })
    const origin = 'http://127.0.0.1:' + server.address().port
    const first = await fetch(origin + '/api/v1/guilds/1/titles')
    assert.equal(first.status, 200)
    const data = await first.json()
    assert.equal(calls, 0)
    const requests = data.items.map((item) =>
      fetch(origin + item.media.artworkUrl, { redirect: 'manual' }),
    )
    const until = Date.now() + 3000
    while (lookups < 8 && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(lookups, 8)
    const next = await fetch(origin + '/api/v1/guilds/1/titles')
    assert.equal(next.status, 200)
    await next.json()
    assert.equal(calls, 1)
    release()
    for (const result of await Promise.all(requests)) {
      assert.equal(result.status, 302)
      assert.equal(
        result.headers.get('Location'),
        'https://image.tmdb.org/t/p/w500/art.jpg',
      )
      assert.equal(result.headers.get('Cache-Control'), 'no-store')
      await result.text()
    }
    const cached = await fetch(origin + data.items[0].media.artworkUrl, {
      redirect: 'manual',
    })
    assert.equal(cached.status, 302)
    await cached.text()
    assert.equal(calls, 8)
    const denied = await fetch(
      origin + '/api/v1/artwork/movie/99?ticket=forged',
      { redirect: 'manual' },
    )
    assert.equal(denied.status, 403)
    assert.equal(calls, 8)
    await denied.text()
  },
)
