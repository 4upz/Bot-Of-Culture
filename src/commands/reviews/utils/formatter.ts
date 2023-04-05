import { EmbedBuilder } from 'discord.js'
import { toNormalDate } from '../../../utils/helpers'
import {
  GameSearchResult,
  IReview,
  MusicSearchResult,
  ReviewType,
  SearchResult,
  SeriesSearchResult,
} from '../../../utils/types'
import { convertScoreToStars, convertToNameListString } from './index'
import { calculatePropertyAverage } from '../buttons/select'

export async function createOverviewEmbed(
  result: SearchResult,
  reviews: IReview[],
  type: ReviewType,
) {
  const averageScore = calculatePropertyAverage(reviews, 'score')
  const scoreDisplay = reviews.length
    ? convertScoreToStars(averageScore, reviews.length, type)
    : '*Not yet reviewed*'

  let resultInfoEmbed = new EmbedBuilder()
    .setColor('#01b4e4')
    .setTitle(result.title)
    .setDescription(result.description)
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
    const avgHours = calculatePropertyAverage(reviews, 'hoursPlayed')
    resultInfoEmbed = resultInfoEmbed.addFields([
      {
        name: 'Avg Hours Played',
        value: avgHours ? avgHours.toString() : '*Not yet provided*',
        inline: true,
      },
    ])
  }

  return resultInfoEmbed
}
