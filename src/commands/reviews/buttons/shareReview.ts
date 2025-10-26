import {
  ActionRowBuilder,
  MessageComponentInteraction,
  SelectMenuBuilder,
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
    new SelectMenuBuilder()
      .setCustomId(`shareMode_${type}_select_${mediaId}_${originalUserId}`)
      .setPlaceholder('Choose how to share this review')
      .addOptions([
        {
          label: 'Share Score',
          description: 'Add this exact score to your review',
          value: 'exact',
          emoji: '👍',
        },
        {
          label: 'Quote Review',
          description: 'Share score and add your own comment',
          value: 'quote',
          emoji: '💬',
        },
      ]),
  )

  await interaction.reply({
    content: 'How would you like to share this review?',
    components: [actionRow as any],
    ephemeral: true,
  })
}

export default command
