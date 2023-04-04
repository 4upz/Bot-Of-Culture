import { MessageComponentInteraction } from 'discord.js'
import { getAllReviews, getReviewForUser } from '../utils/reviewSearch'

const commands = {
  data: { name: 'searchReview' },
  execute: searchReview,
}

async function searchReview(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const type = params[1]
  const userId = params[2]
  const targetId = params[4]
  const guildId = interaction.guildId

  await interaction.deferUpdate()

  const userParams = { type, userId, targetId, guildId }

  if (userId !== 'undefined') await getReviewForUser(userParams, interaction)
  else await getAllReviews(userParams, interaction)
}

export default commands
