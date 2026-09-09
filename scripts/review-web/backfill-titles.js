#!/usr/bin/env node
'use strict'
const { MongoClient } = require('mongodb')
const { COLLECTIONS } = require('./migration-core')
const TYPES = { MovieReview: 'movie', SeriesReview: 'series', GameReview: 'game', MusicReview: 'music' }
function extractTitle(type, id, payload) {
  const record = type === 'game' ? (Array.isArray(payload) ? payload.find(r => String(r.id) === id) : null) : payload
  if (!record || String(record.id) !== id) throw new Error('Provider ID mismatch')
  const title = type === 'movie' ? record.title : record.name
  if (typeof title !== 'string' || !title.trim() || title.length > 1000) throw new Error('Missing/invalid provider title')
  return title.trim()
}
function normalizeTitle(title) { return title.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' ') }
async function fetchTitle(type, id, fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  if (type === 'music' ? !/^[a-zA-Z0-9]{22}$/.test(id) : !/^[0-9]+$/.test(id)) throw new Error('Invalid media ID')
  let url, init
  if (type === 'movie' || type === 'series') {
    if (!process.env.TMDB_TOKEN) throw new Error('TMDB_TOKEN required')
    url = `https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${id}`
    init = { headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` } }
  } else if (type === 'game') {
    if (!process.env.IGDB_ACCESS_TOKEN || !process.env.IGDB_CLIENT_ID) throw new Error('IGDB credentials required')
    url = 'https://api.igdb.com/v4/games'
    init = { method: 'POST', headers: { Authorization: `Bearer ${process.env.IGDB_ACCESS_TOKEN}`, 'Client-ID': process.env.IGDB_CLIENT_ID, 'Content-Type': 'text/plain' }, body: `fields name; where id = ${id}; limit 1;` }
  } else if (type === 'music') {
    if (!process.env.SPOTIFY_ACCESS_TOKEN) throw new Error('SPOTIFY_ACCESS_TOKEN required')
    url = `https://api.spotify.com/v1/albums/${id}`
    init = { headers: { Authorization: `Bearer ${process.env.SPOTIFY_ACCESS_TOKEN}` } }
  } else throw new Error('Unknown media type')
  for (let attempt = 0; attempt < 3; attempt++) {
    let response
    try { response = await fetcher(url, { ...init, signal: AbortSignal.timeout(10000) }) }
    catch { if (attempt === 2) throw new Error('Provider unavailable'); await sleep(500 * 2 ** attempt); continue }
    if (response.ok) return extractTitle(type, id, await response.json())
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retry = Number(response.headers?.get('retry-after'))
      await sleep(Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 10000) : 500 * 2 ** attempt)
      continue
    }
    throw new Error(`Provider status ${response.status}`)
  }
}
async function run() {
  const args = process.argv.slice(2)
  const mode = args[0] && !args[0].startsWith('--') ? args.shift() : 'dryrun'
  if (!['dryrun', 'apply'].includes(mode)) throw new Error('Mode: dryrun (default) or apply')
  const databaseName = args[args.indexOf('--database') + 1]
  if (!args.includes('--database') || !databaseName || !process.env.MIGRATION_DATABASE_URL) throw new Error('Require --database and MIGRATION_DATABASE_URL')
  const client = new MongoClient(process.env.MIGRATION_DATABASE_URL, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  try {
    const db = client.db(databaseName), titles = db.collection('MediaTitle')
    if (mode === 'apply') await titles.createIndex({ type: 1, mediaId: 1 }, { unique: true })
    let missing = 0, written = 0, failed = 0
    for (const [collection, field] of Object.entries(COLLECTIONS)) {
      // Small-database distinct enumeration; requests are serial and bounded.
      for (const mediaId of await db.collection(collection).distinct(field)) {
        const type = TYPES[collection]
        if (await titles.findOne({ type, mediaId })) continue
        missing++
        if (mode !== 'apply') continue
        try {
          const title = await fetchTitle(type, mediaId)
          await titles.updateOne({ type, mediaId }, { $setOnInsert: { type, mediaId, title, normalizedTitle: normalizeTitle(title), fetchedAt: new Date() } }, { upsert: true })
          written++
        } catch { failed++; console.error(JSON.stringify({ type, mediaId, status: 'unavailable' })) }
      }
    }
    console.log(JSON.stringify({ mode, missing, written, failed }))
    if (failed) process.exitCode = 1
  } finally { await client.close() }
}
if (require.main === module) run().catch(() => { console.error('Title backfill stopped; check target configuration.'); process.exitCode = 1 })
module.exports = { extractTitle, normalizeTitle, fetchTitle }
