import express from 'express'
import { resolve } from 'path'
import { BotClient } from '../Bot'
import { MembershipService, WebRevision } from './membership'
import { PublicReviewService } from './service'
import { HttpError, MediaType } from './query'
export function createWebApp(
  bot: BotClient,
  membership: MembershipService,
  revision: WebRevision,
) {
  const app = express()
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
  const buckets = new Map<string, { start: number; count: number }>()
  let active = 0
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 60000
    for (const [ip, b] of buckets) if (b.start < cutoff) buckets.delete(ip)
  }, 60000)
  cleanup.unref()
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET')
      return res.status(405).json({ error: 'Read-only endpoint' })
    const ip = req.ip || 'unknown'
    let b = buckets.get(ip)
    if (!b || Date.now() - b.start > 60000) {
      b = { start: Date.now(), count: 0 }
      buckets.set(ip, b)
    }
    if (++b.count > 90 || active >= 8) {
      res.set('Retry-After', '10')
      return res.status(429).json({ error: 'Please wait a moment and retry' })
    }
    return next()
  })
  const route =
    (kind: 'profile' | 'guild' | 'title') =>
    async (req: express.Request, res: express.Response) => {
      active++
      try {
        res.json(
          await service.read(
            kind,
            req.params.id,
            req.query,
            req.params.type as MediaType,
            req.params.mediaId,
          ),
        )
      } catch (error) {
        if (error instanceof HttpError)
          res.status(error.status).json({ error: error.message })
        else {
          console.error('Public review request failed')
          res.status(503).json({
            error: 'Reviews temporarily unavailable. Try again shortly.',
          })
        }
      } finally {
        active--
      }
    }
  app.get('/api/v1/users/:id/reviews', route('profile'))
  app.get('/api/v1/guilds/:id/titles', route('guild'))
  app.get('/api/v1/guilds/:id/titles/:type/:mediaId/reviews', route('title'))
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
  return { app, close: () => clearInterval(cleanup) }
}
