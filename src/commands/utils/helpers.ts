import { ChatInputCommandInteraction } from 'discord.js'
import { SubcommandExecutors } from '../../utils/types'

export async function handleSubcommand(
  interaction: ChatInputCommandInteraction,
  subcommandExecutors: SubcommandExecutors,
) {
  const subcommand = interaction.options.getSubcommand()
  const subcommandHandler = subcommandExecutors[subcommand]
  if (subcommandHandler)
    try {
      await subcommandHandler(interaction)
    } catch (error) {
      console.log(error.message)
      const errorReply = {
        content: 'Something went wrong! Please try again later.',
        ephemeral: true,
      }
      if (interaction.deferred) await interaction.editReply(errorReply)
      else if (!interaction.replied) await interaction.reply(errorReply)
    }
  else
    await interaction.reply({
      content: 'Sorry, something went wrong executing that subcommand!',
      ephemeral: true,
    })
}
