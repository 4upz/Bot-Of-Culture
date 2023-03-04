import { PrismaClient } from '@prisma/client'
import { Client, ClientOptions, Collection } from 'discord.js'
import MovieService from './services/MovieService'
import { ReviewType, SlashCommand } from './utils/types'
import GameService from './services/GameService'
import MusicService from './services/MusicService'

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
      this.music = new MusicService()
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
