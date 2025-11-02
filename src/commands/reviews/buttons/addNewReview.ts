import {
  ActionRowBuilder,
  MessageComponentInteraction,
  StringSelectMenuBuilder,
} from 'discord.js'
import { ReviewType } from '../../../utils/types'
import {
  reviewChoices,
  gameReviewChoices,
  musicReviewChoices,
} from '../../utils/choices'

const command = {
  data: { name: 'addNewReview' },
  execute: handleAddNewReview,
}

async function handleAddNewReview(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const type = params[1] as ReviewType
  const mediaId = params[3]

  try {
    let choices = reviewChoices
    if (type === 'game') choices = gameReviewChoices
    if (type === 'music') choices = musicReviewChoices

    const actionRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`reviewScore_${type}_button_${mediaId}`)
        .addOptions(...(choices as any)),
    )

    await interaction.reply({
      content: `Awesome! What would you rate this ${
        type === 'music' ? 'project' : type
      }? 🤔`,
      components: [actionRow as any],
      ephemeral: true,
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
