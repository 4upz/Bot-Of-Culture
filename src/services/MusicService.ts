import needle, { BodyData } from 'needle'
import { MusicSearchResult, SearchResult } from 'src/utils/types'
import Service from './Service'

export default class MusicService extends Service {
  private readonly clientId: string
  private readonly clientSecret: string

  constructor() {
    const baseURL = 'https://api.spotify.com/v1'

    super(baseURL)

    this.clientId = process.env.SPOTIFY_CLIENT_ID ?? ''
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? ''
  }

  async initAuthToken() {
    const headers = {
      Authorization:
        'Basic ' +
        Buffer.from([this.clientId, this.clientSecret].join(':')).toString(
          'base64',
        ),
    }
    const body = {
      grant_type: 'client_credentials',
    }
    const defaultErrorMessage =
      'Cannot authorize via Spotify. Something went wrong.'

    const response = await needle(
      'post',
      'https://accounts.spotify.com/api/token',
      body,
      { headers },
    ).catch((error) => {
      console.log(defaultErrorMessage)
      throw error
    })

    if (response.statusCode !== 200) {
      const error = response.body.error ?? defaultErrorMessage
      throw new Error('[Music Service] ' + error)
    }

    this.setAuthHeader(response.body.access_token)
  }

  async search(query: string): Promise<MusicSearchResult[]> {
    const endpoint = `${this.baseURL}/search`
    const params: BodyData = {
      q: query,
      type: 'album',
      limit: 5,
    }

    const results: Array<any> = await this.fetchRequestWithRetry(
      endpoint,
      params,
    )

    return results.map((result) => ({
      id: result.id,
      title: result.name,
      description: `${
        result.album_type.charAt(0).toUpperCase() + result.album_type.slice(1)
      } By ${result.artists[0].name}`,
      image: result.images[0].url,
      date: result.release_date,
      artist: result.artists[0].name,
      tracks: result.total_tracks,
      link: result.external_urls.spotify,
      albumType: result.album_type,
    }))
  }

  async getById(id: string): Promise<SearchResult> {
    return null
  }

  /**
   * Fetches data from the Spotify API
   * If token is expired, it will refresh token and re-attempt request
   * @param endpoint The spotify endpoint to query
   * @param params The Needle params containing the request body to send
   * @param retry Whether or not this is a retry attempt
   * @returns The result of the query
   * @throws Error if the request fails for any reason besides an expired token
   * @private
   */
  private async fetchRequestWithRetry(
    endpoint: string,
    params: BodyData,
    retry = false,
  ): Promise<any[]> {
    try {
      const response: any = await needle('get', endpoint, params, this.headers)
      // If unauthorized, getting a new auth token and awaiting the search
      if (response.statusCode === 401)
        if (!retry) {
          await this.initAuthToken()
          return await this.fetchRequestWithRetry(endpoint, params, true)
        } else {
          const { q: query } = params as any
          throw new Error(`Something went wrong for request: ${query}.`)
        }
      else if (response.body.error) throw new Error(response.body.error.message)

      return response.body.albums.items
    } catch (error) {
      console.dir(error)
      throw error
    }
  }
}
