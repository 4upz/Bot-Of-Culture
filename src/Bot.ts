import { PrismaClient } from '@prisma/client'
import { Client, ClientOptions, Collection } from 'discord.js'
import MovieService from './services/MovieService'
import { ReviewType, SlashCommand } from './utils/types'
import GameService from './services/GameService'
import MusicService from './services/MusicService'
import { getSecret } from './utils/helpers'

export class BotClient extends Client {
  public commands: Collection<string, SlashCommand>
  public db: PrismaClient
  public movies: MovieService
  public games: GameService
  public music: MusicService

  constructor(options: ClientOptions) {
    super(options)
  }

  async initDatabase() {
    // Init database
    console.log('Initializing database...')
    const dbUrl = await getSecret('DATABASE_URL')
    try {
      this.db = new PrismaClient({
        datasources: {
          db: {
            url: dbUrl,
          },
        },
      })
      await this.db.$connect()
      console.log('Database connected!')
    } catch (error) {
      console.error('Something went wrong connecting to the database')
    }
  }

  async initServices() {
    // Init services and authorizations
    console.log('Initiating services...')
    const tmdbToken = await getSecret('MOVIE_TOKEN', true)
    const twitchClientId = await getSecret('TWITCH_CLIENT_ID', true)
    const twitchClientSecret = await getSecret('TWITCH_CLIENT_SECRET', true)
    const spotifyClientId = await getSecret('SPOTIFY_CLIENT_ID', true)
    const spotifyClientSecret = await getSecret('SPOTIFY_CLIENT_SECRET', true)

    try {
      this.movies = new MovieService(tmdbToken)
      this.games = new GameService(twitchClientId, twitchClientSecret)
      this.music = new MusicService(spotifyClientId, spotifyClientSecret)
      await this.games.initAuthToken()
      await this.music.initAuthToken()
      console.log('Services initiated!')
    } catch (error) {
      console.error(
        'Something went wrong initializing services. Error: ',
        error.message,
      )
    }
  }

  getCollection(name: ReviewType) {
    const collections: any = {
      movie: this.db.movieReview,
      series: this.db.seriesReview,
      game: this.db.gameReview,
      music: this.db.musicReview,
    }

    return collections[name]
  }
}
