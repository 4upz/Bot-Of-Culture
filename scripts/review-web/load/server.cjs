'use strict'
// Fixture-only server: never loads app.ts, credentials, or a Discord gateway.
const { PrismaClient } = require('@prisma/client')
const { monitorEventLoopDelay, performance } = require('node:perf_hooks')
const { BotClient } = require('../../../dist/Bot')
const { createWebApp } = require('../../../dist/web/server')
const {
  MembershipService,
  WebRevision,
} = require('../../../dist/web/membership')
const uri = process.env.LOAD_DATABASE_URL
if (
  !/^mongodb:\/\/host\.docker\.internal:27028\/boc_review_web_test_load_(600|6000|6000_wide)\?replicaSet=boc-tests&directConnection=true$/.test(
    uri || '',
  )
)
  throw Error('Only the explicit local synthetic load database is allowed')
const prisma = new PrismaClient({ datasources: { db: { url: uri } } })
const delayMs = Number(process.env.LOAD_DB_DELAY_MS || 40)
if (![0, 40, 100].includes(delayMs)) throw Error('Unsupported simulation delay')
let queries = 0,
  queryMs = [],
  peakRss = process.memoryUsage().rss,
  timerGaps = [],
  previousTick = performance.now()
let sinceCpu = process.cpuUsage(),
  sinceTime = performance.now()
const eventDelay = monitorEventLoopDelay({ resolution: 10 })
eventDelay.enable()
for (const key of [
  'movieReview',
  'seriesReview',
  'gameReview',
  'musicReview',
  'reviewPreference',
  'mediaTitle',
]) {
  const original = prisma[key].aggregateRaw.bind(prisma[key])
  prisma[key].aggregateRaw = async (...args) => {
    queries++
    const start = performance.now()
    await new Promise((r) => setTimeout(r, delayMs))
    try {
      return await original(...args)
    } finally {
      queryMs.push(performance.now() - start)
    }
  }
}
const bot = new BotClient({ intents: [] })
bot.db = prisma
bot.isReady = () => true
const guild = {
  name: 'Synthetic guild',
  memberCount: 84,
  members: {
    fetch: async () =>
      new Map(Array.from({ length: 84 }, (_, i) => [String(i + 1), {}])),
  },
}
bot.guilds.cache.set('10', guild)
const membership = new MembershipService(bot)
membership.start()
const percentile = (values, p) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]
    : 0
const heartbeat = setInterval(() => {
  const now = performance.now()
  timerGaps.push(Math.max(0, now - previousTick - 50))
  previousTick = now
  peakRss = Math.max(peakRss, process.memoryUsage().rss)
  bot.emit('fixtureInteraction', now)
}, 50)
// Simulate a small synchronous command-handler workload in the same event loop.
bot.on('fixtureInteraction', () => {
  JSON.stringify({ command: 'fixture', guild: 10, members: 84 })
})
let botReads = [],
  botReadErrors = 0,
  botReadSkipped = 0,
  botReadPending = false,
  measurementEpoch = 0
const botDatabaseTimer = setInterval(async () => {
  if (botReadPending) {
    botReadSkipped++
    return
  }
  botReadPending = true
  const epoch = measurementEpoch,
    start = performance.now()
  try {
    await new Promise((r) => setTimeout(r, delayMs))
    await prisma.movieReview.findMany({
      where: { userId: '1' },
      take: 1,
      select: { id: true },
    })
    if (epoch === measurementEpoch) botReads.push(performance.now() - start)
  } catch {
    if (epoch === measurementEpoch) botReadErrors++
  } finally {
    botReadPending = false
  }
}, 2000)
const web = createWebApp(bot, membership, new WebRevision(), {
  trustedProxyIps: ['::ffff:127.0.0.1', '127.0.0.1'],
})
// HTTP boundary tests use a local forwarding hop so clients exercise the actual trust logic.
const http = require('node:http')
let appServer
const proxy = http.createServer((req, res) => {
  if (req.url === '/__fixture/metrics') {
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        datasetSize: Number(uri.match(/_(600|6000)(?:_wide)?\?/)[1]),
        simulatedDbDelayMs: delayMs,
        fixtureShape: uri.includes('_wide?') ? '4000 titles' : '400 titles',
        runtime: {
          node: process.version,
          arch: process.arch,
          platform: process.platform,
        },
        queries,
        botReadCount: botReads.length,
        botReadP95Ms: percentile(botReads, 0.95),
        botReadMaxMs: Math.max(0, ...botReads),
        botReadErrors,
        botReadSkipped,
        queryP95Ms: percentile(queryMs, 0.95),
        peakRssMiB: peakRss / 1048576,
        eventLoopP95Ms: eventDelay.percentile(95) / 1e6,
        eventLoopMaxMs: eventDelay.max / 1e6,
        botTimerDelayP95Ms: percentile(timerGaps, 0.95),
        botTimerDelayMaxMs: Math.max(0, ...timerGaps),
        cpu: process.cpuUsage(sinceCpu),
        wallMs: performance.now() - sinceTime,
      }),
    )
    return
  }
  if (req.url === '/__fixture/reset') {
    measurementEpoch++
    botReads = []
    botReadErrors = 0
    botReadSkipped = 0
    queries = 0
    queryMs = []
    peakRss = process.memoryUsage().rss
    timerGaps = []
    eventDelay.reset()
    sinceCpu = process.cpuUsage()
    sinceTime = performance.now()
    res.end('reset')
    return
  }
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: appServer.address().port,
      path: req.url,
      method: req.method,
      headers: {
        'X-Forwarded-For': req.headers['x-fixture-reader'] || '192.0.2.1',
      },
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    },
  )
  upstream.on('error', () => {
    res.statusCode = 502
    res.end('fixture proxy failure')
  })
  req.pipe(upstream)
})
;(async () => {
  await prisma.$connect()
  await membership.sync('10')
  appServer = web.app.listen(0, '127.0.0.1', () =>
    proxy.listen(4319, '0.0.0.0', () => console.log('FIXTURE_READY')),
  )
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
async function close() {
  clearInterval(heartbeat)
  clearInterval(botDatabaseTimer)
  eventDelay.disable()
  membership.stop()
  bot.destroy()
  web.close()
  proxy.close()
  appServer?.close()
  await prisma.$disconnect()
}
process.on('SIGTERM', () => void close())
process.on('SIGINT', () => void close())
