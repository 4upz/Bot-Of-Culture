import dotenv from 'dotenv'
import Service from './Service'
import needle from 'needle'
import { GameSearchResult, SearchResult } from '../utils/types'

dotenv.config()

export default class GameService extends Service {
  private readonly clientId: string
  private readonly clientSecret: string

  constructor() {
    const baseURL = 'https://api.igdb.com/v4/games'

    // Token will start off as null
    super(baseURL, null)

    this.clientId = process.env.TWITCH_CLIENT_ID ?? ''
    this.clientSecret = process.env.TWITCH_CLIENT_SECRET ?? ''
  }

  async initAuthToken() {
    const authData = {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
    }
    const response = await needle(
      'post',
      'https://id.twitch.tv/oauth2/token',
      authData,
    ).catch((error) => {
      console.log('Cannot authorize via Twitch. Something went wrong.')
      throw error
    })
    this.setAuthHeader(response.body.access_token, this.clientId)
  }

  async search(query: string): Promise<SearchResult[]> {
    const request = `search "${query}";\n`
    const results = await this.fetchRequest(request)

    return results.map((result: any) => ({
      id: result.id,
      title: result.name,
      description: '',
      image: '',
      date: result.release_dates
        ? result.release_dates[0].y?.toString()
        : 'N/A',
    }))
  }

  async getById(id: string): Promise<GameSearchResult> {
    const request = `where id = ${id};`
    const results: any[] = await this.fetchRequest(request)
    const game = results[0]

    const developer = game.involved_companies.find(
      (company: any) => company.developer,
    )
    const publisher = game.involved_companies.find(
      (company: any) => company.publisher,
    )
    return {
      id: game.id,
      title: game.name,
      description: game.summary,
      platforms: game.platforms,
      // replace thumbnail part of url in order to get large image
      image: `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`,
      date: game?.release_dates[0]?.y?.toString(),
      // game modes + multiplayer modes will be used to show game modes and player count for matching multiplayer mode
      gameModes: game.game_modes,
      developer: developer?.company.name || 'N/A',
      publisher: publisher?.company.name || 'N/A',
      genres: game.genres,
      rating: Math.floor(game.aggregated_rating),
      ratingCount: game.aggregated_rating_count,
    }
  }

  /**
   * Builds request syntax and fetches data from IGDB API.
   * If token is expired, it will refresh token and re-attempt request
   * @param query The primary apicalypse query to use -- usually a search or filter
   * @param retry Whether this call is an attempted retry for a request
   * @private
   */
  private async fetchRequest(query: string, retry = false): Promise<any[]> {
    // Builds apocalypse query
    const fields =
      'fields name, summary, cover.url, release_dates.y, genres.name, involved_companies.developer, involved_companies.publisher, involved_companies.company.name, platforms.name, game_modes.name, aggregated_rating, aggregated_rating_count;'
    let requestBody = query + fields
    if (query.includes('search')) {
      // Exclude expansions, dlc, and special editions
      const filter = 'where category = 0 & version_title = null;'
      const limit = 'limit 5;\n'
      requestBody += filter + limit
    }

    let results: any[] = []
    let statusCode

    await needle(
      'post',
      'https://api.igdb.com/v4/games',
      requestBody,
      this.headers,
    )
      .then((response) => {
        results = response.body
        statusCode = response.statusCode
      })
      .catch((error) => {
        console.error(error.message)
        throw error
      })

    // If unauthorized, getting a new auth token and awaiting the search
    if (statusCode === 401)
      if (!retry) {
        await this.initAuthToken()
        return await this.fetchRequest(query, true)
      } else {
        throw new Error(
          `[${Date.now().toLocaleString()}]There was trouble getting authorization for search: ${query}.`,
        )
      }
    else return results
  }
}
