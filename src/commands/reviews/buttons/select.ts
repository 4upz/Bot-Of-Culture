import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageComponentInteraction,
} from 'discord.js'
import { BotClient } from 'src/Bot'
import {
  convertScoreToStars,
  convertToNameListString,
  truncateByMaxLength,
} from '../utils'
import {
  GameSearchResult,
  IReview,
  ReviewType,
  SeriesSearchResult,
} from '../../../utils/types'
import { toNormalDate } from '../../../utils/helpers'

const command = {
  data: { name: 'searchSelect' },
  execute: getSearchResultInfo,
}

async function getSearchResultInfo(interaction: MessageComponentInteraction) {
  const params = interaction.customId.split('_')
  const id = params[3]
  const resultType = params[1]
  const guildId = interaction.guildId
  const bot = interaction.client as BotClient

  await interaction.deferUpdate()

  try {
    const serverReviews = await getReviewsForType(resultType, id, guildId, bot)

    const averageScore = calculatePropertyAverage(serverReviews, 'score')
    const scoreDisplay = serverReviews.length
      ? convertScoreToStars(averageScore, serverReviews.length, resultType)
      : '*Not yet reviewed*'

    const result = await getByIdForType(resultType, id, bot)
    const description = truncateByMaxLength(result.description, 4096)

    let commandPrefix = 'startReview_movie'
    let resultInfoEmbed = new EmbedBuilder()
      .setColor('#01b4e4')
      .setTitle(result.title)
      .setDescription(description)
      .setImage(result.image)
      .addFields([
        {
          name: 'Release Date',
          value: toNormalDate(result.date),
          inline: true,
        },
      ])

    if (resultType === 'series') {
      commandPrefix = 'startReview_series'
      const { episodes, episodeLength, seasons, lastAirDate, status } =
        result as SeriesSearchResult

      resultInfoEmbed = resultInfoEmbed.addFields([
        { name: 'Episodes', value: episodes, inline: true },
        {
          name: 'Episode Length',
          value: `${episodeLength} minutes`,
          inline: true,
        },
        { name: 'Seasons', value: seasons, inline: true },
        {
          name: 'Last Air Date',
          value: toNormalDate(lastAirDate),
          inline: true,
        },
        { name: 'Status', value: status, inline: true },
      ])
    }

    if (resultType === 'game') {
      commandPrefix = 'startReview_game'
      const {
        gameModes,
        developer,
        publisher,
        genres,
        rating,
        ratingCount,
        platforms,
      } = result as GameSearchResult

      resultInfoEmbed = resultInfoEmbed.addFields([
        {
          name: 'Genres',
          value: convertToNameListString(genres),
          inline: true,
        },
        {
          name: 'Modes',
          value: convertToNameListString(gameModes),
          inline: true,
        },
        {
          name: 'Developer',
          value: developer,
          inline: true,
        },
        {
          name: 'Publisher',
          value: publisher,
          inline: true,
        },
        {
          name: 'Rating',
          value: rating ? `${rating} (*${ratingCount}*)` : 'N/A',
          inline: true,
        },
        {
          name: 'Platforms',
          value: convertToNameListString(platforms),
        },
      ])
    }

    resultInfoEmbed = resultInfoEmbed.addFields([
      { name: 'Server Score', value: scoreDisplay, inline: true },
    ])
    if (resultType === 'game') {
      const avgHours = calculatePropertyAverage(serverReviews, 'hoursPlayed')
      resultInfoEmbed = resultInfoEmbed.addFields([
        {
          name: 'Avg Hours Played',
          value: avgHours ? avgHours.toString() : '*Not yet provided*',
          inline: true,
        },
      ])
    }

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${commandPrefix}_button_${result.id}`)
        .setLabel('Leave a review')
        .setStyle(ButtonStyle.Success),
    )

    await interaction.editReply({
      content: '',
      embeds: [resultInfoEmbed],
      components: [],
    })

    const reviewPrompt = createReviewPromptMessage(
      serverReviews,
      interaction.user.id,
    )
    if (reviewPrompt)
      await interaction.followUp({
        content: reviewPrompt,
        components: [actionRow as any],
        ephemeral: true,
      })
  } catch (error) {
    console.error(error)
    await interaction.editReply({
      content:
        'Sorry, something must have went wrong. 🫣 Try again in a moment.',
      components: [],
    })
  }
}

async function getByIdForType(type: string, id: string, bot: BotClient) {
  if (type === 'movie') return await bot.movies.getById(id)
  else if (type == 'game') return await bot.games.getById(id)
  else return await bot.movies.getSeriesById(id)
}

async function getReviewsForType(
  type: string,
  id: string,
  guildId: string,
  bot: BotClient,
): Promise<IReview[]> {
  const collection = bot.getCollection(type as ReviewType)
  return await collection.findMany({
    where: {
      [`${type}Id`]: id,
      guildId,
    },
  })
}

function calculatePropertyAverage(
  reviews: IReview[],
  property: 'hoursPlayed' | 'score',
) {
  const rawAverage =
    reviews.reduce((total: number, review) => total + review[property], 0) /
    reviews.length
  return Math.floor(rawAverage)
}

function createReviewPromptMessage(
  reviews: IReview[],
  userId: string,
): string | void {
  if (!reviews.some((review) => review.userId === userId))
    if (!reviews.length)
      return 'Looks like no one has reviewed this yet. Make everyone jealous by being the first one to review it!'
    else return 'Join others in the server by leaving a review!'
}

export default command
