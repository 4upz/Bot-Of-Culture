import { ActivityType, Collection, GatewayIntentBits } from 'discord.js'
import { loadCommands } from './utils/loadCommands'
import { loadEvents } from './utils/loadEvents'
import { BotClient } from './Bot'
import { getSecret } from './utils/helpers'

async function initBot() {
  const token: string = await getSecret('DISCORD_TOKEN')

  const bot: BotClient = new BotClient({ intents: [GatewayIntentBits.Guilds] })
  // Attach command collection to bot so that it can be accessed anywhere
  bot.commands = new Collection()

  await loadCommands(bot)
  await loadEvents(bot)
  await bot.initDatabase()
  await bot.initServices()
  await bot.login(token)

  bot.user.setActivity('/review', {
    type: ActivityType.Watching,
  })

  process.once('exit', async () => {
    await bot.db.$disconnect()
    console.log('Exiting...')
  })
}

// Start the bot and configure services (entrypoint)
initBot()
