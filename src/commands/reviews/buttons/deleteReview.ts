import { MessageComponentInteraction } from 'discord.js'
import { BotClient } from '../../../Bot'
import { MediaCommandInteraction, ReviewType } from '../../../utils/types'

const command = {
  data: {
    name: 'deleteReview',
  },
  execute: handleDeleteReview,
}

async function handleDeleteReview(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const type = params[1] as ReviewType
  const targetId = params[3]

  await interaction.deferUpdate()
  await deleteReviewForTarget(interaction, type, targetId)
}

/**
 * Deletes the user's review for the given target if one exists. Expects an
 * interaction that has already been deferred
 */
export async function deleteReviewForTarget(
  interaction: MediaCommandInteraction,
  type: ReviewType,
  targetId: string,
) {
  const client = interaction.client as BotClient
  const { user, guildId } = interaction

  try {
    const collection = client.getCollection(type)
    if (!collection) throw new Error('Invalid collection name')
    // Grab id of review document if it exists
    const review = await (<any>collection).findFirst({
      where: { [`${type}Id`]: targetId, userId: user.id, guildId: guildId },
    })
    if (review) {
      await (<any>collection).delete({ where: { id: review.id } })
      await interaction.editReply({
        content: `Your review for that ${type} was successfully deleted! 🎉`,
        components: [],
      })
    } else {
      await interaction.editReply({
        content: `Sorry, you do not have a review that exists for that ${type}. 🤷🏽‍`,
        components: [],
      })
    }
  } catch (error) {
    console.log(error)
    await interaction.editReply({
      content:
        'Sorry, something went wrong deleting your review. Please try again later. 🫣',
      components: [],
    })
  }
}

export default command
