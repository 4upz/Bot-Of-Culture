require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const MovieService = require('../src/services/MovieService').default
const GameService = require('../src/services/GameService').default
const MusicService = require('../src/services/MusicService').default
const { providerJson } = require('../src/services/artwork')
const response = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers })

test('all provider clients use lightweight artwork requests with server-side credentials and cancellation', async (t) => {
  const original = global.fetch
  t.after(() => {
    global.fetch = original
  })
  const calls = [],
    signal = new AbortController().signal
  global.fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.includes('igdb'))
      return response([
        {
          id: 42,
          name: 'Game',
          cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/a.jpg' },
        },
      ])
    if (url.includes('spotify'))
      return response({
        id: 'abcdefghijklmnopqrstuv',
        name: 'Album',
        images: [{ url: 'https://i.scdn.co/image/a' }],
      })
    return response({
      id: 42,
      title: 'Film',
      name: 'Series',
      poster_path: '/a.jpg',
    })
  }
  const movie = new MovieService('movie-token'),
    game = new GameService('client', 'secret'),
    music = new MusicService('client', 'secret')
  game.setAuthHeader('game-token', 'client')
  music.setAuthHeader('music-token')
  assert.equal(
    (await movie.getArtwork('42', signal)).imageUrl,
    'https://image.tmdb.org/t/p/w500/a.jpg',
  )
  assert.equal((await movie.getArtwork('42', signal, 'series')).title, 'Series')
  assert.equal((await game.getArtwork('42', signal)).title, 'Game')
  assert.equal(
    (await music.getArtwork('abcdefghijklmnopqrstuv', signal)).imageUrl,
    'https://i.scdn.co/image/a',
  )
  assert.match(calls[1].url, /\/tv\/42$/)
  assert.equal(
    calls[2].init.body,
    'fields name, cover.url; where id = 42; limit 1;',
  )
  assert.equal(calls[2].init.headers['Client-ID'], 'client')
  assert.equal(calls[2].init.headers.Authorization, 'Bearer game-token')
  assert.ok(calls.every((c) => c.init.signal === signal))
  await assert.rejects(
    game.getArtwork('1; malicious', signal),
    /Invalid artwork/,
  )
  assert.equal(calls.length, 4)
})

test('expired game and music tokens refresh once and retry within the original deadline', async (t) => {
  const original = global.fetch
  t.after(() => {
    global.fetch = original
  })
  for (const [client, id] of [
    [new GameService('client', 'secret'), '42'],
    [new MusicService('client', 'secret'), 'abcdefghijklmnopqrstuv'],
  ]) {
    const signal = new AbortController().signal,
      calls = []
    client.setAuthHeader('expired', 'client')
    global.fetch = async (url, init) => {
      calls.push({ url, init })
      if (url.includes('/token')) return response({ access_token: 'renewed' })
      if (init.headers.Authorization === 'Bearer expired')
        return response({}, 401)
      return response(
        url.includes('igdb')
          ? [{ id: 42, name: 'Game' }]
          : { id, name: 'Album' },
      )
    }
    const result = await client.getArtwork(id, signal)
    assert.equal(result.imageUrl, null)
    assert.equal(calls.length, 3)
    assert.ok(calls.every((c) => c.init.signal === signal))
    assert.equal(calls[2].init.headers.Authorization, 'Bearer renewed')
    assert.match(calls[1].init.body.toString(), /grant_type=client_credentials/)
  }
})

test('provider failures preserve Retry-After, abort slow requests and do not retry other errors', async (t) => {
  const original = global.fetch
  t.after(() => {
    global.fetch = original
  })
  let calls = 0
  global.fetch = async () => {
    calls++
    return response({}, 429, { 'Retry-After': '120' })
  }
  await assert.rejects(
    new GameService('client', 'secret').getArtwork(
      '42',
      new AbortController().signal,
    ),
    (e) => e.status === 429 && e.retryAfter === 120000,
  )
  assert.equal(calls, 1)
  const controller = new AbortController()
  global.fetch = async (_, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      }),
    )
  const request = providerJson('https://api.themoviedb.org/3/movie/42', {
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(request, (e) => e.name === 'AbortError')
})
