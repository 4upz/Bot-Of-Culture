import { canDisplayReview, redactDiscordSource } from '../../../reviews/writeStore'
import {
  ChannelType,
  EmbedBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
  ThreadChannel,
} from 'discord.js'
import { createReviewEmbed, getByIdForType } from './index'
import { BotClient } from '../../../Bot'
import { getReviewsForType } from './searchResultInfo'
import { createOverviewEmbed } from './formatter'
import { MediaCommandInteraction, ReviewType } from '../../../utils/types'

type ReviewSearchParams = {
  type: string
  userId?: string
  targetId: string
  guildId: string
}

export async function getReviewForUser(
  params: ReviewSearchParams,
  interaction: MediaCommandInteraction,
) {
  const bot = interaction.client as BotClient
  const { type, userId, targetId, guildId } = params

  let review
  if (type === 'movie')
    review = await bot.db.movieReview.findFirst({
      where: { movieId: targetId, userId },
    })
  else if (type === 'game')
    review = await bot.db.gameReview.findFirst({
      where: { gameId: targetId, userId },
    })
  else if (type === 'music')
    review = await bot.db.musicReview.findFirst({
      where: { musicId: targetId, userId },
    })
  else
    review = await bot.db.seriesReview.findFirst({
      where: { seriesId: targetId, userId },
    })

  if (canDisplayReview(review, guildId)) {
    review = await redactDiscordSource(review, bot.getCollection(type as ReviewType), type as ReviewType, guildId)
    const targetInfo = await getByIdForType(type as ReviewType, targetId, bot)
    const userAvatar = await bot.users.fetch(userId).then((user) => user.avatarURL()).catch(() => '')
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
  params: ReviewSearchParams,
  interaction: MediaCommandInteraction,
) {
  const { type, targetId, guildId } = params
  const bot = interaction.client as BotClient
  const targetInfo = await getByIdForType(type as ReviewType, targetId, bot)

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

      for (const review of reviews) {
        const userAvatar = await interaction.guild.members
          .fetch(review.userId)
          .then((member) => (member ? member.user.avatarURL() : ''))
          .catch(() => '')
        reviewEmbeds.push(
          createReviewEmbed(review, targetInfo, userAvatar, type, true),
        )
      }
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

async function findThreadByName(channel: TextChannel, name: string) {
  const results = await channel.threads.fetch()
  return results.threads.find((thread) => thread.name.includes(name))
}
