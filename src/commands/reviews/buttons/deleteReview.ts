import { MessageComponentInteraction } from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'

const command = {
  data: {
    name: 'deleteReview',
  },
  execute: handleDeleteReview,
}

async function handleDeleteReview(interaction: MessageComponentInteraction) {
  const client = interaction.client as BotClient
  const params = interaction.customId.split('_')
  const type = params[1]
  const { user, guildId } = interaction
  const targetId = params[3]

  await interaction.deferUpdate()

  try {
    const collection = client.getCollection(type as ReviewType)
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
