import {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js'

type GameMode = {
  name: string
  id: number
}

export type ReviewType = 'movie' | 'series' | 'game' | 'music'

export interface ActiveGame {
  id: string
  choice: string
}

export interface SlashCommand {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder
  execute: (
    interaction: ChatInputCommandInteraction | MessageComponentInteraction,
    subCommandExecutor?: SubcommandExecutors,
  ) => Promise<void>
}

export interface SubcommandExecutors {
  [key: string]: (interaction: ChatInputCommandInteraction) => Promise<void>
}

export interface IReview {
  id: string
  guildId: string
  score: number
  comment?: string
  userId: string
  username: string
  createdAt: Date
  hoursPlayed?: number
}

export interface SearchResult {
  id: string
  title: string
  description: string
  image: string
  date: string
}

export interface SeriesSearchResult extends SearchResult {
  lastAirDate: string
  episodes: string
  episodeLength: string
  seasons: string
  status: string
}

export interface GameSearchResult extends SearchResult {
  platforms: any[]
  genres: string[]
  rating: number
  ratingCount: number
  gameModes: GameMode[]
  developer: string
  publisher: string
}

export interface MusicSearchResult extends SearchResult {
  artist: string
  tracks: number
  link: string
  albumType: string
}
