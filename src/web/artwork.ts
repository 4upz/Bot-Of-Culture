import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { ArtworkMetadata, ProviderError } from '../services/artwork'
import {
  HttpError,
  MediaType,
  normalizeTitle,
  publicImageUrl,
  types,
} from './query'

type Loader = (
  type: MediaType,
  id: string,
  signal: AbortSignal,
) => Promise<ArtworkMetadata>
interface CachedImage {
  url: string | null
  expires: number
}
interface ProviderQueue {
  tail: Promise<unknown>
  nextStart: number
  blockedUntil: number
}

/** Artwork is independent of review reads. Tickets are issued only for visible results. */
export class PublicArtworkService {
  private secret = randomBytes(32)
  private pending = new Map<string, Promise<string | null>>()
  private cache = new Map<string, CachedImage>()
  private queues = new Map<string, ProviderQueue>()
  private controllers = new Set<AbortController>()
  private closed = false
  constructor(private db: any, private load: Loader) {}

  url(type: MediaType, id: string): string | null {
    if (
      !types.includes(type) ||
      typeof id !== 'string' ||
      !(type === 'music' ? /^[A-Za-z0-9]{22}$/ : /^\d{1,20}$/).test(id)
    )
      return null
    // Stable within a minute so repeated cards share one browser image request.
    const expires = (Math.floor(Date.now() / 60000) + 15) * 60000
    return `/api/v1/artwork/${type}/${id}?ticket=${expires}.${this.sign(
      type,
      id,
      expires,
    )}`
  }
  private sign(type: string, id: string, expires: number) {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([type, id, expires]))
      .digest('hex')
  }
  async get(
    type: MediaType,
    id: string,
    ticket: unknown,
  ): Promise<string | null> {
    const match =
      typeof ticket === 'string' && /^(\d{13})\.([a-f0-9]{64})$/.exec(ticket)
    if (
      !match ||
      !this.url(type, id) ||
      Number(match[1]) <= Date.now() ||
      !timingSafeEqual(
        Buffer.from(match[2], 'hex'),
        Buffer.from(this.sign(type, id, Number(match[1])), 'hex'),
      )
    )
      throw new HttpError(403, 'Artwork link expired')
    if (this.closed) throw new HttpError(503, 'Artwork unavailable')
    const key = `${type}:${id}`
    const cached = this.cache.get(key)
    if (cached?.expires > Date.now()) return cached.url
    if (this.pending.has(key)) return this.pending.get(key)
    if (this.pending.size >= 32) throw new HttpError(503, 'Artwork busy')
    const job = this.resolve(type, id, key)
    this.pending.set(key, job)
    try {
      return await job
    } finally {
      this.pending.delete(key)
    }
  }
  private remember(key: string, url: string | null, ttl: number) {
    this.cache.delete(key)
    this.cache.set(key, { url, expires: Date.now() + ttl })
    if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value)
    return url
  }
  private async resolve(type: MediaType, id: string, key: string) {
    try {
      const where = { type_mediaId: { type, mediaId: id } }
      const existing = await this.db.mediaTitle.findUnique({ where })
      const stored = publicImageUrl(existing?.imageUrl)
      if (stored) return this.remember(key, stored, 3600000)
      const metadata = await this.fetch(type, id)
      const url = publicImageUrl(metadata.imageUrl)
      if (url && !this.closed) {
        // An image-only update must not rename titles or invalidate search cursors.
        try {
          await this.db.mediaTitle.upsert({
            where,
            create: {
              type,
              mediaId: id,
              title: metadata.title,
              normalizedTitle: normalizeTitle(metadata.title),
              fetchedAt: new Date(),
              imageUrl: url,
            },
            update: { imageUrl: url },
          })
        } catch {
          /* Keep the image usable if persistence is temporarily unavailable. */
        }
      }
      return this.remember(key, url, url ? 3600000 : 21600000)
    } catch (error) {
      return this.remember(
        key,
        null,
        error instanceof ProviderError ? error.retryAfter : 60000,
      )
    }
  }
  private fetch(type: MediaType, id: string) {
    const provider = type === 'series' ? 'movie' : type
    let queue = this.queues.get(provider)
    if (!queue) {
      queue = { tail: Promise.resolve(), nextStart: 0, blockedUntil: 0 }
      this.queues.set(provider, queue)
    }
    const deadline = Date.now() + 10000
    const job = queue.tail.then(async () => {
      if (this.closed || Date.now() >= deadline)
        throw Error('Artwork queue expired')
      if (queue.blockedUntil > Date.now())
        throw new ProviderError(429, queue.blockedUntil - Date.now())
      const delay = queue.nextStart - Date.now()
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      if (this.closed || Date.now() >= deadline)
        throw Error('Artwork queue expired')
      queue.nextStart = Date.now() + 500
      const controller = new AbortController()
      this.controllers.add(controller)
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        return await this.load(type, id, controller.signal)
      } catch (error) {
        if (error instanceof ProviderError && error.status === 429)
          queue.blockedUntil = Date.now() + error.retryAfter
        throw error
      } finally {
        clearTimeout(timer)
        this.controllers.delete(controller)
      }
    })
    queue.tail = job.catch(() => {})
    return job
  }
  close() {
    this.closed = true
    for (const controller of this.controllers) controller.abort()
    this.cache.clear()
  }
}
