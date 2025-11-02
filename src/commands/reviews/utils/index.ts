import {
  ActionRowBuilder,
  AnyComponentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageComponentInteraction,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import dayjs from 'dayjs'
import {
  GameReview,
  MovieReview,
  MusicReview,
  Prisma,
  Replayability,
  SeriesReview,
} from '@prisma/client'
import {
  gameReviewChoices,
  musicReviewChoices,
  reviewChoices,
} from '../../utils/choices'
import { BotClient } from '../../../Bot'
import {
  IReview,
  MusicSearchResult,
  ReviewType,
  SearchResult,
} from '../../../utils/types'
import { toNormalDate } from '../../../utils/helpers'

type ReviewCreateResult = {
  message: string
  review: MovieReview | SeriesReview
}

async function saveMovieReview(
  data: Prisma.MovieReviewCreateInput,
  bot: BotClient,
): Promise<ReviewCreateResult> {
  let review = await bot.db.movieReview.findFirst({
    where: {
      userId: data.userId,
      movieId: data.movieId,
      guildId: data.guildId,
    },
  })

  if (review) {
    review = await bot.db.movieReview.update({
      where: { id: review.id },
      data,
    })
    return { review, message: 'Review successfully updated!' }
  } else {
    review = await bot.db.movieReview.create({ data })
    return {
      review: review as MovieReview,
      message: 'Review successfully added! 🎉',
    }
  }
}

async function saveSeriesReview(
  data: Prisma.SeriesReviewCreateInput,
  bot: BotClient,
): Promise<ReviewCreateResult> {
  let review = await bot.db.seriesReview.findFirst({
    where: {
      userId: data.userId,
      seriesId: data.seriesId,
      guildId: data.guildId,
    },
  })

  if (review) {
    review = await bot.db.seriesReview.update({
      where: { id: review.id },
      data,
    })
    return { review, message: 'Review successfully updated!' }
  } else {
    review = await bot.db.seriesReview.create({ data })
    return {
      review: review as SeriesReview,
      message: 'Review successfully added! 🎉',
    }
  }
}

async function saveGameReview(
  data: Prisma.GameReviewCreateInput,
  bot: BotClient,
) {
  let review = await bot.db.gameReview.findFirst({
    where: {
      userId: data.userId,
      gameId: data.gameId,
      guildId: data.guildId,
    },
  })

  if (review) {
    review = await bot.db.gameReview.update({
      where: { id: review.id },
      data,
    })
    return { review, message: 'Review successfully updated!' }
  } else {
    review = await bot.db.gameReview.create({ data })
    return {
      review: review as GameReview,
      message: 'Review successfully added! 🎉',
    }
  }
}

async function saveMusicReview(
  data: Prisma.MusicReviewCreateInput,
  bot: BotClient,
) {
  let review = await bot.db.musicReview.findFirst({
    where: {
      userId: data.userId,
      musicId: data.musicId,
      guildId: data.guildId,
    },
  })

  if (review) {
    review = await bot.db.musicReview.update({
      where: { id: review.id },
      data,
    })
    return { review, message: 'Review successfully updated!' }
  } else {
    review = await bot.db.musicReview.create({ data })
    return {
      review: review as MusicReview,
      message: 'Review successfully added! 🎉',
    }
  }
}

async function getSearchResultsForType(
  type: ReviewType,
  query: string,
  bot: BotClient,
) {
  if (type === 'movie') return await bot.movies.search(query)
  else if (type === 'series') return await bot.movies.searchSeries(query)
  else if (type === 'music') return await bot.music.search(query)
  else return await bot.games.search(query)
}

export async function promptReview(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const targetId = params[3]
  const type = params[1]

  try {
    let choices = reviewChoices
    if (type === 'game') choices = gameReviewChoices
    if (type === 'music') choices = musicReviewChoices
    const actionRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`reviewScore_${type}_button_${targetId}`)
        .addOptions(...(choices as any)),
    )
    await interaction.update({
      content: `Awesome! What would you rate this ${
        type === 'music' ? 'project' : type
      }? 🤔`,
      components: [actionRow as any],
    })
  } catch (error) {
    console.error(error)
  }
}

export async function promptReviewComment(interaction: StringSelectMenuInteraction) {
  const params = interaction.customId.split('_')
  const targetId = params[3]
  const reviewScore = params[4]
  const type = params[1]

  // Check if there is existing review for editing
  const bot = interaction.client as BotClient
  const existingReview = await bot
    .getCollection(type as ReviewType)
    .findFirst({
      where: {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        [`${type}Id`]: targetId,
      },
    })
    .catch((error: Error) => {
      console.error(
        '[Review Comment] Something went wrong fetching existing review. Error',
        error.message,
      )
    })

  let commentInput = new TextInputBuilder()
    .setCustomId('reviewCommentInput')
    .setLabel(`What did you think of the ${type}?`)
    .setPlaceholder('Enter reasons behind your rating here!')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)

  if (existingReview && existingReview.comment)
    commentInput = commentInput.setValue(existingReview.comment)

  const actionRow =
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      commentInput,
    )

  const modal = new ModalBuilder()
    .setCustomId(`reviewComment_${type}_modal_${targetId}_${reviewScore}`)
    .setTitle('Review Comment')
    .addComponents(actionRow)

  if (type === 'game') {
    // Add option for hours input
    let hoursPlayedInput = new TextInputBuilder()
      .setCustomId('reviewHoursInput')
      .setLabel('How many hours did you play? (optional)')
      .setMaxLength(3)
      .setPlaceholder('20')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)

    if (existingReview && existingReview.hoursPlayed !== null)
      hoursPlayedInput = hoursPlayedInput.setValue(String(existingReview.hoursPlayed))

    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        hoursPlayedInput,
      ),
    )
  }

  if (type === 'music') {
    // Add option for replayability input
    let replayabilityInput = new TextInputBuilder()
      .setCustomId('reviewReplayabilityInput')
      .setLabel('How replayable is it? (optional)')
      .setMaxLength(6)
      .setPlaceholder('Low/Medium/High')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)

    if (existingReview)
      replayabilityInput = replayabilityInput.setValue(
        existingReview.replayability,
      )

    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        replayabilityInput,
      ),
    )
  }

  await interaction.showModal(modal)
  await interaction.deleteReply()
}

export async function saveReview(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction,
) {
  let comment
  const params = interaction.customId.split('_')
  const type = params[1]
  const bot = interaction.client as BotClient

  await interaction.deferReply({ ephemeral: true })

  if (interaction.isModalSubmit())
    comment = interaction.fields.getTextInputValue('reviewCommentInput')

  const data: { [key: string]: string | number } = {
    userId: interaction.user.id,
    username: interaction.user.username,
    guildId: interaction.guildId,
    score: parseInt(params[4]),
    comment,
  }

  // Assign ID key by asserting from type
  data[`${type}Id`] = params[3]

  // Assign optional hours input for game reviews
  if (type === 'game' && interaction.isModalSubmit()) {
    const hoursPlayed = interaction.fields.getTextInputValue('reviewHoursInput')
    data.hoursPlayed = parseInt(hoursPlayed) || 0
  }

  if (type === 'music' && interaction.isModalSubmit()) {
    const replayability = interaction.fields.getTextInputValue(
      'reviewReplayabilityInput',
    )
    // Assign optional replayability input if valid and exists
    if (
      replayability &&
      ['low', 'medium', 'high'].includes(replayability.toLowerCase())
    )
      data.replayability = replayability.toUpperCase() as Replayability
  }

  try {
    let reviewTarget, review, statusReply

    if (type === 'movie') {
      const result = await saveMovieReview(
        data as unknown as Prisma.MovieReviewCreateInput,
        bot,
      )
      review = result.review
      statusReply = result.message
      reviewTarget = await bot.movies.getById(data.movieId.toString())
    } else if (type === 'game') {
      const result = await saveGameReview(
        data as unknown as Prisma.GameReviewCreateInput,
        bot,
      )
      review = result.review
      statusReply = result.message
      reviewTarget = await bot.games.getById(data.gameId.toString())
    } else if (type === 'music') {
      const result = await saveMusicReview(
        data as unknown as Prisma.MusicReviewCreateInput,
        bot,
      )
      review = result.review
      statusReply = result.message
      reviewTarget = await bot.music.getById(data.musicId.toString())
    } else {
      const result = await saveSeriesReview(
        data as unknown as Prisma.SeriesReviewCreateInput,
        bot,
      )
      review = result.review
      statusReply = result.message
      reviewTarget = await bot.movies.getSeriesById(data.seriesId.toString())
    }

    if (!comment) review.comment = '*No comment added*'

    // Calculate share/quote count for this review
    const shareQuoteCount = await getShareQuoteCount(
      type as ReviewType,
      data[`${type}Id`].toString(),
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

    // Add Co-sign, Quote, and New review buttons to the broadcast
    const cosignButton = new ButtonBuilder()
      .setCustomId(`cosignReview_${type}_button_${data[`${type}Id`]}_${review.userId}`)
      .setLabel('Co-sign')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✍️')

    const quoteButton = new ButtonBuilder()
      .setCustomId(`quoteReviewButton_${type}_button_${data[`${type}Id`]}_${review.userId}`)
      .setLabel('Quote')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('💬')

    const addReviewButton = new ButtonBuilder()
      .setCustomId(`addNewReview_${type}_button_${data[`${type}Id`]}`)
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
      content: `<@${review.userId}> just ${action} a review for a${
        type === 'music' ? 'n album/single' : ` ${type}`
      }!`,
      embeds: [reviewInfoEmbed as any],
      components: [actionRow as any],
    })

    await interaction.editReply(statusReply)
  } catch (error) {
    console.error(error)
    await interaction.editReply(
      'Sorry, something went wrong with saving your review 🫣',
    )
  }
}

export async function replyWithResults(
  interaction: ChatInputCommandInteraction,
  customIdPrefix: string,
  additionalMessage: string,
  isEphemeral: boolean,
  type: ReviewType,
) {
  const bot = interaction.client as BotClient
  const query = interaction.options.getString('title')
  const results = await getSearchResultsForType(type, query, bot)

  if (results.length) {
    const actionRow: ActionRowBuilder<AnyComponentBuilder> =
      new ActionRowBuilder().addComponents(
        results.map((result) => {
          let { title, date } = result
          if (title.length > 73) title = `${title.substring(0, 69)}...`

          date = date ? dayjs(date).format('YYYY') : 'Date N/A'
          const details =
            type === 'music'
              ? `${(<MusicSearchResult>result).artist}, ${date}`
              : date

          return new ButtonBuilder()
            .setCustomId(`${customIdPrefix}_button_${result.id}`)
            .setLabel(`${title} (${details})`)
            .setStyle(ButtonStyle.Success)
        }),
      )

    const comment = additionalMessage || ''
    const emoji = {
      movie: '🎬',
      series: '📺',
      game: '🎮',
      music: '🎵',
    }
    await interaction.reply({
      content:
        `Please select a result or try another search. ${emoji[type]}\n ` +
        comment,
      components: [actionRow as any],
      ephemeral: isEphemeral,
    })
  } else {
    await interaction.reply({
      content:
        'Sorry, there were no results matching your search. 😔 Please try again.',
      ephemeral: true,
    })
  }
}

export function convertScoreToStars(
  score: number,
  count?: number,
  type?: string,
) {
  const suffix = count ? ` (${count})` : ''
  let choices = reviewChoices
  if (type === 'game') choices = gameReviewChoices
  else if (type === 'music') choices = musicReviewChoices
  return (
    '⭐️'.repeat(score) +
    '▪️'.repeat(5 - score) +
    ` | *${choices[score - 1].description}*` +
    suffix
  )
}

export function createReviewEmbed(
  review: IReview,
  reviewTarget: SearchResult,
  avatar: string,
  type: string,
  truncated?: boolean,
  shareQuoteCount?: { shareCount: number; quoteCount: number; total: number },
) {
  // If no avatar is provided, use the default Discord avatar
  const userAvatar = avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'

  const formattedScore = `${convertScoreToStars(review.score, undefined, type)}`
  const description = truncateByMaxLength(reviewTarget.description, 1024)
  const embed = new EmbedBuilder()
    .setColor('#01b4e4')
    .setAuthor({
      name: review.username,
      iconURL: userAvatar,
    })

  // Only set description if there's a comment
  if (review.comment) {
    embed.setDescription(review.comment)
  }

  if (type === 'game')
    embed.addFields([
      {
        name: 'Hours Played',
        value: (<GameReview>review).hoursPlayed?.toString() || 'N/A',
        inline: true,
      },
    ])

  if (type === 'music') {
    embed.addFields([
      {
        name: 'Replayability',
        value: (<MusicReview>review).replayability?.toString() || 'N/A',
        inline: true,
      },
    ])
    if (!truncated) {
      embed.setURL((<MusicSearchResult>reviewTarget).link)
    }
  }

  embed.addFields([{ name: 'Score', value: formattedScore }])

  // Add attribution field if this review was shared or quoted
  if ((review as any).sharedFromUserId) {
    const shareType = (review as any).isQuote ? 'Quoted' : 'Shared'
    let attributionText = `${shareType} from <@${(review as any).sharedFromUserId}>'s review`

    // For quoted reviews, show the original comment
    if ((review as any).isQuote && (review as any).sharedFromComment) {
      attributionText += `\n\n*"${(review as any).sharedFromComment}"*`
    }

    embed.addFields([
      {
        name: shareType === 'Quoted' ? '💬 Quoted From' : '👍 Shared From',
        value: attributionText,
        inline: false,
      },
    ])
  }

  // Add share/quote count to footer if this is an original review that others have shared
  if (shareQuoteCount && shareQuoteCount.total > 0) {
    const countParts = []
    if (shareQuoteCount.shareCount > 0) {
      countParts.push(
        `${shareQuoteCount.shareCount} share${shareQuoteCount.shareCount !== 1 ? 's' : ''}`,
      )
    }
    if (shareQuoteCount.quoteCount > 0) {
      countParts.push(
        `${shareQuoteCount.quoteCount} quote${shareQuoteCount.quoteCount !== 1 ? 's' : ''}`,
      )
    }

    const shareText = `📊 ${countParts.join(' • ')}`

    // For music reviews, append to existing footer; for others, set as footer
    if (type === 'music' && !truncated) {
      embed.setFooter({
        text: `Click to open the title on Spotify | ${shareText}`,
        iconURL:
          'https://developer.spotify.com/assets/branding-guidelines/icon3@2x.png',
      })
    } else {
      embed.setFooter({
        text: shareText,
      })
    }
  }

  // We only show these extra details when not using the truncated (shortened) embed
  if (!truncated)
    embed
      .setTitle(`*"${reviewTarget.title}"* review by ${review.username}`)
      .setImage(reviewTarget.image)
      .addFields([
        {
          name: 'Release Date',
          value: toNormalDate(reviewTarget.date),
          inline: true,
        },
        {
          name: 'Description',
          value: description,
          inline: true,
        },
      ])

  // Add Spotify footer for music reviews if no share count was added
  if (type === 'music' && !truncated && (!shareQuoteCount || shareQuoteCount.total === 0)) {
    embed.setFooter({
      text: 'Click to open the title on Spotify',
      iconURL:
        'https://developer.spotify.com/assets/branding-guidelines/icon3@2x.png',
    })
  }

  return embed
}

export function convertToNameListString(objectArr: any[]) {
  if (objectArr?.length) return objectArr.map((obj: any) => obj.name).join(', ')
  return 'N/A'
}

export function truncateByMaxLength(description: string, maxLength: number) {
  if (description.length > maxLength)
    return description.substring(0, maxLength - 3) + '...'
  return description
}

export async function getShareQuoteCount(
  type: ReviewType,
  mediaId: string,
  userId: string,
  guildId: string,
  bot: BotClient,
) {
  const collection = bot.getCollection(type)

  const sharedReviews = await collection.findMany({
    where: {
      [`${type}Id`]: mediaId,
      guildId,
      sharedFromUserId: userId,
    },
  })

  const shareCount = sharedReviews.filter((r: any) => !r.isQuote).length
  const quoteCount = sharedReviews.filter((r: any) => r.isQuote).length

  return { shareCount, quoteCount, total: sharedReviews.length }
}
