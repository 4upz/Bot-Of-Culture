import { ReviewType } from '../utils/types'
import { publicImageUrl } from '../web/query'

export interface ArtworkMetadata {
  title: string
  imageUrl: string | null
}
export class ProviderError extends Error {
  constructor(public status: number, public retryAfter = 60000) {
    super('Artwork provider unavailable')
  }
}
export async function providerJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    const value = response.headers.get('Retry-After')
    const retry =
      value &&
      (/^\d+$/.test(value)
        ? Number(value) * 1000
        : Date.parse(value) - Date.now())
    await response.body?.cancel()
    throw new ProviderError(
      response.status,
      Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86400000) : 60000,
    )
  }
  return response.json()
}
export function parseArtwork(
  type: ReviewType,
  id: string,
  payload: any,
): ArtworkMetadata {
  const record =
    type === 'game' && Array.isArray(payload)
      ? payload.find((item: any) => String(item.id) === id)
      : payload
  if (!record || String(record.id) !== id)
    throw Error('Artwork provider ID mismatch')
  const title = type === 'movie' ? record.title : record.name
  if (typeof title !== 'string' || !title.trim() || title.length > 1000)
    throw Error('Artwork provider title missing')
  let image: string | null = null
  if (
    (type === 'movie' || type === 'series') &&
    typeof record.poster_path === 'string' &&
    /^\/[\w.-]+$/.test(record.poster_path)
  )
    image = 'https://image.tmdb.org/t/p/w500' + record.poster_path
  if (type === 'game' && typeof record.cover?.url === 'string')
    image = record.cover.url
      .replace(/^\/\//, 'https://')
      .replace('t_thumb', 't_cover_big')
  if (type === 'music') image = record.images?.[0]?.url
  return { title: title.trim(), imageUrl: publicImageUrl(image) }
}
