import dotenv from 'dotenv'
import Service from './Service'
import needle from 'needle'
import { GameSearchResult, SearchResult } from '../utils/types'
import { cache, CacheTTL } from '../utils/cache'
import { logger } from '../utils/logger'

dotenv.config()

export default class GameService extends Service {
  private readonly clientId: string
  private readonly clientSecret: string

  constructor(clientId: string, clientSecret: string) {
    const baseURL = 'https://api.igdb.com/v4/games'

    // Token will start off as null
    super(baseURL, null)

    this.clientId = clientId
    this.clientSecret = clientSecret
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
    const startTime = Date.now()
    const cacheKey = { query }

    // Check cache first
    const cached = await cache.get<SearchResult[]>('GameService', 'search', cacheKey)
    if (cached) {
      const latency = Date.now() - startTime
      await logger.logApiCall('GameService', 'search', latency, true, { query })
      return cached
    }

    // Cache miss - call API
    const request = `search "${query}";\n`
    const results = await this.fetchRequest(request)

    if (!Array.isArray(results)) {
      console.error('API returned non-array response:', results)
      return []
    }

    const searchResults = results.map((result: any) => ({
      id: result.id,
      title: result.name,
      description: '',
      image: '',
      date: result.release_dates
        ? result.release_dates[0].y?.toString()
        : 'N/A',
    }))

    // Store in cache
    await cache.set('GameService', 'search', cacheKey, searchResults, CacheTTL.SEARCH_RESULTS)

    // Log API call
    const latency = Date.now() - startTime
    await logger.logApiCall('GameService', 'search', latency, false, { query })

    return searchResults
  }

  async getById(id: string): Promise<GameSearchResult> {
    const startTime = Date.now()
    const cacheKey = { id }

    // Check cache first
    const cached = await cache.get<GameSearchResult>('GameService', 'getById', cacheKey)
    if (cached) {
      const latency = Date.now() - startTime
      await logger.logApiCall('GameService', 'getById', latency, true, { id })
      return cached
    }

    // Cache miss - call API
    const request = `where id = ${id};`
    const results: any[] = await this.fetchRequest(request)
    const game = results[0]

    const developer = game.involved_companies
      ? game.involved_companies.find((company: any) => company.developer)
      : 'N/A'
    const publisher = game.involved_companies
      ? game.involved_companies.find((company: any) => company.publisher)
      : 'N/A'

    const gameResult = {
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

    // Store in cache
    await cache.set('GameService', 'getById', cacheKey, gameResult, CacheTTL.MEDIA_DETAILS)

    // Log API call
    const latency = Date.now() - startTime
    await logger.logApiCall('GameService', 'getById', latency, false, { id })

    return gameResult
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
      'fields name, summary, cover.url, release_dates.y, genres.name, involved_companies.*, platforms.name, game_modes.name, aggregated_rating, aggregated_rating_count;'
    let requestBody = query + fields
    if (query.includes('search')) {
      // Filter to main games, standalone expansions, remakes, and expanded games
      // Exclude DLC, expansions, bundles, mods, episodes, seasons, remasters, ports, etc.
      // Also filter to parent versions only (not editions)
      const filter = 'where game_type = (0, 4, 8, 10) & version_parent = null;'
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

        // Log non-200 responses for debugging
        if (statusCode !== 200) {
          console.error(`IGDB API returned status ${statusCode}`)
          console.error('Request body:', requestBody)
          console.error('Response body:', JSON.stringify(results, null, 2))
        }
      })
      .catch((error) => {
        console.error('IGDB API request failed:', error.message)
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
