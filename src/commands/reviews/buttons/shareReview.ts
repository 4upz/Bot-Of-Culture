import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageComponentInteraction,
} from 'discord.js'

const command = {
  data: { name: 'shareReview' },
  execute: handleShareReview,
}

async function handleShareReview(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const type = params[1]
  const mediaId = params[3]
  const originalUserId = params[4]

  // Prevent users from sharing their own review
  if (interaction.user.id === originalUserId) {
    await interaction.reply({
      content: 'You cannot share your own review!',
      ephemeral: true,
    })
    return
  }

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cosignReview_${type}_button_${mediaId}_${originalUserId}`)
      .setLabel('Co-sign')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✍️'),
    new ButtonBuilder()
      .setCustomId(`quoteReviewButton_${type}_button_${mediaId}_${originalUserId}`)
      .setLabel('Quote')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('💬'),
  )

  await interaction.reply({
    content: 'How would you like to add to this review?',
    components: [actionRow as any],
    ephemeral: true,
  })
}

export default command
