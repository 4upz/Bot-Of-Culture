import { ActivityType, Collection, GatewayIntentBits } from 'discord.js'
import { loadCommands } from './utils/loadCommands'
import { loadEvents } from './utils/loadEvents'
import { BotClient } from './Bot'
import { MembershipService } from './web/membership'
import { createWebApp } from './web/server'
import { getSecret } from './utils/helpers'

async function initBot() {
  const webEnabled = process.env.WEB_ENABLED === 'true'
  if (process.env.REVIEW_MIGRATION_READY !== 'true')
    throw new Error(
      'This release requires verified global review migration readiness',
    )
  const port = Number(process.env.PORT || 8080)
  if (webEnabled && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('Invalid PORT')
  if (webEnabled) {
    let base: URL
    try {
      base = new URL(process.env.PUBLIC_WEB_BASE_URL || '')
    } catch {
      throw new Error('PUBLIC_WEB_BASE_URL is required')
    }
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.pathname !== '/'
    )
      throw new Error(
        'PUBLIC_WEB_BASE_URL must be an HTTP(S) origin without credentials or a path',
      )
  }
  const token: string = await getSecret('DISCORD_TOKEN')
  const bot: BotClient = new BotClient({
    intents: [
      GatewayIntentBits.Guilds,
      ...(webEnabled ? [GatewayIntentBits.GuildMembers] : []),
    ],
  })
  // Attach command collection to bot so that it can be accessed anywhere
  bot.commands = new Collection()

  await loadCommands(bot)
  await loadEvents(bot)
  await bot.initDatabase()
  await bot.initServices()
  bot.reviewMembership = new MembershipService(bot)
  if (webEnabled) bot.reviewMembership.start()
  // Build (and validate the configuration of) the web app before login so a
  // bad REVIEW_WEB_TRUSTED_PROXY_IPS cannot leave a logged-in bot without a
  // listener and without a shutdown path.
  const web = webEnabled
    ? createWebApp(bot, bot.reviewMembership, bot.webRevision)
    : null
  await bot.login(token)

  bot.user.setActivity('/review', {
    type: ActivityType.Watching,
  })

  const server = web?.app.listen(port, () =>
    console.log(`Review web listening on ${port}`),
  )
  const shutdown = async () => {
    web?.close()
    bot.reviewMembership.stop()
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    bot.destroy()
    await bot.db.$disconnect()
  }
  server?.on('error', () => {
    console.error('Review HTTP listener failed')
    process.exitCode = 1
    void shutdown()
  })
  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })
}

// Start the bot and configure services (entrypoint)
initBot().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
