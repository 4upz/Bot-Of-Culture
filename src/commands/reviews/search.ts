import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { replyWithResults } from './utils'
import { handleSubcommand } from '../utils/helpers'
import {
  buildMediaSubcommands,
  createMediaExecutors,
  getSelectedResultId,
  searchAutocomplete,
} from './utils/mediaSearch'
import { sendSearchResultInfo } from './utils/searchResultInfo'
import { ReviewType } from '../../utils/types'

const command = {
  data: buildMediaSubcommands(
    new SlashCommandBuilder()
      .setName('search')
      .setDescription('Search for a movie'),
    ({ subject }) => `Search for ${subject}`,
    ({ noun }) => `The title of the ${noun} you wish to search`,
  ),
  execute: (interaction: ChatInputCommandInteraction) =>
    handleSubcommand(interaction, subcommandExecutors),
  autocomplete: searchAutocomplete,
}

const subcommandExecutors = createMediaExecutors(searchMedia)

async function searchMedia(
  interaction: ChatInputCommandInteraction,
  type: ReviewType,
) {
  const targetId = getSelectedResultId(interaction)

  if (targetId) {
    await interaction.deferReply()
    await sendSearchResultInfo(interaction, type, targetId)
  } else {
    // Fall back to a manual search when free text was submitted instead of
    // an autocomplete suggestion
    await replyWithResults(interaction, `searchSelect_${type}`, '', false, type)
  }
}

export default command
