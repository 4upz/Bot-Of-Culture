require('ts-node/register')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MongoClient, ObjectId } = require('mongodb')
const { PrismaClient } = require('@prisma/client')
const { PublicReviewService } = require('../src/web/service')
const { WebRevision } = require('../src/web/membership')
const { createWebApp } = require('../src/web/server')
const url = process.env.REVIEW_WEB_TEST_DATABASE_URL
if (
  url &&
  !/^mongodb:\/\/127\.0\.0\.1:\d+\/boc_review_web_test[a-z_]*(\?|$)/.test(url)
)
  throw Error(
    'Only explicitly local disposable boc_review_web_test database allowed',
  )
test(
  'real Mongo public policy, aggregates, keyset paging, source redaction and HTTP boundary',
  { skip: !url },
  async () => {
    const mongo = await MongoClient.connect(url)
    const db = mongo.db()
    const prisma = new PrismaClient({ datasources: { db: { url } } })
    let server, web
    try {
      await db.dropDatabase()
      const date = new Date(Date.now() - 100000),
        older = new Date(date - 100000)
      const review = (type, user, media, score, extra = {}) => ({
        _id: new ObjectId(),
        [type + 'Id']: media,
        userId: user,
        username: 'User ' + user,
        score,
        isPrivate: false,
        _createdAt: date,
        originGuildId: '99',
        comment: '**Good**\n- One\n- Two',
        ...extra,
      })
      await db.collection('MovieReview').insertMany([
        review('movie', '1', 'same', 4),
        review('movie', '2', 'same', 3),
        review('movie', '5', 'same', 4),
        review('movie', '6', 'same', 3),
        review('movie', '3', 'same', 5, { _createdAt: new Date() }),
        review('movie', '4', 'secret', 5),
        review('movie', '1', 'private', 5, { isPrivate: true }),
        review('movie', '1', 'missing-privacy', 5, { isPrivate: null }),
        review('movie', '1', 'quote', 4, {
          sharedFromUserId: '3',
          sharedFromUsername: 'Hidden',
          sharedFromComment: 'do not leak',
          isQuote: true,
        }),
        review('movie', '2', 'quote', 2),
        review('movie', '1', 'unknown', 3, {
          originGuildId: null,
          _createdAt: older,
        }),
      ])
      await db.collection('GameReview').insertOne(
        review('game', '1', 'same', 5, {
          _createdAt: older,
          updatedAt: new Date(),
        }),
      )
      await db
        .collection('ReviewPreference')
        .insertOne({ userId: '3', isPublic: false, updatedAt: new Date() })
      await db.collection('MediaTitle').insertMany([
        {
          type: 'movie',
          mediaId: 'same',
          title: 'Movie [A]',
          normalizedTitle: 'movie [a]',
          imageUrl: 'https://image.tmdb.org/t/p/w500/art.jpg',
          fetchedAt: date,
        },
        {
          type: 'game',
          mediaId: 'same',
          title: 'Game',
          normalizedTitle: 'game',
          fetchedAt: date,
        },
      ])
      let generation = 1
      let members = ['1', '2', '3', '5', '6']
      const roster = {
        get: () => ({
          members,
          name: 'Fixture server',
          generation,
          syncedAt: Date.now(),
        }),
      }
      const revision = new WebRevision()
      const service = new PublicReviewService({ db: prisma }, roster, revision)
      const all = await service.read('guild', '10', {})
      assert.equal(all.searchCoverage, 'partial')
      assert.equal(
        all.items.some(
          (i) =>
            i.mediaId === 'secret' ||
            i.mediaId === 'private' ||
            i.mediaId === 'missing-privacy',
        ),
        false,
      )
      const movie = all.items.find(
        (i) => i.type === 'movie' && i.mediaId === 'same',
      )
      assert.equal(movie.averageScore, 3.5)
      assert.equal(movie.visibleReviewCount, 4)
      assert.equal(
        movie.media.imageUrl,
        'https://image.tmdb.org/t/p/w500/art.jpg',
      )
      assert.equal(movie.reviews[0].media.imageUrl, movie.media.imageUrl)
      assert.equal(movie.latestReviewCreatedAt, date.toISOString())
      assert.equal(movie.reviews[0].reviewedInAnotherServer, true)
      assert.equal(all.items.at(-1).type, 'movie') // tied older rows: game sorts before movie
      const quoted = all.items
        .flatMap((i) => i.reviews)
        .find((r) => r.mediaId === 'quote' && r.userId === '1')
      assert.equal(quoted.sourceUnavailable, true)
      assert.equal(JSON.stringify(all).includes('do not leak'), false)
      const literal = await service.read('guild', '10', { q: '[a]' })
      assert.equal(literal.searchCoverage, 'partial')
      assert.deepEqual(
        literal.items.map((i) => i.media.title),
        ['Movie [A]'],
      )
      const expansion = await service.read(
        'title',
        '10',
        { cursor: literal.items[0].nextReviewCursor },
        'movie',
        'same',
      )
      assert.equal(literal.items[0].reviews.length, 3)
      assert.equal(expansion.items.length, 1)
      assert.equal(expansion.items[0].media.imageUrl, movie.media.imageUrl)
      let page = await service.read('profile', '1', { limit: '1' })
      const ids = []
      const initialCursor = page.nextCursor
      while (true) {
        ids.push(...page.items.map((i) => i.type + ':' + i.id))
        if (!page.nextCursor) break
        page = await service.read('profile', '1', {
          limit: '1',
          cursor: page.nextCursor,
        })
      }
      assert.equal(new Set(ids).size, ids.length)
      assert.equal(ids.length, 4)
      await db.collection('MovieReview').insertOne(
        review('movie', '1', 'after-snapshot', 5, {
          _createdAt: new Date(Date.now() + 5),
        }),
      )
      await db.collection('MediaTitle').insertOne({
        type: 'movie',
        mediaId: 'after-snapshot',
        title: 'Later',
        normalizedTitle: 'later',
        fetchedAt: new Date(),
      })
      await db
        .collection('MovieReview')
        .updateOne(
          { userId: '1', movieId: 'same' },
          { $set: { comment: 'edited', updatedAt: new Date() } },
        )
      assert.ok(
        await service.read('profile', '1', {
          limit: '1',
          cursor: initialCursor,
        }),
      )
      await db
        .collection('ReviewPreference')
        .insertOne({ userId: '1', isPublic: false, updatedAt: new Date() })
      await assert.rejects(
        service.read('profile', '1', {}),
        (e) => e.status === 404,
      )
      await db
        .collection('ReviewPreference')
        .updateOne({ userId: '1' }, { $set: { isPublic: true } })
      await assert.rejects(
        service.read('profile', '1', { limit: '1', cursor: initialCursor }),
        (e) => e.status === 409,
      )
      const first = await service.read('guild', '10', { limit: '1' })
      generation++
      members = ['1']
      await assert.rejects(
        service.read('guild', '10', { limit: '1', cursor: first.nextCursor }),
        (e) => e.status === 409,
      )
      await db
        .collection('MovieReview')
        .createIndex({ userId: 1, movieId: 1 }, { unique: true })
      const { saveGlobalReview } = require('../src/reviews/writeStore')
      const music = await saveGlobalReview(prisma.musicReview, 'music', {
        userId: '7',
        musicId: 'album',
        username: 'Seven',
        guildId: '10',
        score: 4,
      })
      assert.equal(music.review.replayability, null)
      await Promise.all(
        [3, 4].map((score) =>
          saveGlobalReview(prisma.movieReview, 'movie', {
            userId: '7',
            movieId: 'concurrent',
            username: 'Seven',
            guildId: '10',
            score,
          }),
        ),
      )
      assert.equal(
        await db
          .collection('MovieReview')
          .countDocuments({ userId: '7', movieId: 'concurrent' }),
        1,
      )
      web = createWebApp({ db: prisma }, roster, revision)
      server = web.app.listen(0, '127.0.0.1')
      await new Promise((resolve) => server.once('listening', resolve))
      const base = 'http://127.0.0.1:' + server.address().port
      const response = await fetch(base + '/api/v1/users/1/reviews')
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.match(
        response.headers.get('content-security-policy'),
        /frame-ancestors 'none'/,
      )
      assert.equal(
        (await fetch(base + '/api/v1/users/1/reviews', { method: 'POST' }))
          .status,
        405,
      )
      assert.equal((await fetch(base + '/u/1')).status, 200)
      assert.equal((await fetch(base + '/assets/viewer.js')).status, 200)
    } finally {
      web?.close()
      if (server) await new Promise((resolve) => server.close(resolve))
      await prisma.$disconnect()
      await db.dropDatabase()
      await mongo.close()
    }
  },
)

test(
  'ten title previews and copied sources have constant query bounds with Mongo',
  { skip: !url },
  async () => {
    const testUrl = url.replace(
      /boc_review_web_test[a-z_]*/,
      'boc_review_web_test_bounded',
    )
    const mongo = await MongoClient.connect(testUrl),
      db = mongo.db()
    const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } })
    try {
      await db.dropDatabase()
      const date = new Date(Date.now() - 10000)
      const rows = [],
        titles = []
      for (let title = 0; title < 11; title++) {
        const mediaId = `title-${String(title).padStart(2, '0')}`
        const type = ['movie', 'series', 'game', 'music'][title % 4]
        titles.push({
          type,
          mediaId,
          title: `Batch ${title}`,
          normalizedTitle: `batch ${title}`,
          fetchedAt: date,
        })
        for (let user = 1; user <= 5; user++)
          rows.push({
            _id: new ObjectId(),
            [type + 'Id']: mediaId,
            userId: String(user),
            username: `User${user}`,
            score: user,
            isPrivate: false,
            _createdAt: date,
            ...(user < 4
              ? {
                  sharedFromUserId: user === 1 ? '4' : '5',
                  sharedFromUsername: 'Source',
                  sharedFromComment: 'source quote',
                  isQuote: true,
                }
              : {}),
          })
      }
      for (const type of ['movie', 'series', 'game', 'music'])
        await db
          .collection(type[0].toUpperCase() + type.slice(1) + 'Review')
          .insertMany(rows.filter((row) => row[type + 'Id']))
      await db.collection('MediaTitle').insertMany(titles)
      await db
        .collection('ReviewPreference')
        .insertOne({ userId: '5', isPublic: false })
      let calls = 0
      let afterQuery
      const measured = new Proxy(prisma, {
        get(target, key) {
          const value = target[key]
          if (value && typeof value.aggregateRaw === 'function')
            return {
              aggregateRaw: async (args) => {
                calls++
                const result = await value.aggregateRaw(args)
                if (afterQuery) await afterQuery(args)
                return result
              },
            }
          return value
        },
      })
      const roster = {
        get: () => ({
          members: ['1', '2', '3', '4', '5'],
          generation: 1,
          name: 'Batch',
          syncedAt: Date.now(),
        }),
      }
      const service = new PublicReviewService(
        { db: measured },
        roster,
        new WebRevision(),
      )
      const first = await service.read('guild', '10', {})
      assert.equal(first.items.length, 10)
      assert.equal(new Set(first.items.map((title) => title.type)).size, 4)
      assert.equal(calls, 5)
      for (const title of first.items) {
        assert.equal(title.visibleReviewCount, 4)
        assert.equal(title.averageScore, 2.5)
        assert.equal(title.reviews.length, 3)
        assert.ok(title.nextReviewCursor)
        assert.equal(
          title.reviews.find((r) => r.userId === '3').sourceUnavailable,
          true,
        )
      }
      calls = 0
      const search = await service.read('guild', '10', { q: 'batch' })
      // Expansion cursors reuse the preference snapshot captured for search.
      assert.equal(calls, 7)
      assert.equal(search.items.length, 10)
      const expanded = await service.read(
        'title',
        '10',
        { cursor: search.items[0].nextReviewCursor },
        search.items[0].type,
        search.items[0].mediaId,
      )
      assert.equal(expanded.items.length, 1)
      assert.equal(expanded.items[0].userId, '1')
      assert.equal(expanded.items[0].sourceUnavailable, false)
      assert.equal(expanded.items[0].sharedFromComment, 'source quote')
      const second = await service.read('guild', '10', {
        cursor: first.nextCursor,
      })
      assert.equal(second.items.length, 1)
      assert.equal(
        new Set([...first.items, ...second.items].map((t) => t.mediaId)).size,
        11,
      )
      const controller = new AbortController()
      controller.abort()
      calls = 0
      await assert.rejects(
        service.read('guild', '10', {}, undefined, undefined, {
          deadline: Date.now() + 8000,
          signal: controller.signal,
        }),
        (e) => e.status === 503,
      )
      assert.equal(calls, 0)
      const during = new AbortController()
      afterQuery = () => during.abort()
      await assert.rejects(
        service.read('guild', '10', { q: 'batch' }, undefined, undefined, {
          deadline: Date.now() + 8000,
          signal: during.signal,
        }),
        (e) => e.status === 503,
      )
      assert.equal(calls, 1)
      afterQuery = async (args) => {
        if (args.pipeline.some((stage) => stage.$facet)) {
          afterQuery = undefined
          await db
            .collection('ReviewPreference')
            .insertOne({ userId: '1', isPublic: false })
        }
      }
      await assert.rejects(
        service.read('guild', '10', {}),
        (e) => e.status === 409,
      )
      await db.collection('ReviewPreference').deleteOne({ userId: '1' })
      const withoutSource = new PublicReviewService(
        { db: measured },
        { get: () => ({ ...roster.get(), members: ['1', '2', '3', '5'] }) },
        new WebRevision(),
      )
      const redacted = await withoutSource.read('guild', '10', {})
      assert.ok(
        redacted.items.every(
          (title) =>
            title.reviews.find((row) => row.userId === '1').sourceUnavailable,
        ),
      )
    } finally {
      await prisma.$disconnect()
      await db.dropDatabase()
      await mongo.close()
    }
  },
)

test(
  'on-demand artwork persists in MongoDB and preserves existing title text and cursor dates',
  { skip: !url },
  async () => {
    const { PublicArtworkService } = require('../src/web/artwork')
    const mongo = await MongoClient.connect(url)
    const db = mongo.db()
    const prisma = new PrismaClient({ datasources: { db: { url } } })
    let calls = 0
    const artwork = new PublicArtworkService(prisma, async () => {
      calls++
      return {
        title: 'Provider name',
        imageUrl: 'https://image.tmdb.org/t/p/w500/art.jpg',
      }
    })
    try {
      const old = new Date('2020-01-01')
      await db
        .collection('MediaTitle')
        .createIndex({ type: 1, mediaId: 1 }, { unique: true })
      await db.collection('MediaTitle').insertOne({
        type: 'movie',
        mediaId: '42',
        title: 'Saved title',
        normalizedTitle: 'saved title',
        fetchedAt: old,
      })
      const ticket = new URL(
        artwork.url('movie', '42'),
        'https://example.com',
      ).searchParams.get('ticket')
      assert.equal(
        await artwork.get('movie', '42', ticket),
        'https://image.tmdb.org/t/p/w500/art.jpg',
      )
      const stored = await db
        .collection('MediaTitle')
        .findOne({ type: 'movie', mediaId: '42' })
      assert.equal(stored.title, 'Saved title')
      assert.equal(stored.fetchedAt.toISOString(), old.toISOString())
      assert.equal(stored.imageUrl, 'https://image.tmdb.org/t/p/w500/art.jpg')
      assert.equal(calls, 1)
    } finally {
      artwork.close()
      await db.dropDatabase()
      await prisma.$disconnect()
      await mongo.close()
    }
  },
)
