'use strict'
const { MongoClient, ObjectId } = require('mongodb')
const size = Number(process.argv[2])
if (![600, 6000].includes(size)) throw Error('Use600 or6000')
const wide = process.argv[3] === 'wide'
if (process.argv[3] && (!wide || size !== 6000))
  throw Error('Wide fixture requires6000')
const titleCount = wide ? 4000 : 400
const name = 'boc_review_web_test_load_' + size + (wide ? '_wide' : '')
const uri =
  'mongodb://127.0.0.1:27028/' +
  name +
  '?replicaSet=boc-tests&directConnection=true'
;(async () => {
  const mongo = await MongoClient.connect(uri)
  try {
    const db = mongo.db()
    if (
      (await mongo.db('admin').admin().listDatabases()).databases.some(
        (d) => d.name === name,
      )
    )
      throw Error('Fixture already exists; refuse overwrite')
    const groups = {
        MovieReview: [],
        SeriesReview: [],
        GameReview: [],
        MusicReview: [],
      },
      titles = new Map(),
      types = ['movie', 'series', 'game', 'music'],
      start = Date.now() - size * 60000
    for (let i = 0; i < size; i++) {
      const type = types[i % 4],
        media = String(Math.floor((i % titleCount) / 4)),
        user = String(
          ((Math.floor(i / titleCount) * 13 + (i % titleCount)) % 84) + 1,
        ),
        coll = type[0].toUpperCase() + type.slice(1) + 'Review'
      const row = {
        _id: new ObjectId(),
        [type + 'Id']: media,
        userId: user,
        username: 'Synthetic ' + user,
        score: (i % 5) + 1,
        isPrivate: i % 37 === 0,
        originGuildId: '10',
        _createdAt: new Date(start + i * 60000),
        comment:
          '**Synthetic review.** ' +
          'A bounded representative comment. '.repeat(15),
      }
      if (Number(user) > 1 && i % 11 === 0) {
        row.sharedFromUserId = '1'
        row.sharedFromUsername = 'Synthetic 1'
        row.sharedFromComment = 'Synthetic source'
        row.isQuote = true
      }
      groups[coll].push(row)
      titles.set(type + ':' + media, {
        type,
        mediaId: media,
        title: 'Synthetic title ' + media,
        normalizedTitle: 'synthetic title ' + media,
        fetchedAt: new Date(start),
      })
    }
    for (const [coll, rows] of Object.entries(groups)) {
      await db.collection(coll).insertMany(rows)
      const type = coll.replace('Review', '').toLowerCase()
      await db
        .collection(coll)
        .createIndex({ userId: 1, [type + 'Id']: 1 }, { unique: true })
      await db.collection(coll).createIndex({ userId: 1, _createdAt: 1 })
      await db.collection(coll).createIndex({ [type + 'Id']: 1, _createdAt: 1 })
    }
    await db.collection('MediaTitle').insertMany([...titles.values()])
    await db
      .collection('MediaTitle')
      .createIndex({ type: 1, mediaId: 1 }, { unique: true })
    await db
      .collection('ReviewPreference')
      .createIndex({ userId: 1 }, { unique: true })
    await db
      .collection('ReviewPreference')
      .insertOne({ userId: '8', isPublic: false, updatedAt: new Date() })
    console.log(
      JSON.stringify({
        name,
        reviews: size,
        titles: titles.size,
        syntheticOnly: true,
      }),
    )
  } finally {
    await mongo.close()
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
