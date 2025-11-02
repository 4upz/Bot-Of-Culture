import {
  MessageComponentInteraction,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'

const command = {
  data: { name: 'quoteReviewButton' },
  execute: handleQuoteReviewButton,
}

async function handleQuoteReviewButton(
  interaction: MessageComponentInteraction,
) {
  const params = interaction.customId.split('_')
  const type = params[1] as ReviewType
  const mediaId = params[3]
  const originalUserId = params[4]

  const bot = interaction.client as BotClient
  const collection = bot.getCollection(type)

  try {
    // Fetch the original review
    const originalReview = await collection.findFirst({
      where: {
        userId: originalUserId,
        [`${type}Id`]: mediaId,
        guildId: interaction.guildId,
      },
    })

    if (!originalReview) {
      await interaction.reply({
        content: 'Sorry, the original review could not be found.',
        ephemeral: true,
      })
      return
    }

    // Check if the current user already has a review
    const existingReview = await collection.findFirst({
      where: {
        userId: interaction.user.id,
        [`${type}Id`]: mediaId,
        guildId: interaction.guildId,
      },
    })

    // Show modal with original comment as reference
    const modal = new ModalBuilder()
      .setCustomId(`quoteReview_${type}_modal_${mediaId}_${originalUserId}`)
      .setTitle('Quote Review')

    const commentInput = new TextInputBuilder()
      .setCustomId('reviewCommentInput')
      .setLabel('Your comment')
      .setPlaceholder('Add your thoughts here...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)

    if (existingReview && existingReview.comment) {
      commentInput.setValue(existingReview.comment)
    }

    const actionRow =
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        commentInput,
      )

    modal.addComponents(actionRow)

    await interaction.showModal(modal)
  } catch (error) {
    console.error('[Quote Review Button] Error:', error)
    await interaction.reply({
      content: 'Sorry, something went wrong.',
      ephemeral: true,
    })
  }
}

export default command
