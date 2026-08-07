import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { replyWithResults } from './utils'
import { handleSubcommand } from '../utils/helpers'
import {
  buildMediaSubcommands,
  createMediaExecutors,
  getSelectedResultId,
  searchAutocomplete,
} from './utils/mediaSearch'
import { getAllReviews, getReviewForUser } from './utils/reviewSearch'
import { ReviewType } from '../../utils/types'

const command = {
  data: buildMediaSubcommands(
    new SlashCommandBuilder()
      .setName('show-review')
      .setDescription('Show a review for yourself or a user'),
    ({ subject }) => `Show a review for ${subject}`,
    ({ noun }) => `The title of the ${noun} you wish to see a review for`,
    (subcommand) =>
      subcommand.addUserOption((option) =>
        option
          .setName('reviewer')
          .setDescription('The user that created the review.'),
      ),
  ),
  execute: (interaction: ChatInputCommandInteraction) =>
    handleSubcommand(interaction, subcommandExecutors),
  autocomplete: searchAutocomplete,
}

const subcommandExecutors = createMediaExecutors(searchReview)

async function searchReview(
  interaction: ChatInputCommandInteraction,
  type: ReviewType,
) {
  const reviewerId = interaction.options.getUser('reviewer')?.id
  const targetId = getSelectedResultId(interaction)

  if (targetId) {
    await interaction.deferReply({ ephemeral: true })
    const params = {
      type,
      userId: reviewerId,
      targetId,
      guildId: interaction.guildId,
    }
    if (reviewerId) await getReviewForUser(params, interaction)
    else await getAllReviews(params, interaction)
  } else {
    // Fall back to a manual search when free text was submitted instead of
    // an autocomplete suggestion
    await replyWithResults(
      interaction,
      `searchReview_${type}_${reviewerId}`,
      '',
      true,
      type,
    )
  }
}

export default command
