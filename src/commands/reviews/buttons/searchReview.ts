import { MessageComponentInteraction } from 'discord.js'
import { BotClient } from 'src/Bot'
import { createReviewEmbed } from '../utils'

const commands = {
  data: { name: 'searchReview' },
  execute: getMovieReview,
}

async function getMovieReview(interaction: MessageComponentInteraction) {
  const bot = interaction.client as BotClient
  const params = interaction.customId.split('_')
  const type = params[1]
  const userId = params[2]
  const targetId = params[4]
  const guildId = interaction.guildId

  await interaction.deferUpdate()

  let review
  if (type === 'movie')
    review = await bot.db.movieReview.findFirst({
      where: { guildId, movieId: targetId, userId },
    })
  else if (type === 'game')
    review = await bot.db.gameReview.findFirst({
      where: { guildId, gameId: targetId, userId },
    })
  else if (type === 'music')
    review = await bot.db.musicReview.findFirst({
      where: { guildId, musicId: targetId, userId },
    })
  else
    review = await bot.db.seriesReview.findFirst({
      where: { guildId, seriesId: targetId, userId },
    })

  if (review) {
    let targetInfo
    if (type === 'movie') targetInfo = await bot.movies.getById(targetId)
    else if (type === 'game') targetInfo = await bot.games.getById(targetId)
    else if (type === 'music') targetInfo = await bot.music.getById(targetId)
    else targetInfo = await bot.movies.getSeriesById(targetId)
    const userAvatar = bot.guilds
      .resolve(guildId)
      .members.resolve(userId)
      .user.avatarURL()
    const reviewEmbed = createReviewEmbed(review, targetInfo, userAvatar, type)
    interaction.channel.send({
      content: `Review requested by <@${interaction.user.id}>`,
      embeds: [reviewEmbed as any],
    })
    await interaction.editReply({
      content: 'Review successfully found! 🤓',
      components: [],
    })
  } else {
    await interaction.editReply({
      content: `Sorry, no review of that ${type} was found for that user.`,
      components: [],
    })
  }
}

export default commands
