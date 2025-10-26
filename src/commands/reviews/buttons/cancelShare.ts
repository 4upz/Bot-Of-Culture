import { MessageComponentInteraction } from 'discord.js'

const command = {
  data: { name: 'cancelShare' },
  execute: handleCancelShare,
}

async function handleCancelShare(interaction: MessageComponentInteraction) {
  await interaction.update({
    content: 'Share cancelled.',
    components: [],
  })
}

export default command
