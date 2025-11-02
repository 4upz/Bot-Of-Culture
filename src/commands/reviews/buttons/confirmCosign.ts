import { MessageComponentInteraction } from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'
import { saveSharedReview } from './shareMode'

const command = {
  data: { name: 'confirmCosign' },
  execute: handleConfirmCosign,
}

async function handleConfirmCosign(interaction: MessageComponentInteraction) {
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

    // Find the original review message in the channel
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
      console.error('[Confirm Cosign] Could not find original message:', error)
    }

    // Save the co-signed review
    await saveSharedReview(
      interaction,
      type,
      mediaId,
      originalReview,
      false,
      undefined,
      originalMessage,
    )
  } catch (error) {
    console.error('[Confirm Cosign] Error:', error)
    await interaction.reply({
      content: 'Sorry, something went wrong.',
      ephemeral: true,
    })
  }
}

export default command
