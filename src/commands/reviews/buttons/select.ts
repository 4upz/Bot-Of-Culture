import { MessageComponentInteraction } from 'discord.js'
import { sendSearchResultInfo } from '../utils/searchResultInfo'
import { ReviewType } from '../../../utils/types'

const command = {
  data: { name: 'searchSelect' },
  execute: getSearchResultInfo,
}

async function getSearchResultInfo(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const id = params[3]
  const resultType = params[1] as ReviewType

  await interaction.deferUpdate()
  await sendSearchResultInfo(interaction, resultType, id)
}

export default command
