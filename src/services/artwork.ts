import needle, { BodyData, NeedleHttpVerbs, NeedleOptions } from 'needle'
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
interface ProviderRequest {
  method?: NeedleHttpVerbs
  body?: BodyData
  headers?: NeedleOptions['headers']
  signal?: AbortSignal
}
export async function providerJson(url: string, init: ProviderRequest) {
  const response = await needle(init.method || 'get', url, init.body ?? null, {
    headers: init.headers,
    signal: init.signal || AbortSignal.timeout(5000),
    // Keep JSON decoding strict; Needle's automatic parser retains invalid input.
    parse_response: false,
    decode_response: false,
  })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const value = response.headers['retry-after']
    const retry =
      value &&
      (/^\d+$/.test(value)
        ? Number(value) * 1000
        : Date.parse(value) - Date.now())
    throw new ProviderError(
      response.statusCode,
      Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86400000) : 60000,
    )
  }
  return JSON.parse(response.body.toString('utf8'))
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
