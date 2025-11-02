import {
  BaseInteraction,
  ChatInputCommandInteraction,
  Events,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js'
import { BotClient } from 'src/Bot'
import { logger, LogSeverity } from '../utils/logger'

const event = {
  name: Events.InteractionCreate,
  async execute(interaction: BaseInteraction) {
    // Generate unique request ID for tracking
    const requestId = `${interaction.id}-${Date.now()}`

    // Determine command name for logging
    let commandName = 'unknown'
    if (interaction.isChatInputCommand()) {
      commandName = interaction.commandName
    } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      commandName = interaction.customId.split('_')[0]
    }

    // Start timing the request
    logger.startTimer(requestId, {
      commandName,
      userId: interaction.user.id,
      guildId: interaction.guildId || 'DM',
    })

    let command
    if (interaction.isChatInputCommand())
      command = await getChatCommandName(interaction)
    else if (interaction.isMessageComponent() || interaction.isModalSubmit())
      command = await getReplyCommand(interaction)
    else {
      logger.endTimer(requestId, { success: false, reason: 'unsupported_interaction_type' })
      return
    }

    if (!command) {
      console.error('No matching command was found.')
      logger.endTimer(requestId, { success: false, reason: 'command_not_found' }, LogSeverity.WARNING)
      return
    }

    try {
      await command.execute(interaction as ChatInputCommandInteraction)
      // Log successful command execution
      logger.endTimer(requestId, { success: true })
    } catch (error) {
      console.error(error)
      // Log failed command execution
      logger.endTimer(
        requestId,
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        LogSeverity.ERROR
      )
      await interaction.reply({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      })
    }
  },
}

async function getChatCommandName(interaction: ChatInputCommandInteraction) {
  const client = interaction.client as BotClient
  return client.commands.get(interaction.commandName)
}

async function getReplyCommand(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
) {
  const client = interaction.client as BotClient
  const buttonAction = interaction.customId.split('_')[0]
  return client.commands.get(buttonAction)
}

export default event
