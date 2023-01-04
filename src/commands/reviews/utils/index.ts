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
  SelectMenuBuilder,
  SelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import dayjs from 'dayjs'
import { GameReview, MovieReview, Prisma, SeriesReview } from '@prisma/client'
import { gameReviewChoices, reviewChoices } from '../../utils/choices'
import { BotClient } from '../../../Bot'
import { ReviewType, SearchResult } from '../../../utils/types'
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

async function getSearchResultsForType(
  type: ReviewType,
  query: string,
  bot: BotClient,
) {
  if (type === 'movie') return await bot.movies.search(query)
  else if (type === 'series') return await bot.movies.searchSeries(query)
  else return await bot.games.search(query)
}

export async function promptReview(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const targetId = params[3]
  const type = params[1]

  try {
    const choices = type === 'game' ? gameReviewChoices : reviewChoices
    const actionRow = new ActionRowBuilder().addComponents(
      new SelectMenuBuilder()
        .setCustomId(`reviewScore_${type}_button_${targetId}`)
        .addOptions(...(choices as any)),
    )
    await interaction.update({
      content: `Awesome! What would you rate this ${type}? 🤔`,
      components: [actionRow as any],
    })
  } catch (error) {
    console.error(error)
  }
}

export async function promptReviewComment(interaction: SelectMenuInteraction) {
  const params = interaction.customId.split('_')
  const targetId = params[3]
  const reviewScore = params[4]
  const type = params[1]

  const actionRow =
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('reviewCommentInput')
        .setLabel(`What did you think of the ${type}?`)
        .setPlaceholder('Enter reasons behind your rating here!')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true),
    )

  const modal = new ModalBuilder()
    .setCustomId(`reviewComment_${type}_modal_${targetId}_${reviewScore}`)
    .setTitle('Review Comment')
    .addComponents(actionRow)

  if (type === 'game')
    // Add option for hours input
    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reviewHoursInput')
          .setLabel('How many hours did you play? (optional)')
          .setMaxLength(3)
          .setPlaceholder('20')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    )

  await interaction.showModal(modal)
  await interaction.deleteReply()
}

export async function saveReview(
  interaction: SelectMenuInteraction | ModalSubmitInteraction,
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

  try {
    let reviewTarget, review, statusReply

    if (type === 'movie') {
      const result = await saveMovieReview(
        data as Prisma.MovieReviewCreateInput,
        bot,
      )
      review = result.review
      statusReply = result.message
      reviewTarget = await bot.movies.getById(data.movieId.toString())
    } else if (type === 'game') {
      const result = await saveGameReview(
        data as Prisma.GameReviewCreateInput,
        bot,
      )
      review = result.review
      statusReply = result.message
      reviewTarget = await bot.games.getById(data.gameId.toString())
    } else {
      const result = await saveSeriesReview(
        data as Prisma.SeriesReviewCreateInput,
        bot,
      )
      review = result.review
      statusReply = result.message
      reviewTarget = await bot.movies.getSeriesById(data.seriesId.toString())
    }

    if (!comment) review.comment = '*No comment added*'

    const reviewInfoEmbed = createReviewEmbed(
      review,
      reviewTarget,
      interaction.user.avatarURL(),
      type,
    )

    await interaction.channel.send({
      content: `<@${review.userId}> just left a review for a ${type}!`,
      embeds: [reviewInfoEmbed as any],
      components: [],
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
          return new ButtonBuilder()
            .setCustomId(`${customIdPrefix}_button_${result.id}`)
            .setLabel(`${title} (${date})`)
            .setStyle(ButtonStyle.Success)
        }),
      )

    const comment = additionalMessage || ''
    const emoji = {
      movie: '🎬',
      series: '📺',
      game: '🎮',
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
  const choices = type === 'game' ? gameReviewChoices : reviewChoices
  return (
    '⭐️'.repeat(score) +
    '▪️'.repeat(5 - score) +
    ` | *${choices[score - 1].description}*` +
    suffix
  )
}

export function createReviewEmbed(
  review: MovieReview | SeriesReview | GameReview,
  reviewTarget: SearchResult,
  avatar: string,
  type: string,
) {
  const formattedScore = `${convertScoreToStars(review.score, undefined, type)}`
  const embed = new EmbedBuilder()
    .setColor('#01b4e4')
    .setTitle(`*"${reviewTarget.title}"* review by ${review.username}`)
    .setAuthor({
      name: review.username,
      iconURL: avatar,
    })
    .setDescription(review.comment)
    .setImage(reviewTarget.image)

  if (type === 'game')
    embed.addFields([
      {
        name: 'Hours Played',
        value: (<GameReview>review).hoursPlayed?.toString() || 'N/A',
        inline: true,
      },
    ])

  embed.addFields([
    { name: 'Score', value: formattedScore },
    {
      name: 'Release Date',
      value: toNormalDate(reviewTarget.date),
      inline: true,
    },
    {
      name: 'Description',
      value: reviewTarget.description,
      inline: true,
    },
  ])
  return embed
}

export function convertToNameListString(objectArr: any[]) {
  if (objectArr?.length) return objectArr.map((obj: any) => obj.name).join(', ')
  return 'N/A'
}
