import { NeedleOptions } from 'needle'
import { SearchResult } from '../utils/types'
import { OutgoingHttpHeaders } from 'http'

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
