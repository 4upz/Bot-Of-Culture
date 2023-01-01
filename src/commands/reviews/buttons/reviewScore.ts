import {
  ActionRowBuilder,
  APISelectMenuOption,
  SelectMenuBuilder,
  SelectMenuInteraction,
} from 'discord.js'

const command = {
  data: { name: 'reviewScore' },
  execute: reviewScore,
}

const replyOptions: APISelectMenuOption[] = [
  {
    label: 'Yes',
    value: 'yes',
  },
  {
    label: 'No',
    value: 'no',
  },
]

async function reviewScore(interaction: SelectMenuInteraction) {
  const params = interaction.customId.split('_')
  const targetId = params[3]
  const type = params[1]
  const score = interaction.values[0]

  const actionRow = new ActionRowBuilder().addComponents(
    new SelectMenuBuilder()
      .setCustomId(`addComment_${type}_button_${targetId}_${score}`)
      .addOptions(...replyOptions),
  )

  await interaction.update({
    content:
      'Thanks for the rating! Would you like to leave a comment or additional information explaining your score?',
    components: [actionRow as any],
  })
}

export default command
