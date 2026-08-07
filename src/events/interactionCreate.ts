import {
  AutocompleteInteraction,
  BaseInteraction,
  ChatInputCommandInteraction,
  Events,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js'
import { BotClient } from 'src/Bot'

const event = {
  name: Events.InteractionCreate,
  async execute(interaction: BaseInteraction) {
    if (interaction.isAutocomplete()) return handleAutocomplete(interaction)

    let command
    if (interaction.isChatInputCommand())
      command = await getChatCommandName(interaction)
    else if (interaction.isMessageComponent() || interaction.isModalSubmit())
      command = await getReplyCommand(interaction)
    else return

    if (!command) {
      console.error('No matching command was found.')
      return
    }

    try {
      await command.execute(interaction as ChatInputCommandInteraction)
    } catch (error) {
      console.error(error)
      const errorReply = {
        content: 'There was an error while executing this command!',
        ephemeral: true,
      }
      if (interaction.deferred) await interaction.editReply(errorReply)
      else if (!interaction.replied) await interaction.reply(errorReply)
    }
  },
}

async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const client = interaction.client as BotClient
  const command = client.commands.get(interaction.commandName)
  if (!command?.autocomplete) return

  try {
    await command.autocomplete(interaction)
  } catch (error) {
    console.error('[Autocomplete] Error:', error)
    // An empty suggestion list is the only safe response left at this point
    try {
      if (!interaction.responded) await interaction.respond([])
    } catch {
      // The interaction likely expired -- nothing left to respond to
    }
  }
}

async function getChatCommandName(interaction: ChatInputCommandInteraction) {
  const client = interaction.client as BotClient
  return client.commands.get(interaction.commandName)
}

async function getReplyCommand(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
) {
  const client = interaction.client as BotClient
  return client.commands.get(interaction.customId.split('_')[0])
}

export default event
