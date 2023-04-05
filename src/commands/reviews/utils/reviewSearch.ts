import {
  ChannelType,
  EmbedBuilder,
  MessageComponentInteraction,
  TextChannel,
  ThreadAutoArchiveDuration,
  ThreadChannel,
} from 'discord.js'
import { createReviewEmbed } from './index'
import { BotClient } from '../../../Bot'
import { getReviewsForType } from '../buttons/select'
import { createOverviewEmbed } from './formatter'
import { ReviewType } from '../../../utils/types'

export async function getReviewForUser(
  params: { [key: string]: string },
  interaction: MessageComponentInteraction,
) {
  const bot = interaction.client as BotClient
  const { type, userId, targetId, guildId } = params

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
    const targetInfo = await getTargetInfo(targetId, bot, type)
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

export async function getAllReviews(
  params: { [key: string]: string },
  interaction: MessageComponentInteraction,
) {
  const { type, targetId, guildId } = params
  const bot = interaction.client as BotClient
  const targetInfo = await getTargetInfo(targetId, bot, type)

  const reviews = await getReviewsForType(type, targetId, guildId, bot)

  let statusMessage =
    'All reviews successfully found! 🤓 You can view them in the thread below.'
  if (reviews.length > 0) {
    const channel = bot.channels.cache.get(interaction.channelId)
    const reviewEmbeds: EmbedBuilder[] = []

    let thread: ThreadChannel

    await createOverviewEmbed(targetInfo, reviews, type as ReviewType).then(
      (embed) => reviewEmbeds.push(embed),
    )

    if (channel.type === ChannelType.GuildText) {
      // Check and make sure there isn't an existing thread. If there is, send the reviews there.
      thread = await findThreadByName(channel, `${targetInfo.title} Reviews`)
      if (thread) {
        if (thread.archived) await thread.setArchived(false)
        await thread.send(
          `--------------------------------------------------\nNew Reviews requested by <@${interaction.user.id}>`,
        )
        await channel.send(
          `A new list of reviews have been added to <#${thread.id}> as requested by <@${interaction.user.id}>!`,
        )
      } else {
        // Create thread, attach it to notification message, and send all reviews
        const startMessage = await channel.send(
          `${targetInfo.title} Reviews requested by <@${interaction.user.id}>`,
        )
        thread = await channel.threads.create({
          startMessage,
          name: `${targetInfo.title} Reviews`,
          autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
          reason: `Server Reviews for ${targetInfo.title} requested by <@${interaction.user.id}>. This will auto-archive after one day of inactivity.`,
        })
      }

      reviews.forEach((review) => {
        const userAvatar = bot.users.resolve(review.userId)?.avatarURL() || ''
        reviewEmbeds.push(
          createReviewEmbed(review, targetInfo, userAvatar, type, true),
        )
      })
      thread.send({ embeds: reviewEmbeds })
    } else {
      // Currently only support channels where threads can be created
      await interaction.editReply({
        content:
          'Sorry, reviews can only be sent in a server text channel. Please try again in a valid channel.',
        components: [],
      })
    }
  } else {
    statusMessage = `Sorry, no review for that ${type} has been created yet.`
  }

  await interaction.editReply({
    content: statusMessage,
    components: [],
  })

  return reviews
}

async function getTargetInfo(targetId: string, bot: BotClient, type: string) {
  let targetInfo
  if (type === 'movie') targetInfo = await bot.movies.getById(targetId)
  else if (type === 'game') targetInfo = await bot.games.getById(targetId)
  else if (type === 'music') targetInfo = await bot.music.getById(targetId)
  else targetInfo = await bot.movies.getSeriesById(targetId)

  return targetInfo
}

async function findThreadByName(channel: TextChannel, name: string) {
  const results = await channel.threads.fetch()
  return results.threads.find((thread) => thread.name.includes(name))
}
