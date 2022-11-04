import { Collection, GatewayIntentBits } from 'discord.js'
import dotenv from 'dotenv'
import { loadCommands } from './utils/loadCommands'
import { loadEvents } from './utils/loadEvents'
import { BotClient } from './Bot'

dotenv.config()
const token: string = process.env.DISCORD_TOKEN ?? ''

const bot: BotClient = new BotClient({ intents: [GatewayIntentBits.Guilds] })
// Attach command collection to bot so that it can be accessed anywhere
bot.commands = new Collection()

loadCommands(bot)
    .then(() => loadEvents(bot))
    .then(() => bot.login(token))

process.once('exit', async () => {
  await bot.db.$disconnect()
  console.log('Exiting...')
})