import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuInteraction,
} from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'
import { createReviewEmbed, getShareQuoteCount } from './index'

export async function saveSharedReview(
  interaction: StringSelectMenuInteraction | any,
  type: ReviewType,
  mediaId: string,
  originalReview: any,
  isQuote: boolean,
  userComment?: string,
  originalMessage?: any,
) {
  const bot = interaction.client as BotClient
  const collection = bot.getCollection(type)

  const data: any = {
    userId: interaction.user.id,
    username: interaction.user.username,
    guildId: interaction.guildId,
    score: originalReview.score,
    sharedFromUserId: originalReview.userId,
    sharedFromUsername: originalReview.username,
    sharedFromComment: originalReview.comment,
    isQuote,
  }

  data[`${type}Id`] = mediaId

  if (isQuote && userComment) {
    data.comment = userComment
  } else {
    data.comment = null
  }

  // Copy type-specific fields
  if (type === 'game' && originalReview.hoursPlayed) {
    data.hoursPlayed = originalReview.hoursPlayed
  }
  if (type === 'music' && originalReview.replayability) {
    data.replayability = originalReview.replayability
  }

  try {
    // Defer with ephemeral reply for all cases
    if (interaction.deferred || interaction.replied) {
      // Already deferred or replied, we'll edit later
    } else {
      await interaction.deferReply({ ephemeral: true })
    }

    // Check if review exists and update or create
    const existingReview = await collection.findFirst({
      where: {
        userId: interaction.user.id,
        [`${type}Id`]: mediaId,
        guildId: interaction.guildId,
      },
    })

    let review
    let statusReply
    if (existingReview) {
      review = await collection.update({
        where: { id: existingReview.id },
        data,
      })
      statusReply = 'Review successfully updated!'
    } else {
      review = await collection.create({ data })
      statusReply = 'Review successfully added! 🎉'
    }

    // Fetch the media details and broadcast
    let reviewTarget
    if (type === 'movie') {
      reviewTarget = await bot.movies.getById(mediaId)
    } else if (type === 'game') {
      reviewTarget = await bot.games.getById(mediaId)
    } else if (type === 'music') {
      reviewTarget = await bot.music.getById(mediaId)
    } else {
      reviewTarget = await bot.movies.getSeriesById(mediaId)
    }

    if (!reviewTarget) {
      await interaction.editReply(
        'Sorry, could not retrieve media details for this review.',
      )
      return
    }

    if (isQuote) {
      // For quotes: Full broadcast as a new review
      if (!review.comment) {
        review.comment = '*No comment added*'
      }

      const shareQuoteCount = await getShareQuoteCount(
        type,
        mediaId,
        review.userId,
        interaction.guildId,
        bot,
      )

      const reviewInfoEmbed = createReviewEmbed(
        review,
        reviewTarget,
        interaction.user.avatarURL(),
        type,
        false,
        shareQuoteCount,
      )

      const cosignButton = new ButtonBuilder()
        .setCustomId(`cosignReview_${type}_button_${mediaId}_${review.userId}`)
        .setLabel('Co-sign')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✍️')

      const quoteButton = new ButtonBuilder()
        .setCustomId(`quoteReviewButton_${type}_button_${mediaId}_${review.userId}`)
        .setLabel('Quote')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('💬')

      const addReviewButton = new ButtonBuilder()
        .setCustomId(`addNewReview_${type}_button_${mediaId}`)
        .setLabel('Create separate review')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✨')

      const actionRow = new ActionRowBuilder().addComponents(
        cosignButton,
        quoteButton,
        addReviewButton,
      )

      const action = statusReply.includes('updated') ? 'updated' : 'created'
      await interaction.channel.send({
        content: `<@${review.userId}> just ${action} a review by quoting <@${originalReview.userId}>'s review for a${type === 'music' ? 'n album/single' : ` ${type}`}!`,
        embeds: [reviewInfoEmbed as any],
        components: [actionRow as any],
      })

      await interaction.editReply(statusReply)
    } else {
      // For co-signs: Reply to original review and update its embed
      review.comment = null

      // Reply to the original message
      if (originalMessage) {
        await originalMessage.reply({
          content: `<@${review.userId}> co-signed this review!`,
        })

        // Update the original message's embed with new share count
        const updatedShareCount = await getShareQuoteCount(
          type,
          mediaId,
          originalReview.userId,
          interaction.guildId,
          bot,
        )

        // Get the original user's avatar
        const originalUser = await bot.users.fetch(originalReview.userId)
        const updatedEmbed = createReviewEmbed(
          originalReview,
          reviewTarget,
          originalUser.avatarURL(),
          type,
          false,
          updatedShareCount,
        )

        // Keep the existing buttons
        const cosignButton = new ButtonBuilder()
          .setCustomId(
            `cosignReview_${type}_button_${mediaId}_${originalReview.userId}`,
          )
          .setLabel('Co-sign')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('✍️')

        const quoteButton = new ButtonBuilder()
          .setCustomId(
            `quoteReviewButton_${type}_button_${mediaId}_${originalReview.userId}`,
          )
          .setLabel('Quote')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('💬')

        const addReviewButton = new ButtonBuilder()
          .setCustomId(`addNewReview_${type}_button_${mediaId}`)
          .setLabel('Create separate review')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✨')

        const actionRow = new ActionRowBuilder().addComponents(
          cosignButton,
          quoteButton,
          addReviewButton,
        )

        // Update only the embed and buttons, NOT the message content
        await originalMessage.edit({
          embeds: [updatedEmbed as any],
          components: [actionRow as any],
        })
      }

      // Send ephemeral success message
      await interaction.editReply(statusReply)
    }
  } catch (error) {
    console.error('[Save Shared Review] Error:', error)
    await interaction.editReply(
      'Sorry, something went wrong with saving your review 🫣',
    )
  }
}
