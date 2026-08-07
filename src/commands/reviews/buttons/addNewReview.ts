import { MessageComponentInteraction } from 'discord.js'
import { ReviewType } from '../../../utils/types'
import { sendReviewScorePrompt } from '../utils'

const command = {
  data: { name: 'addNewReview' },
  execute: handleAddNewReview,
}

async function handleAddNewReview(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const type = params[1] as ReviewType
  const mediaId = params[3]

  try {
    await sendReviewScorePrompt(interaction, type, mediaId, {
      asNewReply: true,
    })
  } catch (error) {
    console.error('[Add New Review] Error:', error)
    await interaction.reply({
      content: 'Sorry, something went wrong while opening the review form.',
      ephemeral: true,
    })
  }
}

export default command
