import express from 'express'
import { resolve } from 'path'
import { isIP } from 'net'
import { BotClient } from '../Bot'
import { MembershipService, WebRevision } from './membership'
import { PublicReviewService } from './service'
import { HttpError, MediaType } from './query'
import { PublicArtworkService } from './artwork'
export interface WebAppOptions {
  trustedProxyIps?: string[]
}

// Only the immediate, explicitly configured reverse proxy may supply client IPs.
// IPv4 sockets can appear in mapped IPv6 form when Node listens on both stacks.
function normalizeIp(ip: string) {
  const version = isIP(ip)
  if (!version) return ip
  // URL canonicalizes zero compression and hexadecimal/dotted mapped forms.
  // Keep an IPv6 zone identifier exact; URL itself does not accept zones.
  const [address, zone] = ip.split('%')
  const mapped = version === 4 ? `::ffff:${address}` : address
  return new URL(`http://[${mapped}]/`).hostname + (zone ? `%${zone}` : '')
}

export function createWebApp(
  bot: BotClient,
  membership: MembershipService,
  revision: WebRevision,
  options: WebAppOptions = {},
) {
  const app = express()
  const proxyIps =
    options.trustedProxyIps ??
    (process.env.REVIEW_WEB_TRUSTED_PROXY_IPS || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean)
  if (proxyIps.some((ip) => !isIP(ip)))
    throw new Error(
      'REVIEW_WEB_TRUSTED_PROXY_IPS must contain only exact IP addresses',
    )
  const trustedProxyIps = new Set(proxyIps.map(normalizeIp))
  app.set(
    'trust proxy',
    (ip: string, hop: number) =>
      hop === 0 && trustedProxyIps.has(normalizeIp(ip)),
  )
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    })
    next()
  })
  const service = new PublicReviewService(bot, membership, revision)
  const artwork = new PublicArtworkService(bot.db, (type, id, signal) => {
    if (type === 'game') return bot.games.getArtwork(id, signal)
    if (type === 'music') return bot.music.getArtwork(id, signal)
    return bot.movies.getArtwork(id, signal, type)
  })
  const buckets = new Map<string, { start: number; count: number }>()
  let active = 0
  let activeArtwork = 0
  const pruneBuckets = () => {
    const cutoff = Date.now() - 60000
    for (const [ip, b] of buckets) if (b.start <= cutoff) buckets.delete(ip)
  }
  const cleanup = setInterval(pruneBuckets, 60000)
  cleanup.unref()
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET')
      return res.status(405).json({ error: 'Read-only endpoint' })
    const reject = () => {
      res.set('Retry-After', '10')
      return res.status(429).json({ error: 'Please wait a moment and retry' })
    }
    const ip = req.ip || 'unknown'
    let b = buckets.get(ip)
    if (!b || Date.now() - b.start >= 60000) {
      if (!b && buckets.size >= 4096) {
        pruneBuckets()
        if (buckets.size >= 4096) return reject()
      }
      b = { start: Date.now(), count: 0 }
      buckets.set(ip, b)
    }
    if (++b.count > 90 || active >= 8) return reject()
    return next()
  })
  const route =
    (kind: 'profile' | 'guild' | 'title') =>
    async (req: express.Request, res: express.Response) => {
      active++
      const controller = new AbortController()
      const deadline = Date.now() + 8000
      const abort = () => controller.abort()
      const timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
      timer.unref()
      res.once('close', abort)
      try {
        const result = await service.read(
          kind,
          req.params.id,
          req.query,
          req.params.type as MediaType,
          req.params.mediaId,
          { deadline, signal: controller.signal },
        )
        if (controller.signal.aborted || Date.now() >= deadline)
          throw new HttpError(
            503,
            'Reviews temporarily unavailable. Try again shortly.',
          )
        // Only successful, privacy-filtered pages can authorize a provider lookup.
        for (const item of result.items || []) {
          if (item.media && !item.media.imageUrl)
            item.media.artworkUrl = artwork.url(item.type, item.mediaId)
        }
        if (!res.destroyed) res.json(result)
      } catch (error) {
        if (res.destroyed) return
        if (error instanceof HttpError)
          res.status(error.status).json({ error: error.message })
        else {
          console.error('Public review request failed')
          res.status(503).json({
            error: 'Reviews temporarily unavailable. Try again shortly.',
          })
        }
      } finally {
        clearTimeout(timer)
        res.removeListener('close', abort)
        // A disconnect/deadline cannot release capacity while DB work still runs.
        active--
      }
    }
  app.get('/api/v1/users/:id/reviews', route('profile'))
  app.get('/api/v1/guilds/:id/titles', route('guild'))
  app.get('/api/v1/guilds/:id/titles/:type/:mediaId/reviews', route('title'))
  app.get('/api/v1/artwork/:type/:mediaId', async (req, res) => {
    if (activeArtwork >= 32) {
      res.sendStatus(503)
      return
    }
    activeArtwork++
    // Image work has separate admission so slow artwork cannot occupy review slots.
    const timer = setTimeout(() => {
      if (!res.destroyed && !res.headersSent) res.sendStatus(503)
    }, 15000)
    timer.unref()
    try {
      const url = await artwork.get(
        req.params.type as MediaType,
        req.params.mediaId,
        req.query.ticket,
      )
      if (!res.destroyed && !res.headersSent) {
        if (url) res.redirect(302, url)
        else res.sendStatus(404)
      }
    } catch (error) {
      if (!res.destroyed && !res.headersSent)
        res.sendStatus(error instanceof HttpError ? error.status : 503)
    } finally {
      clearTimeout(timer)
      activeArtwork--
    }
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))
  const assets = resolve(__dirname, '../../src/web/public')
  app.use(
    '/assets',
    express.static(assets, {
      etag: false,
      lastModified: false,
      fallthrough: false,
    }),
  )
  app.get(['/u/:id', '/g/:id'], (_req, res) =>
    res.sendFile(resolve(assets, 'index.html')),
  )
  app.use((_req, res) => res.status(404).send('Not found'))
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error.status === 404 ? 404 : 500)
        .send(error.status === 404 ? 'Not found' : 'Request unavailable')
    },
  )
  return {
    app,
    close: () => {
      clearInterval(cleanup)
      artwork.close()
    },
  }
}
