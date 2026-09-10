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
function extractMetadata(type, id, payload) {
  const title = extractTitle(type, id, payload)
  const record = type === 'game' ? payload.find(r => String(r.id) === id) : payload
  let imageUrl = null
  if ((type === 'movie' || type === 'series') && typeof record.poster_path === 'string' && /^\/[\w.-]+$/.test(record.poster_path))
    imageUrl = 'https://image.tmdb.org/t/p/w500' + record.poster_path
  if (type === 'game' && typeof record.cover?.url === 'string')
    imageUrl = record.cover.url.replace(/^\/\//, 'https://').replace('t_thumb', 't_cover_big')
  if (type === 'music') imageUrl = record.images?.[0]?.url || null
  try {
    const url = new URL(imageUrl)
    imageUrl = url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048 ? url.href : null
  } catch { imageUrl = null }
  return { title, imageUrl }
}
async function fetchMetadata(type, id, fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  if (type === 'music' ? !/^[a-zA-Z0-9]{22}$/.test(id) : !/^[0-9]+$/.test(id)) throw new Error('Invalid media ID')
  let url, init
  if (type === 'movie' || type === 'series') {
    if (!process.env.TMDB_TOKEN) throw new Error('TMDB_TOKEN required')
    url = `https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${id}`
    init = { headers: { Authorization: `Bearer ${process.env.TMDB_TOKEN}` } }
  } else if (type === 'game') {
    if (!process.env.IGDB_ACCESS_TOKEN || !process.env.IGDB_CLIENT_ID) throw new Error('IGDB credentials required')
    url = 'https://api.igdb.com/v4/games'
    init = { method: 'POST', headers: { Authorization: `Bearer ${process.env.IGDB_ACCESS_TOKEN}`, 'Client-ID': process.env.IGDB_CLIENT_ID, 'Content-Type': 'text/plain' }, body: `fields name, cover.url; where id = ${id}; limit 1;` }
  } else if (type === 'music') {
    if (!process.env.SPOTIFY_ACCESS_TOKEN) throw new Error('SPOTIFY_ACCESS_TOKEN required')
    url = `https://api.spotify.com/v1/albums/${id}`
    init = { headers: { Authorization: `Bearer ${process.env.SPOTIFY_ACCESS_TOKEN}` } }
  } else throw new Error('Unknown media type')
  for (let attempt = 0; attempt < 3; attempt++) {
    let response
    try { response = await fetcher(url, { ...init, signal: AbortSignal.timeout(10000) }) }
    catch { if (attempt === 2) throw new Error('Provider unavailable'); await sleep(500 * 2 ** attempt); continue }
    if (response.ok) return extractMetadata(type, id, await response.json())
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retry = Number(response.headers?.get('retry-after'))
      await sleep(Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 10000) : 500 * 2 ** attempt)
      continue
    }
    throw new Error(`Provider status ${response.status}`)
  }
}
async function fetchTitle(type, id, fetcher, sleep) {
  return (await fetchMetadata(type, id, fetcher, sleep)).title
}
async function run() {
  const args = process.argv.slice(2)
  const mode = args[0] && !args[0].startsWith('--') ? args.shift() : 'dryrun'
  if (!['dryrun', 'apply'].includes(mode)) throw new Error('Mode: dryrun (default) or apply')
  const artwork = args.includes('--artwork')
  const databaseName = args[args.indexOf('--database') + 1]
  if (!args.includes('--database') || !databaseName || !process.env.MIGRATION_DATABASE_URL) throw new Error('Require --database and MIGRATION_DATABASE_URL')
  const client = new MongoClient(process.env.MIGRATION_DATABASE_URL, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  try {
    const db = client.db(databaseName), titles = db.collection('MediaTitle')
    if (mode === 'apply') await titles.createIndex({ type: 1, mediaId: 1 }, { unique: true })
    let missing = 0, written = 0, failed = 0, withoutArtwork = 0
    for (const [collection, field] of Object.entries(COLLECTIONS)) {
      // Small-database distinct enumeration; requests are serial and bounded.
      for (const mediaId of await db.collection(collection).distinct(field)) {
        const type = TYPES[collection]
        const existing = await titles.findOne({ type, mediaId })
        if (existing && (!artwork || existing.imageUrl)) continue
        missing++
        if (mode !== 'apply') continue
        try {
          const { title, imageUrl } = await fetchMetadata(type, mediaId)
          if (!imageUrl) withoutArtwork++
          if (existing) {
            // Retain last-known names, fetchedAt/cursor generations, and concurrent artwork writes.
            if (imageUrl) {
              const result = await titles.updateOne({ type, mediaId, imageUrl: { $in: [null, ''] } }, { $set: { imageUrl } })
              written += result.modifiedCount
            }
          } else {
            const result = await titles.updateOne({ type, mediaId }, { $setOnInsert: { type, mediaId, title, normalizedTitle: normalizeTitle(title), imageUrl, fetchedAt: new Date() } }, { upsert: true })
            written += result.upsertedCount
          }
        } catch { failed++; console.error(JSON.stringify({ type, mediaId, status: 'unavailable' })) }
      }
    }
    console.log(JSON.stringify({ mode, artwork, missing, written, failed, withoutArtwork }))
    if (failed) process.exitCode = 1
  } finally { await client.close() }
}
if (require.main === module) run().catch(() => { console.error('Title backfill stopped; check target configuration.'); process.exitCode = 1 })
module.exports = { extractTitle, extractMetadata, normalizeTitle, fetchTitle, fetchMetadata }
