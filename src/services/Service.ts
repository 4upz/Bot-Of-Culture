import { NeedleOptions } from 'needle'
import { SearchResult } from '../utils/types'
import { OutgoingHttpHeaders } from 'http'
import { ReviewType } from '../utils/types'
import { parseArtwork, providerJson, ProviderError } from './artwork'

export default abstract class Service {
  protected readonly baseURL: string
  protected headers: NeedleOptions

  protected constructor(baseURL: string, token?: string) {
    this.baseURL = baseURL
    this.headers = { headers: { Authorization: `Bearer ${token}` } }
  }

  /**
   * Sets the default authorization header used for each request to the given token and ID
   * @param token     the token to be used for this service
   * @param clientId  the optional clientId to be used
   */
  setAuthHeader(token: string, clientId?: string) {
    const headers = this.headers.headers as OutgoingHttpHeaders
    headers.Authorization = `Bearer ${token}`
    if (clientId) headers['Client-ID'] = clientId
  }

  protected async readArtwork(
    type: ReviewType,
    id: string,
    signal: AbortSignal,
    refresh?: (signal: AbortSignal) => Promise<void>,
  ) {
    if (!(type === 'music' ? /^[A-Za-z0-9]{22}$/ : /^\d{1,20}$/).test(id))
      throw Error('Invalid artwork identifier')
    const endpoint =
      type === 'game'
        ? this.baseURL
        : type === 'music'
        ? `${this.baseURL}/albums/${id}`
        : `${this.baseURL}/${type === 'movie' ? 'movie' : 'tv'}/${id}`
    const request = () =>
      providerJson(endpoint, {
        signal,
        headers: {
          ...(this.headers.headers as Record<string, string>),
          ...(type === 'game' ? { 'Content-Type': 'text/plain' } : {}),
        },
        ...(type === 'game'
          ? {
              method: 'post',
              body: `fields name, cover.url; where id = ${id}; limit 1;`,
            }
          : {}),
      })
    let payload
    try {
      payload = await request()
    } catch (error) {
      if (!(error instanceof ProviderError) || error.status !== 401 || !refresh)
        throw error
      await refresh(signal)
      payload = await request()
    }
    return parseArtwork(type, id, payload)
  }

  /**
   * Searches the API service using the provided query string
   * @param query term to search for
   */
  abstract search(query: string): Promise<SearchResult[]>

  /**
   * Fetches a resource from the API service by a given ID
   * @param id  the resource ID to fetch for
   */
  abstract getById(id: string): Promise<SearchResult>
}
