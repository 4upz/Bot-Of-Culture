import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js'
import { BotClient } from '../../../Bot'
import {
  convertScoreToStars,
  convertToNameListString,
  getByIdForType,
  truncateByMaxLength,
} from './index'
import {
  GameSearchResult,
  IReview,
  MediaCommandInteraction,
  MusicSearchResult,
  ReviewType,
  SeriesSearchResult,
} from '../../../utils/types'
import { toNormalDate } from '../../../utils/helpers'

/**
 * Replies with the full info embed for a search result along with a prompt
 * to review it. Expects an interaction that has already been deferred
 * @param interaction the deferred interaction to edit with the result info
 * @param type        the media type of the result
 * @param id          the ID of the result to fetch and display
 */
export async function sendSearchResultInfo(
  interaction: MediaCommandInteraction,
  type: ReviewType,
  id: string,
) {
  const guildId = interaction.guildId
  const bot = interaction.client as BotClient

  try {
    const serverReviews = await getReviewsForType(type, id, guildId, bot)

    const averageScore = calculatePropertyAverage(serverReviews, 'score')
    const scoreDisplay = serverReviews.length
      ? convertScoreToStars(averageScore, serverReviews.length, type)
      : '*Not yet reviewed*'

    const result = await getByIdForType(type, id, bot)
    const description = truncateByMaxLength(result.description, 4096)

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

    if (type === 'series') {
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

    if (type === 'game') {
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

    if (type === 'music') {
      const { artist, tracks, link, albumType } = result as MusicSearchResult

      resultInfoEmbed = resultInfoEmbed
        .addFields([
          { name: 'Artist', value: artist, inline: true },
          { name: 'Tracks', value: tracks.toString() },
          { name: 'Type', value: albumType, inline: true },
        ])
        .setURL(link)
        .setFooter({
          text: 'Click to open the title on Spotify',
          iconURL:
            'https://developer.spotify.com/assets/branding-guidelines/icon3@2x.png',
        })
    }

    resultInfoEmbed = resultInfoEmbed.addFields([
      { name: 'Server Score', value: scoreDisplay, inline: true },
    ])

    if (type === 'game') {
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
        .setCustomId(`startReview_${type}_button_${result.id}`)
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

export async function getReviewsForType(
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

export function calculatePropertyAverage(
  reviews: IReview[],
  property: 'hoursPlayed' | 'score',
) {
  const rawAverage =
    reviews.reduce((total: number, review) => total + review[property], 0) /
    reviews.length
  return Math.floor(rawAverage)
}

export function createReviewPromptMessage(
  reviews: IReview[],
  userId: string,
): string | void {
  if (!reviews.some((review) => review.userId === userId))
    if (!reviews.length)
      return 'Looks like no one has reviewed this yet. Make everyone jealous by being the first one to review it!'
    else return 'Join others in the server by leaving a review!'
}
