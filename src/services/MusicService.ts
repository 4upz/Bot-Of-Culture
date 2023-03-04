import needle from 'needle'
import { SearchResult } from 'src/utils/types'
import Service from './Service'

export default class MusicService extends Service {
  private readonly clientId: string
  private readonly clientSecret: string

  constructor() {
    const baseURL = 'https://api.spotify.com/v1/'

    // Token will start off as null
    super(baseURL, null)

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

    console.log(response.body)

    this.setAuthHeader(response.body.access_token)
  }

  async search(query: string): Promise<SearchResult[]> {
    return null
  }

  async getById(id: string): Promise<SearchResult> {
    return null
  }
}
