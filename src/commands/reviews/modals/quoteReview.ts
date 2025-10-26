import { ModalSubmitInteraction } from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'
import { saveSharedReview } from '../buttons/shareMode'

const command = {
  data: { name: 'quoteReview' },
  execute: handleQuoteReview,
}

async function handleQuoteReview(interaction: ModalSubmitInteraction) {
  const params = interaction.customId.split('_')
  const type = params[1] as ReviewType
  const mediaId = params[3]
  const originalUserId = params[4]

  const bot = interaction.client as BotClient
  const collection = bot.getCollection(type)

  try {
    // Get the user's comment from the modal
    const userComment = interaction.fields.getTextInputValue(
      'reviewCommentInput',
    )

    if (!userComment || userComment.trim() === '') {
      await interaction.reply({
        content: 'Please provide a comment for your quoted review.',
        ephemeral: true,
      })
      return
    }

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

    // Save as quote review (isQuote = true)
    await saveSharedReview(
      interaction,
      type,
      mediaId,
      originalReview,
      true,
      userComment,
    )
  } catch (error) {
    console.error('[Quote Review Modal] Error:', error)
    await interaction.reply({
      content: 'Sorry, something went wrong with saving your review 🫣',
      ephemeral: true,
    })
  }
}

export default command
