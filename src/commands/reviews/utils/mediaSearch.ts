import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js'
import { BotClient } from '../../../Bot'
import { ReviewType, SubcommandExecutors } from '../../../utils/types'
import { formatSearchResultLabel, getSearchResultsForType } from './index'

export type MediaTypeDescriptor = {
  type: ReviewType
  noun: string
  subject: string
}

export const MEDIA_TYPES: MediaTypeDescriptor[] = [
  { type: 'movie', noun: 'movie', subject: 'a movie' },
  { type: 'series', noun: 'series', subject: 'a series' },
  { type: 'game', noun: 'game', subject: 'a game' },
  { type: 'music', noun: 'album/single', subject: 'an album/single' },
]

// Autocomplete choice values carry the picked result's ID rather than its
// title so executors can act on the selection without a second search. The
// prefix marks values that came from a suggestion — anything else is
// free-typed text that still needs a manual search.
const SELECTED_ID_PREFIX = 'id:'
const MAX_CHOICE_NAME_LENGTH = 100

/**
 * Adds a subcommand per media type to the given command, each with an
 * autocomplete-enabled (and required) "title" string option
 * @param builder            the base command to add the subcommands to
 * @param describeSubcommand builds each subcommand's description
 * @param describeTitle      builds each subcommand's title option description
 * @param extendSubcommand   optionally adds extra options to each subcommand
 */
export function buildMediaSubcommands(
  builder: SlashCommandBuilder,
  describeSubcommand: (media: MediaTypeDescriptor) => string,
  describeTitle: (media: MediaTypeDescriptor) => string,
  extendSubcommand?: (
    subcommand: SlashCommandSubcommandBuilder,
  ) => SlashCommandSubcommandBuilder,
): SlashCommandSubcommandsOnlyBuilder {
  return MEDIA_TYPES.reduce(
    (command, media) =>
      command.addSubcommand((subcommand) => {
        subcommand
          .setName(media.type)
          .setDescription(describeSubcommand(media))
          .addStringOption((option) =>
            option
              .setName('title')
              .setDescription(describeTitle(media))
              .setRequired(true)
              .setAutocomplete(true),
          )
        return extendSubcommand ? extendSubcommand(subcommand) : subcommand
      }),
    builder as SlashCommandSubcommandsOnlyBuilder,
  )
}

/**
 * Creates the subcommand executor map for a media command by binding the
 * given executor to each media type
 */
export function createMediaExecutors(
  executor: (
    interaction: ChatInputCommandInteraction,
    type: ReviewType,
  ) => Promise<void>,
): SubcommandExecutors {
  return MEDIA_TYPES.reduce(
    (executors, { type }) => ({
      ...executors,
      [type]: (interaction: ChatInputCommandInteraction) =>
        executor(interaction, type),
    }),
    {},
  )
}

/**
 * Shared autocomplete handler for all media commands. Searches the service
 * matching the focused subcommand and responds with the results as choices
 */
export async function searchAutocomplete(interaction: AutocompleteInteraction) {
  const bot = interaction.client as BotClient
  const type = interaction.options.getSubcommand() as ReviewType
  const query = interaction.options.getFocused().trim()

  if (!query || query.startsWith(SELECTED_ID_PREFIX))
    return interaction.respond([])

  const results = await getSearchResultsForType(type, query, bot)
  await interaction.respond(
    results.map((result) => ({
      name: formatSearchResultLabel(result, type, MAX_CHOICE_NAME_LENGTH),
      value: `${SELECTED_ID_PREFIX}${result.id}`,
    })),
  )
}

/**
 * Extracts the media ID from the title option when the user picked an
 * autocomplete suggestion. Returns null for free-typed text, in which case
 * the command should fall back to a manual search
 */
export function getSelectedResultId(interaction: ChatInputCommandInteraction) {
  const title = interaction.options.getString('title')
  return title?.startsWith(SELECTED_ID_PREFIX)
    ? title.substring(SELECTED_ID_PREFIX.length)
    : null
}
