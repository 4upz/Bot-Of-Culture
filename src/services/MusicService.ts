import needle, { BodyData } from 'needle'
import { AlbumSearchResult, SearchResult } from 'src/utils/types'
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

  async search(query: string): Promise<AlbumSearchResult[]> {
    const endpoint = `${this.baseURL}/search`
    const params: BodyData = {
      q: query,
      type: 'album',
      limit: 5,
    }

    const results: Array<any> = await needle(
      'get',
      endpoint,
      params,
      this.headers,
    )
      .then((response) => {
        if (response.body.error) throw new Error(response.body.error.message)
        return response.body.albums.items
      })
      .catch((err) => {
        console.dir(err)
        throw err
      })

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
}
