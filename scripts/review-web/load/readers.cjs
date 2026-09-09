'use strict'
const fs = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const base = 'http://127.0.0.1:4319',
  readers = Number(process.argv[2]),
  duration = Number(process.argv[3] || 45000),
  output = process.argv[4]
if (![1, 5, 10].includes(readers) || duration < 30000 || duration > 120000)
  throw Error('Use 1,5,10 readers and 30000–120000ms')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  samples = [],
  statuses = {},
  failures = []
const quantile = (xs, p) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)] : 0
async function read(path, reader, kind) {
  const start = performance.now()
  try {
    const response = await fetch(base + path, {
      headers: { 'X-Fixture-Reader': '192.0.2.' + (reader + 1) },
      signal: AbortSignal.timeout(12000),
    })
    const body = await response.json()
    const ms = performance.now() - start
    samples.push({ kind, ms, status: response.status })
    statuses[response.status] = (statuses[response.status] || 0) + 1
    if (response.status !== 200)
      failures.push({ kind, status: response.status, error: body.error })
    return response.ok ? body : null
  } catch (e) {
    samples.push({
      kind,
      ms: performance.now() - start,
      status: 'transport-error',
    })
    statuses['transport-error'] = (statuses['transport-error'] || 0) + 1
    failures.push({ kind, error: e.name })
    return null
  }
}
;(async () => {
  await fetch(base + '/__fixture/reset')
  const start = performance.now()
  await Promise.all(
    Array.from({ length: readers }, async (_, i) => {
      await sleep(i * 500)
      let first = await read('/api/v1/guilds/10/titles', i, 'guild'),
        step = 0,
        lastRefresh = performance.now()
      while (performance.now() - start < duration) {
        await sleep(4000)
        if (performance.now() - start >= duration) break
        if (performance.now() - lastRefresh >= 30000) {
          first = await read('/api/v1/guilds/10/titles', i, 'refresh')
          lastRefresh = performance.now()
          continue
        }
        const row = first?.items?.find((r) => r.nextReviewCursor)
        if (step % 4 === 0 && first?.nextCursor)
          await read(
            '/api/v1/guilds/10/titles?cursor=' +
              encodeURIComponent(first.nextCursor),
            i,
            'next-page',
          )
        else if (step % 4 === 1)
          await read(
            '/api/v1/guilds/10/titles?q=synthetic%20title%201',
            i,
            'search',
          )
        else if (step % 4 === 2 && row)
          await read(
            '/api/v1/guilds/10/titles/' +
              row.type +
              '/' +
              row.mediaId +
              '/reviews?cursor=' +
              encodeURIComponent(row.nextReviewCursor),
            i,
            'expand',
          )
        else
          await read(
            '/api/v1/users/' + ((i % 7) + 1) + '/reviews',
            i,
            'profile',
          )
        step++
      }
    }),
  )
  const normal = await (await fetch(base + '/__fixture/metrics')).json()
  const normalStatuses = { ...statuses }
  const normalSamples = [...samples]
  const normalFailures = [...failures]
  await sleep(500)
  await fetch(base + '/__fixture/reset')
  samples.length = 0
  failures.length = 0
  for (const k of Object.keys(statuses)) delete statuses[k]
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      read('/api/v1/guilds/10/titles', i + 100, 'burst'),
    ),
  )
  const overload = await (await fetch(base + '/__fixture/metrics')).json()
  const burstStatuses = { ...statuses },
    burstFailures = [...failures]
  const recoveryStart = performance.now()
  const recovery = await read('/api/v1/guilds/10/titles', 240, 'recovery')
  const recoveryResult = {
    ok: Boolean(recovery),
    ms: performance.now() - recoveryStart,
  }
  const result = {
    readers,
    durationMs: duration,
    normal: {
      ...normal,
      statuses: normalStatuses,
      requests: normalSamples.length,
      p50Ms: quantile(
        normalSamples.map((s) => s.ms),
        0.5,
      ),
      p95Ms: quantile(
        normalSamples.map((s) => s.ms),
        0.95,
      ),
      maxMs: Math.max(0, ...normalSamples.map((s) => s.ms)),
      byKind: Object.fromEntries(
        [...new Set(normalSamples.map((s) => s.kind))].map((k) => {
          const a = normalSamples.filter((s) => s.kind === k)
          return [
            k,
            {
              count: a.length,
              p95Ms: quantile(
                a.map((s) => s.ms),
                0.95,
              ),
            },
          ]
        }),
      ),
      failures: normalFailures,
    },
    overload: {
      ...overload,
      statuses: burstStatuses,
      recovery: recoveryResult,
      failures: burstFailures,
    },
    limitations: [
      'Synthetic API flows, not rendered browser or live Discord commands',
      'Conservative CPU/memory quota does not reproduce GCE burst scheduling',
      'Each aggregate adds configured simulated latency; real Atlas throughput unmeasured',
    ],
  }
  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
