import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { BotClient } from '../../Bot'
import { getWebVisibility, publicReviewUrl, setWebVisibility } from '../../reviews/preferences'

export default {
  data: new SlashCommandBuilder()
    .setName('reviews')
    .setDescription('Open review pages or control your public web visibility')
    .addSubcommand((sub) => sub.setName('profile').setDescription('Open a global review profile')
      .addUserOption((option) => option.setName('reviewer').setDescription('Reviewer (defaults to you)')))
    .addSubcommand((sub) => sub.setName('server').setDescription('Open this server’s current-member review library'))
    .addSubcommand((sub) => sub.setName('visibility').setDescription('View or change your global web visibility')
      .addStringOption((option) => option.setName('state').setDescription('Public or hidden on all web review pages')
        .addChoices({ name: 'Public', value: 'public' }, { name: 'Hidden', value: 'hidden' }))),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true })
    const bot = interaction.client as BotClient
    try {
      const command = interaction.options.getSubcommand()
      if (command === 'visibility') {
        const state = interaction.options.getString('state')
        if (state !== null && !['public', 'hidden'].includes(state)) throw new Error('Invalid visibility')
        let isPublic: boolean
        if (state) {
          isPublic = state === 'public'
          await setWebVisibility(bot.db, interaction.user.id, isPublic)
          bot.webRevision.bump()
        } else {
          isPublic = await getWebVisibility(bot.db, interaction.user.id)
        }
        await interaction.editReply(`Your reviews are ${isPublic ? 'public' : 'hidden'} on all web review pages. Private reviews stay off the web. Existing Discord posts are unchanged.${state === 'hidden' ? ' Already loaded reviews remain visible until the page is reloaded.' : ''}`)
        return
      }
      if (command === 'server' && !interaction.guildId) {
        await interaction.editReply('Use this command inside a server to open its review library.')
        return
      }
      const id = command === 'server' ? interaction.guildId : (interaction.options.getUser('reviewer') ?? interaction.user).id
      const url = publicReviewUrl(command === 'server' ? 'guild' : 'user', id)
      await interaction.editReply(url ? `[Open ${command === 'server' ? 'server library' : 'review profile'}](${url})` : 'Web review pages are not enabled yet. You can still manage /reviews visibility.')
    } catch {
      await interaction.editReply('Review pages or visibility settings are temporarily unavailable. Please try again shortly.')
    }
  },
}
