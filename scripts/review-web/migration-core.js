'use strict'
const { createHash } = require('node:crypto')
const { BSON } = require('mongodb')
const COLLECTIONS = { MovieReview: 'movieId', SeriesReview: 'seriesId', GameReview: 'gameId', MusicReview: 'musicId' }
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])]))
  return value
}
function encode(doc) { return JSON.stringify(sorted(BSON.EJSON.serialize(doc, { relaxed: false }))) }
function decode(value) { return BSON.EJSON.parse(value, { relaxed: false }) }
function checksum(doc) { return createHash('sha256').update(encode(doc)).digest('hex') }
function numericScore(value) {
  if (typeof value === 'number') return value
  if (value instanceof BSON.Int32 || value instanceof BSON.Double || value instanceof BSON.Long || value instanceof BSON.Decimal128) return Number(value.toString())
  return NaN
}
function source(doc, options) { return doc.guildId === options.productionGuildId ? 'production' : options.testGuildIds.includes(doc.guildId) ? 'test' : 'other/unknown' }
function planCollection(collection, docs, options) {
  const field = COLLECTIONS[collection]
  if (!field) throw new Error('Unsupported collection')
  const groups = new Map()
  for (const doc of docs) {
    if (!doc._id || !/^[a-f0-9]{24}$/.test(String(doc._id)) || !(doc._createdAt instanceof Date) || !Number.isFinite(+doc._createdAt) || typeof doc.userId !== 'string' || !doc.userId || typeof doc[field] !== 'string' || !doc[field]) throw new Error(`Invalid identity/date in ${collection}/${doc._id}`)
    const score = numericScore(doc.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`Invalid score in ${collection}/${doc._id}`)
    if (doc.isPrivate !== undefined && typeof doc.isPrivate !== 'boolean') throw new Error(`Invalid privacy in ${collection}/${doc._id}`)
    if (doc.isPrivate === undefined && !options.legacyPublicConfirmed) throw new Error('Confirm legacy missing privacy is public before planning')
    const key = JSON.stringify([doc.userId, doc[field]])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(doc)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, records]) => {
    records.sort((a, b) => +b._createdAt - +a._createdAt || String(b._id).localeCompare(String(a._id)))
    const winner = records[0]
    const after = { ...winner, isPrivate: records.some(d => d.isPrivate === true) }
    if (options.legacyOriginConfirmed && after.originGuildId == null && typeof winner.guildId === 'string' && winner.guildId) {
      after.originGuildId = winner.guildId
      after.originSource = 'legacy_guild'
    }
    // Unknown legacy edit time stays unknown; preserve any observed updatedAt.
    const entries = records.map((doc, i) => ({ originalReviewId: String(doc._id), recordKind: i ? 'DUPLICATE' : 'CANONICAL_BEFOREIMAGE', originalDocumentEjson: encode(doc), sourceChecksum: checksum(doc), source: source(doc, options), createdAt: doc._createdAt.toISOString(), score: numericScore(doc.score), comment: doc.comment ?? null, isPrivate: doc.isPrivate ?? null }))
    return { sourceCollection: collection, canonicalReviewId: String(winner._id), userId: winner.userId, mediaId: winner[field], expectedPostChecksum: checksum(after), postDocumentEjson: encode(after), testWinnerOverProduction: source(winner, options) === 'test' && records.some(d => source(d, options) === 'production'), entries }
  })
}
function assertArchive(row, entry) {
  if (!row || row.sourceChecksum !== entry.sourceChecksum || row.originalDocumentEjson !== entry.originalDocumentEjson || checksum(decode(row.originalDocumentEjson)) !== entry.sourceChecksum) throw new Error('Archive missing or checksum mismatch')
}
function transition(current, entry, group, rollback = false) {
  const hash = current ? checksum(current) : null
  if (rollback) {
    if (hash === entry.sourceChecksum) return 'skip'
    if (!current) return 'restore'
    if (entry.recordKind === 'CANONICAL_BEFOREIMAGE' && hash === group.expectedPostChecksum) return 'restore'
    throw new Error(`Rollback conflict: ${entry.originalReviewId}; preserve and reconcile later writes`)
  }
  if (entry.recordKind === 'DUPLICATE') {
    if (!current) return 'skip'
    if (hash === entry.sourceChecksum) return 'delete'
  } else {
    if (hash === group.expectedPostChecksum) return 'skip'
    if (hash === entry.sourceChecksum) return 'replace'
  }
  throw new Error(`Source changed: ${entry.originalReviewId}`)
}
module.exports = { COLLECTIONS, encode, decode, checksum, planCollection, assertArchive, transition }
