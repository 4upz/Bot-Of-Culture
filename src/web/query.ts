import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
export const types = ['movie', 'series', 'game', 'music'] as const
export type MediaType = typeof types[number]
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
export function normalizeTitle(value: string) {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
}
export function parseQuery(input: Record<string, unknown>, expansion = false) {
  const type = input.type === undefined ? 'all' : input.type
  if (
    typeof type !== 'string' ||
    (type !== 'all' && !types.includes(type as MediaType))
  )
    throw new HttpError(400, 'Invalid media type')
  const q = input.q === undefined ? '' : input.q
  if (typeof q !== 'string' || q.length > 100)
    throw new HttpError(400, 'Invalid search')
  const limit =
    input.limit === undefined ? (expansion ? 20 : 10) : Number(input.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > (expansion ? 50 : 20))
    throw new HttpError(400, 'Invalid page size')
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== 'string' || input.cursor.length > 3000)
  )
    throw new HttpError(400, 'Invalid cursor')
  return {
    type,
    q: normalizeTitle(q),
    limit,
    cursor: input.cursor as string | undefined,
  }
}
export class CursorCodec {
  constructor(private secret = randomBytes(32).toString('hex')) {}
  encode(payload: Record<string, unknown>) {
    const data = Buffer.from(JSON.stringify({ ...payload, v: 1 })).toString(
      'base64url',
    )
    return (
      data +
      '.' +
      createHmac('sha256', this.secret).update(data).digest('base64url')
    )
  }
  decode(token: string, expected: Record<string, unknown>): any {
    try {
      const [data, sig, ...rest] = token.split('.')
      const actual = createHmac('sha256', this.secret).update(data).digest()
      const supplied = Buffer.from(sig, 'base64url')
      if (
        rest.length ||
        actual.length !== supplied.length ||
        !timingSafeEqual(actual, supplied)
      )
        throw Error()
      const p = JSON.parse(Buffer.from(data, 'base64url').toString())
      if (
        p.v !== 1 ||
        !Number.isFinite(p.asOf) ||
        Date.now() - p.asOf > 3600000 ||
        p.asOf > Date.now() + 1000
      )
        throw Error()
      for (const [key, value] of Object.entries(expected)) {
        if (p[key] !== value)
          throw new HttpError(
            key === 'generation' ? 409 : 400,
            key === 'generation'
              ? 'Results changed; refresh to continue'
              : 'Cursor does not match request',
          )
      }
      return p
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(400, 'Invalid or expired cursor')
    }
  }
}
const collections: Record<MediaType, string> = {
  movie: 'MovieReview',
  series: 'SeriesReview',
  game: 'GameReview',
  music: 'MusicReview',
}
export interface Eligibility {
  userId?: string
  members?: string[]
  asOf: Date
  mediaId?: string
  q?: string
}
export function eligiblePipeline(type: MediaType, options: Eligibility): any[] {
  const match: any = {
    isPrivate: false,
    _createdAt: { $lte: { $date: options.asOf.toISOString() } },
    score: { $gte: 1, $lte: 5 },
  }
  if (options.userId) match.userId = options.userId
  if (options.members) match.userId = { $in: options.members }
  if (options.mediaId) match[`${type}Id`] = options.mediaId
  const p: any[] = [
    { $match: match },
    {
      $lookup: {
        from: 'ReviewPreference',
        localField: 'userId',
        foreignField: 'userId',
        as: '_preferences',
      },
    },
    {
      $match: {
        $expr: {
          $or: [
            { $eq: [{ $size: '$_preferences' }, 0] },
            {
              $and: [
                { $eq: [{ $size: '$_preferences' }, 1] },
                {
                  $eq: [{ $arrayElemAt: ['$_preferences.isPublic', 0] }, true],
                },
              ],
            },
          ],
        },
      },
    },
    { $set: { type: { $literal: type }, mediaId: `$${type}Id` } },
    {
      $lookup: {
        from: 'MediaTitle',
        let: { media: '$mediaId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$type', type] },
                  { $eq: ['$mediaId', '$$media'] },
                ],
              },
            },
          },
          { $project: { _id: 0, title: 1, normalizedTitle: 1 } },
        ],
        as: '_titles',
      },
    },
    { $set: { media: { $arrayElemAt: ['$_titles', 0] } } },
  ]
  if (options.q)
    p.push({
      $match: {
        'media.normalizedTitle': {
          $regex: options.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        },
      },
    })
  return p
}
export function unionPipeline(
  selected: string,
  options: Eligibility,
): { collection: string; pipeline: any[] } {
  const selectedTypes =
    selected === 'all' ? [...types] : [selected as MediaType]
  const [first, ...rest] = selectedTypes
  return {
    collection: collections[first],
    pipeline: [
      ...eligiblePipeline(first, options),
      ...rest.map((type) => ({
        $unionWith: {
          coll: collections[type],
          pipeline: eligiblePipeline(type, options),
        },
      })),
    ],
  }
}
export function rawDate(v: any): string {
  if (v instanceof Date) return v.toISOString()
  if (v?.$date)
    return typeof v.$date === 'string'
      ? new Date(v.$date).toISOString()
      : new Date(Number(v.$date.$numberLong)).toISOString()
  return new Date(v).toISOString()
}
export function rawId(v: any): string {
  return typeof v === 'string' ? v : v?.$oid || String(v)
}
export function serializeReview(row: any, guildId?: string): any {
  const result: any = {
    id: rawId(row._id),
    type: row.type,
    mediaId: row.mediaId,
    media: { title: row.media?.title || 'Title unavailable' },
    userId: row.userId,
    username: row.username,
    score: row.score,
    comment: row.comment || '',
    createdAt: rawDate(row._createdAt),
    updatedAt: row.updatedAt ? rawDate(row.updatedAt) : null,
    reviewedInAnotherServer: !!(
      guildId &&
      row.originGuildId &&
      row.originGuildId !== guildId
    ),
  }
  if (row.hoursPlayed != null) result.hoursPlayed = row.hoursPlayed
  if (row.replayability) result.replayability = row.replayability
  if (row.sharedFromUserId) {
    result.sourceUnavailable = true
    if (row._sourceAllowed) {
      result.sharedFromUsername = row.sharedFromUsername
      if (row.isQuote === true) result.sharedFromComment = row.sharedFromComment
      result.sharedFromUserId = row.sharedFromUserId
      result.sourceUnavailable = false
    }
  }
  return result
}
