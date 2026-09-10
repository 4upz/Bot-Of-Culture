import { ReviewType } from '../utils/types'
import { normalizeTitle } from '../web/query'

const contentFields = ['score', 'comment', 'hoursPlayed', 'replayability', 'sharedFromUserId', 'sharedFromUsername', 'sharedFromComment', 'isQuote']

/** All composers share global identity and immutable creation provenance. P2002
 * handling covers simultaneous first saves without recreating the winning row. */
export async function saveGlobalReview(collection: any, type: ReviewType, input: Record<string, any>, restrictPrivate = false) {
  const where = { userId: input.userId, [`${type}Id`]: input[`${type}Id`] }
  const existing = await collection.findFirst({ where })
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  delete data.id
  delete data.createdAt
  delete data.updatedAt
  delete data.originGuildId
  delete data.originSource
  delete data.isPrivate
  if (existing) {
    delete data.guildId
    const changed = contentFields.some((key) => key in data && (existing[key] ?? null) !== (data[key] ?? null))
    if (changed) data.updatedAt = new Date()
    if (restrictPrivate) data.isPrivate = true
    const review = await collection.update({ where: { id: existing.id }, data })
    return { review, message: 'Review successfully updated!' }
  }
  try {
    const review = await collection.create({ data: {
      ...data,
      originGuildId: input.guildId ?? null,
      originSource: input.guildId ? 'observed_creation' : null,
      isPrivate: restrictPrivate,
      updatedAt: null,
    } })
    return { review, message: 'Review successfully added! 🎉' }
  } catch (error) {
    if ((error as any)?.code !== 'P2002') throw error
    // The unique user/media key winner now exists. Reuse the edit semantics.
    const winner = await collection.findFirst({ where })
    if (!winner) throw error
    return saveGlobalReview(collection, type, input, restrictPrivate)
  }
}

/** Review-level privacy applies in Discord independently of web preferences. */
export function canDisplayReview(review: any, guildId: string | null): boolean {
  if (!review) return false
  if (review.isPrivate !== true) return true
  const origin = review.originGuildId ?? review.guildId
  return Boolean(guildId && origin && guildId === origin)
}

export function discordVisibilityWhere(guildId: string | null) {
  // isPrivate is a required Boolean; Prisma rejects `isSet` on non-optional fields.
  const publicRules: any[] = [{ isPrivate: false }]
  if (guildId) publicRules.push({ isPrivate: true, OR: [
    { originGuildId: guildId },
    { AND: [{ OR: [{ originGuildId: null }, { originGuildId: { isSet: false } }] }, { guildId }] },
  ] })
  return { OR: publicRules }
}

function withoutSource(review: any) {
  return { ...review, sharedFromUserId: null, sharedFromUsername: null, sharedFromComment: null, sourceUnavailable: true }
}

export async function redactDiscordSource(review: any, collection: any, type: ReviewType, guildId: string | null) {
  if (!review.sharedFromUserId) return review
  const source = await collection.findFirst({ where: { userId: review.sharedFromUserId, [`${type}Id`]: review[`${type}Id`] } })
  if (canDisplayReview(source, guildId)) return review
  return withoutSource(review)
}

/** Same policy as redactDiscordSource, resolving every copied source of a page in one query. */
export async function redactDiscordSources(reviews: any[], collection: any, type: ReviewType, guildId: string | null) {
  const field = `${type}Id`
  const shared = reviews.filter((review) => review.sharedFromUserId)
  if (!shared.length) return reviews
  const sources = await collection.findMany({ where: {
    userId: { in: [...new Set(shared.map((review) => review.sharedFromUserId))] },
    [field]: { in: [...new Set(shared.map((review) => review[field]))] },
  } })
  const visible = new Set(sources.filter((source: any) => canDisplayReview(source, guildId)).map((source: any) => JSON.stringify([source.userId, source[field]])))
  return reviews.map((review) => !review.sharedFromUserId || visible.has(JSON.stringify([review.sharedFromUserId, review[field]])) ? review : withoutSource(review))
}

/** Reuse already fetched provider names; enrichment must not undo a saved review. */
export async function rememberMediaTitle(db: any, type: ReviewType, mediaId: string, target: { title?: string }) {
  if (!target?.title) return
  try {
    const title = target.title.trim()
    if (!title) return
    const normalizedTitle = normalizeTitle(title)
    const existing = await db.mediaTitle.findUnique({ where: { type_mediaId: { type, mediaId } } })
    if (existing?.title === title && existing?.normalizedTitle === normalizedTitle) return
    const data = { title, normalizedTitle, fetchedAt: new Date() }
    await db.mediaTitle.upsert({ where: { type_mediaId: { type, mediaId } }, create: { type, mediaId, ...data }, update: data })
  } catch {
    console.warn('[Review title] Could not save provider title; review remains saved.')
  }
}
