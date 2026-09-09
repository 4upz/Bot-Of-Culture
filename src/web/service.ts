import { createHash } from 'crypto'
import { BotClient } from '../Bot'
import {
  CursorCodec,
  Eligibility,
  HttpError,
  MediaType,
  parseQuery,
  rawDate,
  rawId,
  serializeReview,
  types,
  unionPipeline,
} from './query'
import { MembershipService, WebRevision } from './membership'
const order = { _createdAt: -1, type: 1, _id: -1 }
export class PublicReviewService {
  private cursors = new CursorCodec()
  constructor(
    private bot: BotClient,
    private membership: MembershipService,
    private revision: WebRevision,
  ) {}
  private async aggregate(collection: string, pipeline: any[]): Promise<any[]> {
    const models: any = this.bot.db
    const model = models[collection[0].toLowerCase() + collection.slice(1)]
    return (await model.aggregateRaw({
      pipeline,
      options: { maxTimeMS: 5000, allowDiskUse: false },
    })) as any[]
  }
  private async generation(includeTitles = false) {
    const [prefs, titles] = await Promise.all([
      this.aggregate('ReviewPreference', [
        { $sort: { userId: 1, _id: 1 } },
        { $limit: 10001 },
        { $project: { userId: 1, isPublic: 1 } },
      ]),
      includeTitles
        ? this.aggregate('MediaTitle', [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                latest: { $max: '$fetchedAt' },
              },
            },
          ])
        : Promise.resolve([]),
    ])
    if (prefs.length > 10000)
      throw new HttpError(503, 'Reviews temporarily unavailable')
    return createHash('sha256')
      .update(JSON.stringify([this.revision.value, prefs, titles]))
      .digest('hex')
  }
  private async profilePublic(userId: string) {
    const prefs = await this.aggregate('ReviewPreference', [
      { $match: { userId } },
      { $limit: 2 },
    ])
    if (prefs.length && (prefs.length !== 1 || prefs[0].isPublic !== true))
      throw new HttpError(404, 'Review profile unavailable')
  }
  async read(
    kind: 'profile' | 'guild' | 'title',
    id: string,
    input: Record<string, unknown>,
    mediaType?: MediaType,
    mediaId?: string,
  ) {
    if (!/^\d{1,22}$/.test(id)) throw new HttpError(400, 'Invalid identifier')
    if (
      kind === 'title' &&
      (!types.includes(mediaType) || !mediaId || mediaId.length > 100)
    )
      throw new HttpError(400, 'Invalid title')
    const query = parseQuery(input, kind === 'title')
    if (kind === 'title') {
      query.type = mediaType
      query.q = ''
    }
    const roster = kind === 'profile' ? undefined : this.membership.get(id)
    if (kind === 'profile') await this.profilePublic(id)
    const baseGeneration = await this.generation(Boolean(query.q))
    const generation = baseGeneration + ':' + (roster?.generation || 0)
    const scope = `${kind}:${id}:${mediaType || ''}:${mediaId || ''}`
    const binding = { scope, generation, type: query.type, q: query.q }
    const cursor = query.cursor
      ? this.cursors.decode(query.cursor, binding)
      : null
    const asOf = cursor?.asOf || Date.now()
    const options: Eligibility = {
      asOf: new Date(asOf),
      userId: kind === 'profile' ? id : undefined,
      members: roster?.members,
      mediaId,
      q: query.q,
    }
    const base = unionPipeline(query.type, options)
    const coverageBase = unionPipeline(query.type, { ...options, q: '' })
    const coverage = await this.aggregate(coverageBase.collection, [
      ...coverageBase.pipeline,
      { $match: { 'media.title': { $exists: false } } },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ])
    let items: any[]
    let nextCursor: string | null = null
    if (kind === 'guild') {
      const grouped: any[] = [
        ...base.pipeline,
        {
          $group: {
            _id: { type: '$type', mediaId: '$mediaId' },
            latestReviewCreatedAt: { $max: '$_createdAt' },
            averageScore: { $avg: '$score' },
            visibleReviewCount: { $sum: 1 },
            media: { $first: '$media' },
          },
        },
        { $set: { type: '$_id.type', mediaId: '$_id.mediaId' } },
      ]
      if (cursor?.last) {
        const l = cursor.last
        grouped.push({
          $match: {
            $or: [
              { latestReviewCreatedAt: { $lt: { $date: l.createdAt } } },
              {
                latestReviewCreatedAt: { $date: l.createdAt },
                type: { $gt: l.type },
              },
              {
                latestReviewCreatedAt: { $date: l.createdAt },
                type: l.type,
                mediaId: { $gt: l.mediaId },
              },
            ],
          },
        })
      }
      grouped.push(
        { $sort: { latestReviewCreatedAt: -1, type: 1, mediaId: 1 } },
        { $limit: query.limit + 1 },
      )
      const rows = await this.aggregate(base.collection, grouped)
      const expansionGeneration = query.q
        ? (await this.generation(false)) + ':' + roster.generation
        : generation
      const hasMore = rows.length > query.limit
      rows.splice(query.limit)
      items = []
      // Bounded title previews; never push every title's reviews into an aggregation array.
      for (const row of rows) {
        const preview = await this.reviewPage(
          row.type,
          { ...options, mediaId: row.mediaId },
          3,
        )
        const reviews = await this.serialize(preview.rows, id, options)
        const titleBinding = {
          scope: `title:${id}:${row.type}:${row.mediaId}`,
          generation: expansionGeneration,
          type: row.type,
          q: '',
        }
        items.push({
          type: row.type,
          mediaId: row.mediaId,
          media: { title: row.media?.title || 'Title unavailable' },
          latestReviewCreatedAt: rawDate(row.latestReviewCreatedAt),
          averageScore: row.averageScore,
          visibleReviewCount: row.visibleReviewCount,
          reviews,
          nextReviewCursor: preview.more
            ? this.reviewCursor(titleBinding, asOf, preview.rows.at(-1))
            : null,
        })
      }
      if (hasMore && rows.length) {
        const last = rows.at(-1)
        nextCursor = this.cursors.encode({
          ...binding,
          asOf,
          last: {
            createdAt: rawDate(last.latestReviewCreatedAt),
            type: last.type,
            mediaId: last.mediaId,
          },
        })
      }
    } else {
      const page = await this.reviewPage(
        query.type,
        options,
        query.limit,
        cursor?.last,
      )
      items = await this.serialize(
        page.rows,
        kind === 'title' ? id : undefined,
        options,
      )
      if (page.more && page.rows.length)
        nextCursor = this.reviewCursor(binding, asOf, page.rows.at(-1))
    }
    const identity =
      kind === 'profile'
        ? items[0] || (await this.profileIdentity(id, options))
        : undefined
    // Recheck after query work: a completed opt-out or roster change cannot leak an in-flight response.
    if (kind === 'profile') await this.profilePublic(id)
    if (
      (await this.generation(Boolean(query.q))) !== baseGeneration ||
      (roster && this.membership.get(id).generation !== roster.generation)
    )
      throw new HttpError(409, 'Results changed; refresh to continue')
    const result: any = {
      items,
      nextCursor,
      searchCoverage: coverage.length ? 'partial' : 'complete',
    }
    if (roster)
      result.guild = {
        id,
        name: roster.name,
        membersSyncedAt: new Date(roster.syncedAt).toISOString(),
      }
    else {
      if (!identity) throw new HttpError(404, 'Review profile unavailable')
      result.profile = { userId: id, username: identity.username }
    }
    return result
  }
  private async profileIdentity(id: string, options: Eligibility) {
    const base = unionPipeline('all', { ...options, userId: id, q: '' })
    const rows = await this.aggregate(base.collection, [
      ...base.pipeline,
      { $sort: order },
      { $limit: 1 },
      { $project: { username: 1 } },
    ])
    return rows[0]
  }
  private reviewCursor(binding: any, asOf: number, row: any) {
    return this.cursors.encode({
      ...binding,
      asOf,
      last: {
        createdAt: rawDate(row._createdAt),
        type: row.type,
        id: rawId(row._id),
      },
    })
  }
  private async reviewPage(
    type: string,
    options: Eligibility,
    limit: number,
    last?: any,
  ) {
    const base = unionPipeline(type, options)
    if (last)
      base.pipeline.push({
        $match: {
          $or: [
            { _createdAt: { $lt: { $date: last.createdAt } } },
            { _createdAt: { $date: last.createdAt }, type: { $gt: last.type } },
            {
              _createdAt: { $date: last.createdAt },
              type: last.type,
              _id: { $lt: { $oid: last.id } },
            },
          ],
        },
      })
    base.pipeline.push({ $sort: order }, { $limit: limit + 1 })
    const rows = await this.aggregate(base.collection, base.pipeline)
    const more = rows.length > limit
    rows.splice(limit)
    return { rows, more }
  }
  private async serialize(
    rows: any[],
    guildId: string | undefined,
    options: Eligibility,
  ) {
    // Only sources for this bounded page are checked. Copied attribution never bypasses author/member policy.
    const sources = new Map<string, boolean>()
    for (const row of rows) {
      if (row.sharedFromUserId) {
        const key = `${row.type}:${row.mediaId}:${row.sharedFromUserId}`
        if (!sources.has(key)) {
          if (
            options.members &&
            !options.members.includes(row.sharedFromUserId)
          )
            sources.set(key, false)
          else {
            const base = unionPipeline(row.type, {
              asOf: options.asOf,
              userId: row.sharedFromUserId,
              mediaId: row.mediaId,
            })
            const source = await this.aggregate(base.collection, [
              ...base.pipeline,
              { $limit: 1 },
              { $project: { _id: 1 } },
            ])
            sources.set(key, source.length === 1)
          }
        }
        row._sourceAllowed = sources.get(key)
      }
    }
    return rows.map((row) => serializeReview(row, guildId))
  }
}
