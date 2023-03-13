import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { replyWithResults } from './utils'
import { handleSubcommand } from '../utils/helpers'

const command = {
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Leave a new review')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('movie')
        .setDescription('Review a movie')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the movie you wish to review')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('series')
        .setDescription('Review a series')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the series you wish to review')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('game')
        .setDescription('Review a game')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the game you wish to review')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('music')
        .setDescription('Review an album/single')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the album/single you wish to review')
            .setRequired(true),
        ),
    ),
  execute: (interaction: ChatInputCommandInteraction) =>
    handleSubcommand(interaction, subcommandExecutors),
}

const subcommandExecutors = {
  movie: startMovieReview,
  series: startSeriesReview,
  game: startGameReview,
  music: startMusicReview,
}

async function startMovieReview(interaction: ChatInputCommandInteraction) {
  const commandPrefix = 'startReview_movie'
  const additionalMessage =
    '*If already reviewed, you will be updating your previous score.*'
  await replyWithResults(
    interaction,
    commandPrefix,
    additionalMessage,
    true,
    'movie',
  )
}

async function startSeriesReview(interaction: ChatInputCommandInteraction) {
  const commandPrefix = 'startReview_series'
  const additionalMessage =
    '*If already reviewed, you will be updating your previous score.*'
  await replyWithResults(
    interaction,
    commandPrefix,
    additionalMessage,
    true,
    'series',
  )
}

async function startGameReview(interaction: ChatInputCommandInteraction) {
  const commandPrefix = 'startReview_game'
  const additionalMessage =
    '*If already reviewed, you will be updating your previous score.*'
  await replyWithResults(
    interaction,
    commandPrefix,
    additionalMessage,
    true,
    'game',
  )
}

async function startMusicReview(interaction: ChatInputCommandInteraction) {
  const commandPrefix = 'startReview_music'
  const additionalMessage =
    '*If already reviewed, you will be updating your previous score.*'
  await replyWithResults(
    interaction,
    commandPrefix,
    additionalMessage,
    true,
    'music',
  )
}

export default command
