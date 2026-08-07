import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { replyWithResults, sendReviewScorePrompt } from './utils'
import { handleSubcommand } from '../utils/helpers'
import {
  buildMediaSubcommands,
  createMediaExecutors,
  getSelectedResultId,
  searchAutocomplete,
} from './utils/mediaSearch'
import { ReviewType } from '../../utils/types'

const UPDATE_NOTE =
  '*If already reviewed, you will be updating your previous score.*'

const command = {
  data: buildMediaSubcommands(
    new SlashCommandBuilder()
      .setName('review')
      .setDescription('Leave a new review'),
    ({ subject }) => `Review ${subject}`,
    ({ noun }) => `The title of the ${noun} you wish to review`,
  ),
  execute: (interaction: ChatInputCommandInteraction) =>
    handleSubcommand(interaction, subcommandExecutors),
  autocomplete: searchAutocomplete,
}

const subcommandExecutors = createMediaExecutors(startMediaReview)

async function startMediaReview(
  interaction: ChatInputCommandInteraction,
  type: ReviewType,
) {
  const targetId = getSelectedResultId(interaction)

  if (targetId)
    await sendReviewScorePrompt(interaction, type, targetId, {
      note: UPDATE_NOTE,
    })
  // Fall back to a manual search when free text was submitted instead of
  // an autocomplete suggestion
  else
    await replyWithResults(
      interaction,
      `startReview_${type}`,
      UPDATE_NOTE,
      true,
      type,
    )
}

export default command
