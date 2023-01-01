import { PrismaClient } from '@prisma/client'
import { Client, ClientOptions, Collection } from 'discord.js'
import MovieService from './services/MovieService'
import { ReviewType, SlashCommand } from './utils/types'
import GameService from './services/GameService'

export class BotClient extends Client {
  public commands: Collection<string, SlashCommand>
  public db: PrismaClient
  public movies: MovieService
  public games: GameService

  constructor(options: ClientOptions) {
    super(options)
  }

  async initDatabase() {
    // Init database
    console.log('Initializing database...')
    try {
      this.db = new PrismaClient()
      await this.db.$connect()
      console.log('Database connected!')
    } catch (error) {
      console.error('Something went wrong connecting to the database')
    }
  }

  async initServices() {
    // Init services and authorizations
    console.log('Initiating services...')
    try {
      this.movies = new MovieService()
      this.games = new GameService()
      await this.games.initAuthToken()
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
    }

    return collections[name]
  }
}
