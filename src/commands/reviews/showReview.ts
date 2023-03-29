import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { replyWithResults } from './utils'
import { handleSubcommand } from '../utils/helpers'
import { ReviewType } from '../../utils/types'

const commands = {
  data: new SlashCommandBuilder()
    .setName('show-review')
    .setDescription('Show a review for yourself or a user')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('movie')
        .setDescription('Show a review for a movie')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription(
              'The title of the movie you wish to see a review for.',
            )
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('reviewer')
            .setDescription('The user that created the review.'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('series')
        .setDescription('Show a review for a series')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the series you wish to see.')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('reviewer')
            .setDescription('The user that created the review.'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('game')
        .setDescription('Show a review for a game')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the game you wish to see.')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('reviewer')
            .setDescription('The user that created the review.'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('music')
        .setDescription('Show a review for an album/single')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('The title of the album/single you wish to see.')
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName('reviewer')
            .setDescription('The user that created the review.'),
        ),
    ),
  execute: (interaction: ChatInputCommandInteraction) =>
    handleSubcommand(interaction, subcommandExecutors),
}

const subcommandExecutors = {
  movie: (interaction: ChatInputCommandInteraction) =>
    searchReview(interaction, 'movie'),
  series: (interaction: ChatInputCommandInteraction) =>
    searchReview(interaction, 'series'),
  game: (interaction: ChatInputCommandInteraction) =>
    searchReview(interaction, 'game'),
  music: (interaction: ChatInputCommandInteraction) =>
    searchReview(interaction, 'music'),
}

async function searchReview(
  interaction: ChatInputCommandInteraction,
  type: ReviewType,
) {
  const user = interaction.options.getUser('reviewer')?.id
  await replyWithResults(
    interaction,
    `searchReview_${type}_${user}`,
    '',
    true,
    type,
  )
}

export default commands
