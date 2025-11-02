import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageComponentInteraction,
} from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'
import { saveSharedReview } from './shareMode'

const command = {
  data: { name: 'cosignReview' },
  execute: handleCosignReview,
}

async function handleCosignReview(interaction: MessageComponentInteraction) {
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

    if (existingReview) {
      // Show confirmation dialog
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `confirmCosign_${type}_button_${mediaId}_${originalUserId}`,
          )
          .setLabel('Yes, replace my review')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancelShare')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      )

      await interaction.reply({
        content: `You already have a review for this ${type}. This will replace your existing review with a score of ${originalReview.score} stars. Continue?`,
        components: [actionRow as any],
        ephemeral: true,
      })
    } else {
      // No existing review, create immediately
      // Find the original message to update
      let originalMessage
      try {
        const messages = await interaction.channel.messages.fetch({ limit: 50 })
        originalMessage = messages.find((msg) => {
          const hasButton = msg.components?.some((row) =>
            row.components.some(
              (component) =>
                component.customId ===
                `cosignReview_${type}_button_${mediaId}_${originalUserId}`,
            ),
          )
          return hasButton
        })
      } catch (error) {
        console.error('[Cosign Review] Could not find original message:', error)
      }

      await saveSharedReview(
        interaction,
        type,
        mediaId,
        originalReview,
        false,
        undefined,
        originalMessage,
      )
    }
  } catch (error) {
    console.error('[Cosign Review] Error:', error)
    await interaction.reply({
      content: 'Sorry, something went wrong.',
      ephemeral: true,
    })
  }
}

export default command
