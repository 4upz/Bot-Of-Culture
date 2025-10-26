import { MessageComponentInteraction } from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'
import { saveSharedReview } from './shareMode'

const command = {
  data: { name: 'confirmShare' },
  execute: handleConfirmShare,
}

async function handleConfirmShare(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const type = params[1] as ReviewType
  const mediaId = params[3]
  const originalUserId = params[4]
  const mode = params[5] // 'exact'

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

    // Save the shared review (exact mode, not quote)
    await saveSharedReview(interaction, type, mediaId, originalReview, false)
  } catch (error) {
    console.error('[Confirm Share] Error:', error)
    await interaction.reply({
      content: 'Sorry, something went wrong.',
      ephemeral: true,
    })
  }
}

export default command
