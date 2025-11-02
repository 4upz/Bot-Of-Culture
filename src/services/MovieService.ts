import needle, { BodyData } from 'needle'
import { SearchResult, SeriesSearchResult } from 'src/utils/types'
import Service from './Service'
import { cache, CacheTTL } from '../utils/cache'
import { logger } from '../utils/logger'

export default class MovieService extends Service {
  constructor(token: string) {
    if (!token)
      throw new Error('Missing or incorrect TMDB API Authorization token')
    const baseURL = 'https://api.themoviedb.org/3'

    super(baseURL, token)
  }

  async search(query: string): Promise<SearchResult[]> {
    const startTime = Date.now()
    const cacheKey = { query }

    // Check cache first
    const cached = await cache.get<SearchResult[]>('MovieService', 'search', cacheKey)
    if (cached) {
      const latency = Date.now() - startTime
      await logger.logApiCall('MovieService', 'search', latency, true, { query })
      return cached
    }

    // Cache miss - call API
    const endpoint = `${this.baseURL}/search/movie`
    const params: BodyData = { query }

    const results: Array<any> = await needle(
      'get',
      endpoint,
      params,
      this.headers,
    )
      .then((response) => {
        if (response.body.error) throw new Error(response.body.error)
        return response.body.results
      })
      .catch((err) => {
        throw err
      })

    // Transform results
    const searchResults = results.slice(0, 5).map((result) => ({
      id: result.id.toString(),
      title: result.title,
      description: result.overview,
      image: `https://www.themoviedb.org/t/p/w600_and_h900_bestv2${result.poster_path}`,
      date: result.release_date,
    }))

    // Store in cache
    await cache.set('MovieService', 'search', cacheKey, searchResults, CacheTTL.SEARCH_RESULTS)

    // Log API call
    const latency = Date.now() - startTime
    await logger.logApiCall('MovieService', 'search', latency, false, { query })

    return searchResults
  }

  async searchSeries(query: string): Promise<SearchResult[]> {
    const startTime = Date.now()
    const cacheKey = { query }

    // Check cache first
    const cached = await cache.get<SearchResult[]>('MovieService', 'searchSeries', cacheKey)
    if (cached) {
      const latency = Date.now() - startTime
      await logger.logApiCall('MovieService', 'searchSeries', latency, true, { query })
      return cached
    }

    // Cache miss - call API
    const endpoint = `${this.baseURL}/search/tv`
    const params: BodyData = { query }

    const results: Array<any> = await needle(
      'get',
      endpoint,
      params,
      this.headers,
    )
      .then((response) => {
        if (response.body.error) throw new Error(response.body.error)
        return response.body.results
      })
      .catch((err) => {
        throw err
      })

    // Transform results
    const searchResults = results.slice(0, 5).map((result) => ({
      id: result.id.toString(),
      title: result.name,
      description: result.overview,
      image: `https://www.themoviedb.org/t/p/w600_and_h900_bestv2${result.poster_path}`,
      date: result.first_air_date,
    }))

    // Store in cache
    await cache.set('MovieService', 'searchSeries', cacheKey, searchResults, CacheTTL.SEARCH_RESULTS)

    // Log API call
    const latency = Date.now() - startTime
    await logger.logApiCall('MovieService', 'searchSeries', latency, false, { query })

    return searchResults
  }

  async getById(id: string): Promise<SearchResult> {
    const startTime = Date.now()
    const cacheKey = { id }

    // Check cache first
    const cached = await cache.get<SearchResult>('MovieService', 'getById', cacheKey)
    if (cached) {
      const latency = Date.now() - startTime
      await logger.logApiCall('MovieService', 'getById', latency, true, { id })
      return cached
    }

    // Cache miss - call API
    const endpoint = `${this.baseURL}/movie/${id}`

    const result: any = await needle('get', endpoint, null, this.headers)
      .then((response) => response.body)
      .catch((err) => {
        throw err
      })

    // Transform result
    const searchResult = {
      id: result.id.toString(),
      title: result.title,
      description: result.overview,
      image: `https://www.themoviedb.org/t/p/w600_and_h900_bestv2${result.poster_path}`,
      date: result.release_date,
    }

    // Store in cache
    await cache.set('MovieService', 'getById', cacheKey, searchResult, CacheTTL.MEDIA_DETAILS)

    // Log API call
    const latency = Date.now() - startTime
    await logger.logApiCall('MovieService', 'getById', latency, false, { id })

    return searchResult
  }

  async getSeriesById(id: string): Promise<SeriesSearchResult> {
    const startTime = Date.now()
    const cacheKey = { id }

    // Check cache first
    const cached = await cache.get<SeriesSearchResult>('MovieService', 'getSeriesById', cacheKey)
    if (cached) {
      const latency = Date.now() - startTime
      await logger.logApiCall('MovieService', 'getSeriesById', latency, true, { id })
      return cached
    }

    // Cache miss - call API
    const endpoint = `${this.baseURL}/tv/${id}`

    const result: any = await needle('get', endpoint, null, this.headers)
      .then((response) => response.body)
      .catch((err) => {
        throw err
      })

    // Transform result
    const seriesResult = {
      id: result.id.toString(),
      title: result.name,
      description: result.overview,
      image: `https://www.themoviedb.org/t/p/w600_and_h900_bestv2${result.poster_path}`,
      date: result.first_air_date,
      lastAirDate: result.last_air_date,
      episodes: result.number_of_episodes?.toString() || 'n/a',
      episodeLength: result.episode_run_time[0]?.toString() || 'n/a',
      seasons: result.number_of_seasons?.toString() || 'n/a',
      status: result.status,
    }

    // Store in cache
    await cache.set('MovieService', 'getSeriesById', cacheKey, seriesResult, CacheTTL.MEDIA_DETAILS)

    // Log API call
    const latency = Date.now() - startTime
    await logger.logApiCall('MovieService', 'getSeriesById', latency, false, { id })

    return seriesResult
  }
}
