require('ts-node/register/transpile-only')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { PublicReviewService } = require('../src/web/service')
const { createWebApp } = require('../src/web/server')
const { HttpError } = require('../src/web/query')

async function fixture(
  t,
  read = async () => ({ ok: true }),
  options = {},
  host = '127.0.0.1',
) {
  const original = PublicReviewService.prototype.read
  PublicReviewService.prototype.read = read
  const web = createWebApp({}, {}, {}, options)
  const server = web.app.listen(0, host)
  await once(server, 'listening')
  t.after(async () => {
    PublicReviewService.prototype.read = original
    web.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const request = (xff, path = '/api/v1/users/1/reviews', method = 'GET') => {
    let req
    const response = new Promise((resolve, reject) => {
      req = http.request(
        {
          host,
          port: server.address().port,
          path,
          method,
          headers: xff ? { 'X-Forwarded-For': xff } : {},
        },
        (res) => {
          res.resume()
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers }),
          )
        },
      )
      req.on('error', reject)
      req.end()
    })
    return { req, response }
  }
  return { request }
}
const trusted = { trustedProxyIps: ['127.0.0.1'] }

test('trusted immediate proxy gives clients independent limits; leftmost spoof and repeated trusted hops cannot evade', async (t) => {
  const { request } = await fixture(t, undefined, trusted)
  for (let i = 0; i < 90; i++)
    assert.equal(
      (await request(`192.0.2.${i}, 198.51.100.1`).response).status,
      200,
    )
  assert.equal(
    (await request('203.0.113.1, 198.51.100.1').response).status,
    429,
  )
  assert.equal((await request('198.51.100.2').response).status, 200)
  for (let i = 0; i < 90; i++)
    assert.equal(
      (await request(`192.0.2.${i}, 127.0.0.1`).response).status,
      200,
    )
  assert.equal((await request('203.0.113.2, 127.0.0.1').response).status, 429)
})

test('untrusted direct clients cannot select their rate bucket using forwarded headers', async (t) => {
  const original = process.env.REVIEW_WEB_TRUSTED_PROXY_IPS
  delete process.env.REVIEW_WEB_TRUSTED_PROXY_IPS
  t.after(() => {
    if (original !== undefined)
      process.env.REVIEW_WEB_TRUSTED_PROXY_IPS = original
  })
  const { request } = await fixture(t)
  for (let i = 0; i < 90; i++)
    assert.equal((await request(`192.0.2.${i}`).response).status, 200)
  assert.equal((await request('198.51.100.1').response).status, 429)
})

test('bucket capacity rejects new identities without evicting existing rate limits', async (t) => {
  const { request } = await fixture(t, undefined, trusted)
  for (let i = 0; i < 89; i++)
    assert.equal((await request('198.18.0.0').response).status, 200)
  for (let i = 0; i < 4096; i++)
    assert.equal(
      (await request(`198.18.${Math.floor(i / 256)}.${i % 256}`).response)
        .status,
      200,
    )
  assert.equal((await request('203.0.113.100').response).status, 429)
  assert.equal((await request('198.18.0.0').response).status, 429)
  const realNow = Date.now
  const advanced = realNow() + 60001
  Date.now = () => advanced
  try {
    assert.equal((await request('203.0.113.100').response).status, 200)
    assert.equal((await request('198.18.0.0').response).status, 200)
  } finally {
    Date.now = realNow
  }
})

test('disconnect aborts read but retains admission until underlying work settles', async (t) => {
  const pending = []
  const { request } = await fixture(
    t,
    (...args) =>
      new Promise((resolve) => pending.push({ resolve, context: args[5] })),
  )
  const requests = []
  try {
    for (let i = 0; i < 8; i++) {
      const item = request()
      item.response.catch(() => {})
      requests.push(item)
    }
    while (pending.length !== 8)
      await new Promise((resolve) => setTimeout(resolve, 5))
    assert.ok(
      pending[0].context,
      'read must receive deadline and cancellation context',
    )
    assert.ok(pending[0].context.deadline > Date.now())
    assert.ok(pending[0].context.deadline <= Date.now() + 8000)
    assert.equal((await request().response).status, 429)
    requests[0].req.destroy()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(pending[0].context.signal.aborted, true)
    assert.equal((await request().response).status, 429)
    pending[0].resolve({ ok: true })
    const next = request()
    next.response.catch(() => {})
    requests.push(next)
    while (pending.length !== 9)
      await new Promise((resolve) => setTimeout(resolve, 5))
    pending[8].resolve({ ok: true })
    assert.equal((await next.response).status, 200)
  } finally {
    for (const item of pending) item.resolve({ ok: true })
    for (const item of requests) item.req.destroy()
  }
})

test('failed reads release admission and preserve no-store and read-only responses', async (t) => {
  const { request } = await fixture(t, async () => {
    throw new HttpError(503, 'Unavailable')
  })
  for (let i = 0; i < 10; i++) {
    const result = await request().response
    assert.equal(result.status, 503)
    assert.equal(result.headers['cache-control'], 'no-store')
  }
  assert.equal(
    (await request(undefined, '/api/v1/users/1/reviews', 'POST').response)
      .status,
    405,
  )
})

test('explicit runtime proxy allowlist validates literals and normalizes mapped IPv4', async (t) => {
  const original = process.env.REVIEW_WEB_TRUSTED_PROXY_IPS
  t.after(() => {
    if (original === undefined) delete process.env.REVIEW_WEB_TRUSTED_PROXY_IPS
    else process.env.REVIEW_WEB_TRUSTED_PROXY_IPS = original
  })
  process.env.REVIEW_WEB_TRUSTED_PROXY_IPS = 'loopback'
  assert.throws(() => createWebApp({}, {}, {}), /exact IP/)
  process.env.REVIEW_WEB_TRUSTED_PROXY_IPS = '127.0.0.1/8'
  assert.throws(() => createWebApp({}, {}, {}), /exact IP/)
  process.env.REVIEW_WEB_TRUSTED_PROXY_IPS = ' ::ffff:127.0.0.1 '
  const { request } = await fixture(t)
  for (let i = 0; i < 90; i++)
    assert.equal((await request('198.51.100.1').response).status, 200)
  assert.equal((await request('198.51.100.1').response).status, 429)
  assert.equal((await request('198.51.100.2').response).status, 200)
})

test(
  'whole-read deadline aborts without releasing unsettled work or returning a late success',
  { timeout: 12000 },
  async (t) => {
    const pending = []
    const { request } = await fixture(
      t,
      (...args) =>
        new Promise((resolve) => pending.push({ resolve, context: args[5] })),
    )
    const requests = Array.from({ length: 8 }, () => request())
    for (const item of requests) item.response.catch(() => {})
    try {
      while (pending.length !== 8)
        await new Promise((resolve) => setTimeout(resolve, 5))
      await new Promise((resolve) =>
        pending[7].context.signal.addEventListener('abort', resolve, {
          once: true,
        }),
      )
      assert.equal((await request().response).status, 429)
      for (const item of pending) item.resolve({ ok: true })
      for (const item of requests)
        assert.equal((await item.response).status, 503)
    } finally {
      for (const item of pending) item.resolve({ ok: true })
      for (const item of requests) item.req.destroy()
    }
  },
)

for (const { ip, host } of [
  { ip: '0:0:0:0:0:0:0:1', host: '::1' },
  { ip: '::ffff:7f00:1', host: '127.0.0.1' },
]) {
  test(`equivalent proxy address ${ip} trusts only the immediate socket`, async (t) => {
    const { request } = await fixture(
      t,
      undefined,
      { trustedProxyIps: [ip] },
      host,
    )
    for (let i = 0; i < 90; i++)
      assert.equal(
        (await request(`192.0.2.${i}, 198.51.100.1`).response).status,
        200,
      )
    assert.equal(
      (await request('192.0.2.100, 198.51.100.1').response).status,
      429,
    )
    assert.equal((await request('198.51.100.2').response).status, 200)
    for (let i = 0; i < 90; i++)
      assert.equal((await request(`192.0.2.${i}, ${ip}`).response).status, 200)
    assert.equal((await request(`192.0.2.101, ${ip}`).response).status, 429)
  })
}
