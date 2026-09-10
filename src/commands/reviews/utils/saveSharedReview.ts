import { publicReviewUrl } from '../../../reviews/preferences'
import { canDisplayReview, redactDiscordSource, rememberMediaTitle, saveGlobalReview } from '../../../reviews/writeStore'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuInteraction,
} from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType } from '../../../utils/types'
import { createReviewEmbed, getByIdForType, getShareQuoteCount } from './index'

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

  try {
    // Defer with ephemeral reply for all cases
    if (interaction.deferred || interaction.replied) {
      // Already deferred or replied, we'll edit later
    } else {
      await interaction.deferReply({ ephemeral: true })
    }

    // Recheck the source on submission: buttons/modals may outlive it.
    originalReview = await collection.findFirst({ where: { userId: originalReview.userId, [`${type}Id`]: mediaId } })
    if (!canDisplayReview(originalReview, interaction.guildId)) {
      await interaction.editReply('Sorry, the original review is no longer available here.')
      return
    }
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
    if (type === 'game') {
      data.hoursPlayed = originalReview.hoursPlayed ?? null
    }
    if (type === 'music' && originalReview.replayability) {
      data.replayability = originalReview.replayability
    }

    const result = await saveGlobalReview(collection, type, data, originalReview.isPrivate === true)
    let review = result.review
    const profileUrl = publicReviewUrl('user', interaction.user.id)
    const statusReply = result.message + (profileUrl ? ` [View your review profile](${profileUrl})` : '')
    if (originalReview.isPrivate === true) bot.webRevision.bump()
    if (!canDisplayReview(review, interaction.guildId)) {
      await interaction.editReply(`${statusReply} Your private review was not posted outside its original server.`)
      return
    }
    review = await redactDiscordSource(review, collection, type, interaction.guildId)

    // Fetch the media details and broadcast
    const reviewTarget = await getByIdForType(type, mediaId, bot)

    await rememberMediaTitle(bot.db, type, mediaId, reviewTarget)

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
        .setLabel('New review')
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
        const safeOriginalReview = await redactDiscordSource(originalReview, collection, type, interaction.guildId)
        const updatedEmbed = createReviewEmbed(
          safeOriginalReview,
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
          .setLabel('New review')
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
