import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { replyWithResults } from './utils'
import { handleSubcommand } from '../utils/helpers'
import {
  buildMediaSubcommands,
  createMediaExecutors,
  getSelectedResultId,
  searchAutocomplete,
} from './utils/mediaSearch'
import { deleteReviewForTarget } from './buttons/deleteReview'
import { ReviewType } from '../../utils/types'

const command = {
  data: buildMediaSubcommands(
    new SlashCommandBuilder()
      .setName('delete-review')
      .setDescription('Delete a previous review'),
    ({ subject }) => `Delete review for ${subject}`,
    ({ noun }) => `The title of the ${noun} you reviewed`,
  ),
  execute: (interaction: ChatInputCommandInteraction) =>
    handleSubcommand(interaction, subcommandExecutors),
  autocomplete: searchAutocomplete,
}

const subcommandExecutors = createMediaExecutors(deleteMediaReview)

async function deleteMediaReview(
  interaction: ChatInputCommandInteraction,
  type: ReviewType,
) {
  const targetId = getSelectedResultId(interaction)

  if (targetId) {
    await interaction.deferReply({ ephemeral: true })
    await deleteReviewForTarget(interaction, type, targetId)
  } else {
    // Fall back to a manual search when free text was submitted instead of
    // an autocomplete suggestion
    await replyWithResults(interaction, `deleteReview_${type}`, '', true, type)
  }
}

export default command
