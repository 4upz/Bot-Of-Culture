#!/usr/bin/env node
'use strict'
const fs = require('node:fs/promises')
const { MongoClient, BSON, ObjectId } = require('mongodb')
const { COLLECTIONS, validateWinnerOverrides, assertWinnerOverridesApplied, checksum, decode, planCollection, assertArchive, transition } = require('./migration-core')
async function save(path, data) {
  await fs.writeFile(`${path}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'w' })
  await fs.chmod(`${path}.tmp`, 0o600)
  await fs.rename(`${path}.tmp`, path)
}
function parseArgs(input) {
  const args = [...input]
  const mode = args[0] && !args[0].startsWith('--') ? args.shift() : 'dryrun'
  if (!['dryrun', 'apply', 'verify', 'rollback'].includes(mode)) throw new Error('Mode: dryrun (default), apply, verify, rollback')
  const values = new Set(['manifest', 'database', 'production-guild', 'test-guilds', 'winner-overrides'])
  const flags = new Set(['writers-paused', 'legacy-public-confirmed', 'legacy-origin-confirmed'])
  const parsed = new Map()
  for (let i = 0; i < args.length; i++) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : ''
    if ((!values.has(name) && !flags.has(name)) || parsed.has(name)) throw new Error('Unknown or duplicate migration option')
    if (values.has(name)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('Missing migration option value')
      parsed.set(name, value)
    } else parsed.set(name, true)
  }
  if (mode !== 'dryrun' && parsed.has('winner-overrides')) throw new Error('Winner overrides are only accepted when creating a dryrun manifest')
  return { mode, args, value: name => parsed.get(name) }
}
async function run() {
  const {mode, args, value} = parseArgs(process.argv.slice(2))
  const path = value('manifest')
  const databaseName = value('database')
  if (!path || !databaseName || !process.env.MIGRATION_DATABASE_URL) throw new Error('Require --manifest PATH --database NAME and MIGRATION_DATABASE_URL (never defaults to application DB)')
  if (['apply', 'rollback'].includes(mode) && !args.includes('--writers-paused')) throw new Error('Pause/drain all writers, then supply --writers-paused')
  const winnerOverrides = value('winner-overrides') ? validateWinnerOverrides(JSON.parse(await fs.readFile(value('winner-overrides'), 'utf8'))) : []
  const client = new MongoClient(process.env.MIGRATION_DATABASE_URL, { serverSelectionTimeoutMS: 10000, retryWrites: true })
  await client.connect()
  try {
    const db = client.db(databaseName)
    if (mode === 'dryrun') {
      if (!value('production-guild') || !value('test-guilds')) throw new Error('Require --production-guild ID --test-guilds ID,ID (or none)')
      const options = { winnerOverrides, productionGuildId: value('production-guild'), testGuildIds: value('test-guilds') === 'none' ? [] : value('test-guilds').split(','), legacyPublicConfirmed: args.includes('--legacy-public-confirmed'), legacyOriginConfirmed: args.includes('--legacy-origin-confirmed') }
      try { await fs.access(path); throw new Error('Manifest already exists; choose a new file') } catch (e) { if (e.code !== 'ENOENT') throw e }
      const plan = { version: 1, migrationBatchId: new ObjectId().toHexString(), databaseName, options, baselineCounts: {}, groups: [], auditErrors: [] }
      for (const collection of Object.keys(COLLECTIONS)) {
        // Preserve numeric BSON tags (including safe Long and integral Double) in archives.
        const docs = []
        for await (const doc of db.collection(collection).find({}, { promoteValues: false }).batchSize(100)) docs.push(doc)
        plan.baselineCounts[collection] = docs.length
        try {
          plan.groups.push(...planCollection(collection, docs, options))
        } catch (error) {
          // Keep the first actionable data error in each collection in the private report.
          // No invalid or partial collection plan can be applied.
          plan.auditErrors.push({ collection, reason: error.message })
        }
      }
      try { assertWinnerOverridesApplied(plan.groups, winnerOverrides) } catch (error) { plan.auditErrors.push({ collection: 'winner-overrides', reason: error.message }) }
      await save(path, { plan, planChecksum: checksum(plan), status: plan.auditErrors.length ? 'BLOCKED' : 'PLANNED' })
      console.log(JSON.stringify({ migrationBatchId: plan.migrationBatchId, groups: plan.groups.length, blockedCollections: plan.auditErrors.length, testWinners: plan.groups.filter(g => g.testWinnerOverProduction).map(g => ({ collection: g.sourceCollection, id: g.canonicalReviewId })), report: path }))
      if (plan.auditErrors.length) process.exitCode = 1
      return
    }
    const manifest = JSON.parse(await fs.readFile(path, 'utf8'))
    const { plan } = manifest
    if (manifest.planChecksum !== checksum(plan) || plan.databaseName !== databaseName) throw new Error('Manifest integrity/target mismatch')
    if (plan.auditErrors?.length) throw new Error('Blocked audit cannot be applied; resolve private report errors and create a new audit')
    assertWinnerOverridesApplied(plan.groups, plan.options.winnerOverrides)
    const archive = db.collection('ReviewMigrationArchive')
    if (mode === 'apply') await archive.createIndex({ migrationBatchId: 1, sourceCollection: 1, originalReviewId: 1, recordKind: 1 }, { unique: true })
    for (const group of plan.groups) {
      const collection = db.collection(group.sourceCollection)
      if (!COLLECTIONS[group.sourceCollection]) throw new Error('Unexpected source collection')
      // Persist and read back every original before any source write in this group.
      for (const entry of group.entries) {
        const key = { migrationBatchId: plan.migrationBatchId, sourceCollection: group.sourceCollection, originalReviewId: entry.originalReviewId, recordKind: entry.recordKind }
        if (mode === 'apply') {
          const row = { ...key, canonicalReviewId: group.canonicalReviewId, userId: group.userId, mediaId: group.mediaId, originalDocumentEjson: entry.originalDocumentEjson, sourceChecksum: entry.sourceChecksum, archivedAt: new Date(), operationState: 'ARCHIVED' }
          if (BSON.calculateObjectSize({ ...row, _id: new ObjectId() }) > 16 * 1024 * 1024) throw new Error('Archive exceeds MongoDB document limit')
          await archive.updateOne(key, { $setOnInsert: row }, { upsert: true })
        }
        assertArchive(await archive.findOne(key), entry)
      }
      if (mode === 'verify') {
        for (const entry of group.entries) {
          const current = await collection.findOne({ _id: new ObjectId(entry.originalReviewId) }, { promoteValues: false })
          if (entry.recordKind === 'DUPLICATE' ? current !== null : !current || checksum(current) !== group.expectedPostChecksum) throw new Error(`Verification mismatch ${entry.originalReviewId}`)
        }
        continue
      }
      const session = client.startSession()
      try {
        await session.withTransaction(async () => {
          if (mode === 'apply' && group.selectionReason?.kind === 'APPROVED_WINNER_OVERRIDE') {
            const currentIds = await collection.find({ userId: group.userId, [COLLECTIONS[group.sourceCollection]]: group.mediaId }, { session, projection: { _id: 1 } }).toArray()
            if (currentIds.some(doc => !group.entries.some(entry => entry.originalReviewId === String(doc._id)))) throw new Error('Winner override source group changed after audit')
          }
          for (const entry of group.entries) {
            const filter = { _id: new ObjectId(entry.originalReviewId) }
            const current = await collection.findOne(filter, { session, promoteValues: false })
            if (mode === 'apply' && !current && entry.recordKind === 'DUPLICATE') {
              // Missing data proves a resumable delete only when this batch committed it.
              // Read the durable state in the source transaction; freshly ARCHIVED is insufficient.
              const prior = await archive.findOne({ migrationBatchId: plan.migrationBatchId, sourceCollection: group.sourceCollection, originalReviewId: entry.originalReviewId, recordKind: entry.recordKind }, { session })
              if (prior?.operationState !== 'APPLIED') throw new Error(`Source missing before apply: ${entry.originalReviewId}`)
            }
            const action = transition(current, entry, group, mode === 'rollback')
            if (action === 'delete') await collection.deleteOne(filter, { session })
            if (action === 'replace') await collection.replaceOne(filter, decode(group.postDocumentEjson), { session })
            if (action === 'restore') {
              if (current) await collection.replaceOne(filter, decode(entry.originalDocumentEjson), { session })
              else await collection.insertOne(decode(entry.originalDocumentEjson), { session })
            }
            await archive.updateOne({ migrationBatchId: plan.migrationBatchId, sourceCollection: group.sourceCollection, originalReviewId: entry.originalReviewId, recordKind: entry.recordKind }, { $set: { operationState: mode === 'rollback' ? 'RESTORED' : 'APPLIED', ...(mode === 'rollback' ? { restoredAt: new Date() } : {}) } }, { session })
          }
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } })
      } finally { await session.endSession() }
    }
    if (mode === 'verify') {
      for (const collection of Object.keys(COLLECTIONS)) {
        const expected = plan.groups.filter(g => g.sourceCollection === collection).length
        if (await db.collection(collection).countDocuments({}) !== expected) throw new Error(`Count mismatch in ${collection}; reconcile new writes`)
      }
    }
    manifest.status = mode.toUpperCase()
    manifest.lastCheckedAt = new Date().toISOString()
    await save(path, manifest)
    console.log(`${mode} completed for batch ${plan.migrationBatchId}`)
  } finally { await client.close() }
}
if (require.main === module) run().catch(() => { console.error('Migration stopped. Inspect the private manifest and database state; credentials and review text are not logged.'); process.exitCode = 1 })
module.exports = { run, parseArgs }
