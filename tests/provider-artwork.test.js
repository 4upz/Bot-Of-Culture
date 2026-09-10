require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const needle = require('needle')
const MovieService = require('../src/services/MovieService').default
const GameService = require('../src/services/GameService').default
const MusicService = require('../src/services/MusicService').default
const { providerJson } = require('../src/services/artwork')

async function fixture(t, handler) {
  const calls = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const call = {
      url: req.url,
      method: req.method,
      headers: req.headers,
      body,
    }
    calls.push(call)
    res.setHeader('Content-Type', 'application/json')
    handler(call, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const request = needle.request
  // Redirect only the destination; exercise Needle's real encoding and sockets.
  t.mock.method(needle, 'request', (method, url, data, options, callback) => {
    const target = new URL(url)
    return request(
      method,
      base + '/' + target.host + target.pathname,
      data,
      options,
      callback,
    )
  })
  t.mock.method(global, 'fetch', () => {
    throw Error('Provider requests must use the local Needle fixture')
  })
  return calls
}
const respond = (res, body, status = 200, headers = {}) => {
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

test('existing Discord searches retain query encoding and automatic JSON parsing after the upgrade', async (t) => {
  const calls = await fixture(t, (call, res) => {
    if (call.url.includes('igdb')) respond(res, [{ id: 42, name: 'Game' }])
    else if (call.url.includes('spotify'))
      respond(res, {
        albums: {
          items: [
            {
              id: 'album',
              name: 'Album',
              album_type: 'album',
              artists: [{ name: 'Artist' }],
              images: [{ url: 'https://i.scdn.co/image/a' }],
            },
          ],
        },
      })
    else
      respond(res, {
        results: [
          { id: 42, title: 'Film', name: 'Series', poster_path: '/a.jpg' },
        ],
      })
  })
  const movie = new MovieService('movie-token')
  assert.equal((await movie.search('space & plus+'))[0].title, 'Film')
  assert.equal((await movie.searchSeries('series'))[0].title, 'Series')
  assert.equal(
    (await new GameService('client', 'secret').search('Game'))[0].title,
    'Game',
  )
  assert.equal(
    (await new MusicService('client', 'secret').search('space & plus+'))[0]
      .title,
    'Album',
  )
  assert.equal(
    new URL(calls[0].url, 'http://fixture').searchParams.get('query'),
    'space & plus+',
  )
  assert.equal(
    new URL(calls[3].url, 'http://fixture').searchParams.get('q'),
    'space & plus+',
  )
  assert.match(calls[2].body, /^search "Game";/)
})

test('provider clients send artwork queries and credentials through Needle', async (t) => {
  const calls = await fixture(t, (call, res) => {
    if (call.url.includes('igdb'))
      respond(res, [
        {
          id: 42,
          name: 'Game',
          cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/a.jpg' },
        },
      ])
    else if (call.url.includes('spotify'))
      respond(res, {
        id: 'abcdefghijklmnopqrstuv',
        name: 'Album',
        images: [{ url: 'https://i.scdn.co/image/a' }],
      })
    else
      respond(res, {
        id: 42,
        title: 'Film',
        name: 'Series',
        poster_path: '/a.jpg',
      })
  })
  const signal = new AbortController().signal
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
  assert.equal(calls[2].body, 'fields name, cover.url; where id = 42; limit 1;')
  assert.equal(calls[2].headers['content-type'], 'text/plain')
  assert.equal(calls[2].headers['client-id'], 'client')
  assert.equal(calls[2].headers.authorization, 'Bearer game-token')
  assert.equal(calls[3].headers.authorization, 'Bearer music-token')
  await assert.rejects(
    game.getArtwork('1; malicious', signal),
    /Invalid artwork/,
  )
  assert.equal(calls.length, 4)
})

test('expired game and music tokens refresh once with correctly encoded OAuth forms', async (t) => {
  const calls = await fixture(t, (call, res) => {
    if (call.url.includes('/token')) respond(res, { access_token: 'renewed' })
    else if (call.headers.authorization === 'Bearer expired')
      respond(res, {}, 401)
    else
      respond(
        res,
        call.url.includes('igdb')
          ? [{ id: 42, name: 'Game' }]
          : { id: 'abcdefghijklmnopqrstuv', name: 'Album' },
      )
  })
  for (const [client, id] of [
    [new GameService('client', 'space & plus+'), '42'],
    [new MusicService('client', 'space & plus+'), 'abcdefghijklmnopqrstuv'],
  ]) {
    const offset = calls.length
    client.setAuthHeader('expired', 'client')
    assert.equal(
      (await client.getArtwork(id, new AbortController().signal)).imageUrl,
      null,
    )
    assert.equal(calls.length - offset, 3)
    const auth = calls[offset + 1]
    assert.equal(auth.method, 'POST')
    assert.match(
      auth.headers['content-type'],
      /^application\/x-www-form-urlencoded/,
    )
    assert.equal(
      new URLSearchParams(auth.body).get('grant_type'),
      'client_credentials',
    )
    if (client instanceof GameService)
      assert.equal(
        new URLSearchParams(auth.body).get('client_secret'),
        'space & plus+',
      )
    else
      assert.equal(
        auth.headers.authorization,
        'Basic ' + Buffer.from('client:space & plus+').toString('base64'),
      )
    assert.equal(calls[offset + 2].headers.authorization, 'Bearer renewed')
  }
})

test('provider status handling preserves Retry-After and rejects malformed JSON', async (t) => {
  const calls = await fixture(t, (call, res) => {
    if (call.url.endsWith('/invalid')) res.end('not JSON')
    else if (call.url.endsWith('/missing')) respond(res, {}, 404)
    else respond(res, {}, 429, { 'Retry-After': '120' })
  })
  await assert.rejects(
    new GameService('client', 'secret').getArtwork(
      '42',
      new AbortController().signal,
    ),
    (e) => e.status === 429 && e.retryAfter === 120000,
  )
  assert.equal(calls.length, 1)
  await assert.rejects(
    providerJson('https://provider.test/missing', {}),
    (e) => e.status === 404,
  )
  await assert.rejects(
    providerJson('https://provider.test/invalid', {}),
    SyntaxError,
  )
})

test(
  'cancellation closes stalled connections before headers and during the response body',
  { timeout: 10000 },
  async (t) => {
    let reached, closed
    const calls = await fixture(t, (call, res) => {
      res.once('close', () => closed())
      if (call.url.endsWith('/body')) res.write('{"waiting":')
      reached()
    })
    for (const path of ['headers', 'body']) {
      const controller = new AbortController()
      const ready = new Promise((resolve) => {
        reached = resolve
      })
      const socketClosed = new Promise((resolve) => {
        closed = resolve
      })
      const result = providerJson('https://provider.test/' + path, {
        signal: controller.signal,
      })
      const rejected = assert.rejects(result, (e) => e.name === 'AbortError')
      await ready
      controller.abort()
      await rejected
      await socketClosed
    }
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      providerJson('https://provider.test/unused', {
        signal: controller.signal,
      }),
      (e) => e.name === 'AbortError',
    )
    assert.equal(calls.length, 2)
  },
)

test(
  'the original deadline still cancels artwork after OAuth refresh',
  { timeout: 10000 },
  async (t) => {
    let started, closeRetry
    const calls = await fixture(t, (call, res) => {
      if (call.url.includes('/token')) respond(res, { access_token: 'renewed' })
      else if (call.headers.authorization === 'Bearer expired')
        respond(res, {}, 401)
      else {
        res.once('close', () => closeRetry())
        res.write('{"waiting":')
        started()
      }
    })
    for (const [client, id] of [
      [new GameService('client', 'secret'), '42'],
      [new MusicService('client', 'secret'), 'abcdefghijklmnopqrstuv'],
    ]) {
      const offset = calls.length
      const ready = new Promise((resolve) => {
        started = resolve
      })
      const closed = new Promise((resolve) => {
        closeRetry = resolve
      })
      client.setAuthHeader('expired', 'client')
      const deadline = AbortSignal.timeout(1500)
      const result = client.getArtwork(id, deadline)
      const rejected = assert.rejects(result, (e) => e.name === 'AbortError')
      await ready
      await rejected
      assert.equal(deadline.aborted, true)
      await closed
      assert.equal(calls.length - offset, 3)
    }
  },
)
