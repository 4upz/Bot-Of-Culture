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
function overrideKey(override) { return JSON.stringify([override.collection, override.userId, override.mediaId]) }
function validateWinnerOverrides(overrides = []) {
  if (!Array.isArray(overrides)) throw new Error('Winner overrides must be an array')
  const seen = new Set()
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',')
  for (const override of overrides) {
    if (!exact(override, ['collection', 'userId', 'mediaId', 'canonicalReviewId', 'expectedSources']) || !Object.hasOwn(COLLECTIONS, override.collection) || typeof override.userId !== 'string' || !override.userId || typeof override.mediaId !== 'string' || !override.mediaId || typeof override.canonicalReviewId !== 'string' || !/^[a-f0-9]{24}$/.test(override.canonicalReviewId) || !Array.isArray(override.expectedSources) || override.expectedSources.length < 2) throw new Error('Invalid winner override: require exact duplicate group identity and sources')
    const ids = new Set()
    for (const source of override.expectedSources) {
      if (!exact(source, ['originalReviewId', 'sourceChecksum']) || typeof source.originalReviewId !== 'string' || !/^[a-f0-9]{24}$/.test(source.originalReviewId) || typeof source.sourceChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceChecksum) || ids.has(source.originalReviewId)) throw new Error('Invalid or duplicate winner override source')
      ids.add(source.originalReviewId)
    }
    if (!ids.has(override.canonicalReviewId)) throw new Error('Winner must be an expected source')
    const key = overrideKey(override)
    if (seen.has(key)) throw new Error('Duplicate winner override')
    seen.add(key)
  }
  return overrides
}
function assertWinnerOverridesApplied(groups, overrides = []) {
  for (const override of validateWinnerOverrides(overrides)) {
    const matches = groups.filter(group => group.sourceCollection === override.collection && group.userId === override.userId && group.mediaId === override.mediaId && group.canonicalReviewId === override.canonicalReviewId && group.selectionReason?.approvedOverrideChecksum === checksum(override))
    if (matches.length !== 1) throw new Error(`Unmatched winner override: ${overrideKey(override)}`)
  }
}
function planCollection(collection, docs, options) {
  const field = COLLECTIONS[collection]
  if (!Object.hasOwn(COLLECTIONS, collection)) throw new Error('Unsupported collection')
  const overrides = validateWinnerOverrides(options.winnerOverrides).filter(override => override.collection === collection)
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
  for (const override of overrides) if (!groups.has(JSON.stringify([override.userId, override.mediaId]))) throw new Error(`Unmatched winner override: ${overrideKey(override)}`)
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, records]) => {
    records.sort((a, b) => +b._createdAt - +a._createdAt || String(b._id).localeCompare(String(a._id)))
    const defaultWinner = records[0]
    const override = overrides.find(choice => choice.userId === defaultWinner.userId && choice.mediaId === defaultWinner[field])
    if (override && (records.length < 2 || records.length !== override.expectedSources.length || records.some(doc => !override.expectedSources.some(expected => expected.originalReviewId === String(doc._id) && expected.sourceChecksum === checksum(doc))))) throw new Error('Winner override source group mismatch')
    const winner = override ? records.find(doc => String(doc._id) === override.canonicalReviewId) : defaultWinner
    const selectionReason = override ? { kind: 'APPROVED_WINNER_OVERRIDE', defaultCanonicalReviewId: String(defaultWinner._id), approvedOverrideChecksum: checksum(override) } : { kind: 'NEWEST_CREATED_AT_OBJECT_ID' }
    const after = { ...winner, isPrivate: records.some(d => d.isPrivate === true) }
    if (options.legacyOriginConfirmed && after.originGuildId == null && typeof winner.guildId === 'string' && winner.guildId) {
      after.originGuildId = winner.guildId
      after.originSource = 'legacy_guild'
    }
    // Unknown legacy edit time stays unknown; preserve any observed updatedAt.
    const entries = records.map(doc => ({ originalReviewId: String(doc._id), recordKind: String(doc._id) === String(winner._id) ? 'CANONICAL_BEFOREIMAGE' : 'DUPLICATE', originalDocumentEjson: encode(doc), sourceChecksum: checksum(doc), source: source(doc, options), createdAt: doc._createdAt.toISOString(), score: numericScore(doc.score), comment: doc.comment ?? null, isPrivate: doc.isPrivate ?? null }))
    return { sourceCollection: collection, selectionReason, canonicalReviewId: String(winner._id), userId: winner.userId, mediaId: winner[field], expectedPostChecksum: checksum(after), postDocumentEjson: encode(after), testWinnerOverProduction: source(winner, options) === 'test' && records.some(d => source(d, options) === 'production'), entries }
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
module.exports = { validateWinnerOverrides, assertWinnerOverridesApplied, COLLECTIONS, encode, decode, checksum, planCollection, assertArchive, transition }
