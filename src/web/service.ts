import { createHash } from 'crypto'
import { BotClient } from '../Bot'
import {
  CursorCodec,
  Eligibility,
  HttpError,
  MediaType,
  mediaLookupPipeline,
  parseQuery,
  rawDate,
  rawId,
  serializeMedia,
  serializeReview,
  types,
  unionPipeline,
} from './query'
import { MembershipService, WebRevision } from './membership'
export interface ReadContext {
  deadline: number
  signal?: AbortSignal
}
interface ReadWork extends ReadContext {
  queries: number
}
const order = { _createdAt: -1, type: 1, _id: -1 }
export class PublicReviewService {
  private cursors = new CursorCodec()
  constructor(
    private bot: BotClient,
    private membership: MembershipService,
    private revision: WebRevision,
  ) {}
  private check(work: ReadWork) {
    const remaining = Math.floor(work.deadline - Date.now())
    if (work.signal?.aborted || !Number.isFinite(remaining) || remaining <= 0)
      throw new HttpError(503, 'Reviews temporarily unavailable')
    return remaining
  }
  private async aggregate(
    work: ReadWork,
    collection: string,
    pipeline: any[],
  ): Promise<any[]> {
    if (++work.queries > 16)
      throw new HttpError(503, 'Reviews temporarily unavailable')
    const models: any = this.bot.db
    const model = models[collection[0].toLowerCase() + collection.slice(1)]
    const remaining = this.check(work)
    const rows = (await model.aggregateRaw({
      pipeline,
      options: {
        maxTimeMS: Math.min(5000, remaining),
        allowDiskUse: false,
      },
    })) as any[]
    this.check(work)
    return rows
  }
  private async generation(work: ReadWork, includeTitles = false) {
    const prefs = await this.aggregate(work, 'ReviewPreference', [
      { $sort: { userId: 1, _id: 1 } },
      { $limit: 10001 },
      { $project: { userId: 1, isPublic: 1 } },
    ])
    const titles = includeTitles
      ? await this.aggregate(work, 'MediaTitle', [
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              latest: { $max: '$fetchedAt' },
            },
          },
        ])
      : []
    if (prefs.length > 10000)
      throw new HttpError(503, 'Reviews temporarily unavailable')
    const digest = (parts: unknown[]) =>
      createHash('sha256').update(JSON.stringify(parts)).digest('hex')
    return {
      full: digest([this.revision.value, prefs, titles]),
      // Per-title expansion cursors bind to preferences only; derive it from the same snapshot.
      prefsOnly: digest([this.revision.value, prefs, []]),
    }
  }
  private async profilePublic(work: ReadWork, userId: string) {
    const prefs = await this.aggregate(work, 'ReviewPreference', [
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
    context: ReadContext = { deadline: Date.now() + 8000 },
  ) {
    const work: ReadWork = { ...context, queries: 0 }
    this.check(work)
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
    if (kind === 'profile') await this.profilePublic(work, id)
    const baseSnapshot = await this.generation(work, Boolean(query.q))
    const baseGeneration = baseSnapshot.full
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
    let coverage: any[]
    let items: any[]
    let nextCursor: string | null = null
    if (kind === 'guild') {
      const base = unionPipeline(query.type, {
        ...options,
        q: '',
        omitMedia: true,
      })
      const grouped: any[] = [
        ...base.pipeline,
        {
          $group: {
            _id: { type: '$type', mediaId: '$mediaId' },
            latestReviewCreatedAt: { $max: '$_createdAt' },
            averageScore: { $avg: '$score' },
            visibleReviewCount: { $sum: 1 },
          },
        },
        { $set: { type: '$_id.type', mediaId: '$_id.mediaId' } },
        ...mediaLookupPipeline(),
      ]
      const titles: any[] = []
      if (query.q)
        titles.push({
          $match: {
            'media.normalizedTitle': {
              $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            },
          },
        })
      if (cursor?.last) {
        const l = cursor.last
        titles.push({
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
      titles.push(
        { $sort: { latestReviewCreatedAt: -1, type: 1, mediaId: 1 } },
        { $limit: query.limit + 1 },
      )
      grouped.push({
        $facet: {
          coverage: [
            { $match: { 'media.title': { $exists: false } } },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          titles,
        },
      })
      const [page] = await this.aggregate(work, base.collection, grouped)
      coverage = page?.coverage || []
      const rows = page?.titles || []
      const expansionGeneration = query.q
        ? baseSnapshot.prefsOnly + ':' + roster.generation
        : generation
      const hasMore = rows.length > query.limit
      rows.splice(query.limit)
      items = []
      // Every facet is capped at four rows before it becomes an array (at most 20 titles).
      const previews = await this.previews(work, rows, options)
      const flat = previews.flatMap((preview) => preview.rows)
      const serialized = await this.serialize(work, flat, id, options)
      let offset = 0
      for (const [index, row] of rows.entries()) {
        const preview = previews[index]
        const reviews = serialized.slice(offset, offset + preview.rows.length)
        offset += preview.rows.length
        const titleBinding = {
          scope: `title:${id}:${row.type}:${row.mediaId}`,
          generation: expansionGeneration,
          type: row.type,
          q: '',
        }
        items.push({
          type: row.type,
          mediaId: row.mediaId,
          media: serializeMedia(row.media),
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
      const coverageBase = unionPipeline(query.type, { ...options, q: '' })
      coverage = await this.aggregate(work, coverageBase.collection, [
        ...coverageBase.pipeline,
        { $match: { 'media.title': { $exists: false } } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ])
      const page = await this.reviewPage(
        work,
        query.type,
        options,
        query.limit,
        cursor?.last,
      )
      items = await this.serialize(
        work,
        page.rows,
        kind === 'title' ? id : undefined,
        options,
      )
      if (page.more && page.rows.length)
        nextCursor = this.reviewCursor(binding, asOf, page.rows.at(-1))
    }
    const identity =
      kind === 'profile'
        ? items[0] || (await this.profileIdentity(work, id, options))
        : undefined
    // Recheck after query work: a completed opt-out or roster change cannot leak an in-flight response.
    if (kind === 'profile') await this.profilePublic(work, id)
    if (
      (await this.generation(work, Boolean(query.q))).full !== baseGeneration ||
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
      result.profile = {
        userId: id,
        username: identity.username,
        avatarUrl: this.avatarUrl(id),
      }
    }
    return result
  }
  private async profileIdentity(
    work: ReadWork,
    id: string,
    options: Eligibility,
  ) {
    const base = unionPipeline('all', { ...options, userId: id, q: '' })
    const rows = await this.aggregate(work, base.collection, [
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
    work: ReadWork,
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
    const rows = await this.aggregate(work, base.collection, base.pipeline)
    const more = rows.length > limit
    rows.splice(limit)
    return { rows, more }
  }
  private async previews(work: ReadWork, titles: any[], options: Eligibility) {
    if (!titles.length) return []
    const base = unionPipeline('all', {
      ...options,
      q: '',
      keys: titles.map(({ type, mediaId }) => ({ type, mediaId })),
    })
    const facets: Record<string, any[]> = {}
    titles.forEach((title, index) => {
      facets[`title${index}`] = [
        { $match: { type: title.type, mediaId: title.mediaId } },
        { $sort: order },
        { $limit: 4 },
        { $unset: ['_preferences', '_titles'] },
      ]
    })
    const [result] = await this.aggregate(work, base.collection, [
      ...base.pipeline,
      { $facet: facets },
    ])
    return titles.map((_, index) => {
      const rows = result?.[`title${index}`] || []
      return { rows: rows.slice(0, 3), more: rows.length > 3 }
    })
  }
  private async serialize(
    work: ReadWork,
    rows: any[],
    guildId: string | undefined,
    options: Eligibility,
  ) {
    // Resolve all copied sources for this page together, retaining author privacy and roster policy.
    const keys = new Map<string, any>()
    const sourceKey = (row: any, userId: string) =>
      JSON.stringify([row.type, row.mediaId, userId])
    const members = options.members && new Set(options.members)
    for (const row of rows) {
      if (
        row.sharedFromUserId &&
        (!members || members.has(row.sharedFromUserId))
      )
        keys.set(sourceKey(row, row.sharedFromUserId), {
          type: row.type,
          mediaId: row.mediaId,
          userId: row.sharedFromUserId,
        })
    }
    const allowed = new Set<string>()
    if (keys.size) {
      const base = unionPipeline('all', {
        asOf: options.asOf,
        members: options.members,
        keys: [...keys.values()],
        omitMedia: true,
      })
      const sources = await this.aggregate(work, base.collection, [
        ...base.pipeline,
        {
          $group: {
            _id: { type: '$type', mediaId: '$mediaId', userId: '$userId' },
          },
        },
        { $limit: keys.size },
      ])
      for (const source of sources)
        allowed.add(sourceKey(source._id, source._id.userId))
    }
    for (const row of rows)
      if (row.sharedFromUserId)
        row._sourceAllowed = allowed.has(sourceKey(row, row.sharedFromUserId))
    return rows.map((row) => ({
      ...serializeReview(row, guildId),
      avatarUrl: this.avatarUrl(row.userId),
    }))
  }
  private avatarUrl(userId: string): string | null {
    // Membership sync populates Discord's user cache. Never add REST work to public reads.
    return (
      this.bot.users?.cache
        .get(userId)
        ?.displayAvatarURL({ size: 128, extension: 'webp' }) || null
    )
  }
}
