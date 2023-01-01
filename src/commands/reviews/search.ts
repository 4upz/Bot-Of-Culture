import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { replyWithResults } from './utils'
import { handleSubcommand } from '../utils/helpers'

const command = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a movie')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('movie')
        .setDescription('Search for a movie')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the movie you wish to search')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('series')
        .setDescription('Search for a series')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the series you wish to search')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('game')
        .setDescription('Search for a game')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the game you wish to search')
            .setRequired(true),
        ),
    ),
  execute: (interaction: ChatInputCommandInteraction) => {
    handleSubcommand(interaction, subcommandExecutors)
  },
}

const subcommandExecutors = {
  movie: searchMovie,
  series: searchSeries,
  game: searchGames,
}

async function searchMovie(interaction: ChatInputCommandInteraction) {
  const commandPrefix = 'searchSelect_movie'
  await replyWithResults(interaction, commandPrefix, '', false, 'movie')
}

async function searchSeries(interaction: ChatInputCommandInteraction) {
  const commandPrefix = 'searchSelect_series'
  await replyWithResults(interaction, commandPrefix, '', false, 'series')
}

async function searchGames(interaction: ChatInputCommandInteraction) {
  const commandPrefix = 'searchSelect_game'
  await replyWithResults(interaction, commandPrefix, '', false, 'game')
}

export default command
