'use strict'
const { MongoClient, BSON } = require('mongodb')
const { PrismaClient } = require('@prisma/client')
const { PublicReviewService } = require('../../../dist/web/service')
const size = Number(process.argv[2])
if (![600, 6000].includes(size)) throw Error('Use600 or6000')
const wide = process.argv[3] === 'wide'
if (process.argv[3] && (!wide || size !== 6000))
  throw Error('Wide fixture requires 6000')
const uri =
  'mongodb://127.0.0.1:27028/boc_review_web_test_load_' +
  size +
  (wide ? '_wide' : '') +
  '?replicaSet=boc-tests&directConnection=true'
;(async () => {
  const mongo = await MongoClient.connect(uri),
    prisma = new PrismaClient({ datasources: { db: { url: uri } } }),
    plans = []
  try {
    for (const type of [
      'MovieReview',
      'SeriesReview',
      'GameReview',
      'MusicReview',
      'ReviewPreference',
      'MediaTitle',
    ]) {
      const key = type[0].toLowerCase() + type.slice(1),
        original = prisma[key].aggregateRaw.bind(prisma[key])
      prisma[key].aggregateRaw = async (args) => {
        plans.push({ collection: type, pipeline: args.pipeline })
        return original(args)
      }
    }
    const roster = {
      get: () => ({
        members: Array.from({ length: 84 }, (_, i) => String(i + 1)),
        name: 'Synthetic',
        generation: 1,
        syncedAt: Date.now(),
      }),
    }
    await new PublicReviewService({ db: prisma }, roster, { value: 0 }).read(
      'guild',
      '10',
      {},
    )
    const output = []
    for (const [i, plan] of plans.entries()) {
      const result = await mongo.db().command({
        explain: {
          aggregate: plan.collection,
          pipeline: BSON.EJSON.deserialize(plan.pipeline),
          cursor: {},
          maxTimeMS: 5000,
        },
        verbosity: 'executionStats',
      })
      const scans = [],
        indexes = new Set()
      function walk(v) {
        if (!v || typeof v !== 'object') return
        if (v.indexName) indexes.add(v.indexName)
        if (Array.isArray(v.indexesUsed))
          v.indexesUsed.forEach((x) => indexes.add(x))
        if (v.stage === 'COLLSCAN' || v.stage === 'IXSCAN') scans.push(v.stage)
        for (const value of Object.values(v)) walk(value)
      }
      walk(result)
      const cursor = result.stages?.find((s) => s.$cursor)?.$cursor
      output.push({
        query: i + 1,
        collection: plan.collection,
        executionTimeMillis: cursor?.executionStats?.executionTimeMillis,
        initialDocsExamined: cursor?.executionStats?.totalDocsExamined,
        indexes: [...indexes],
        scanStages: [...new Set(scans)],
      })
    }
    console.log(
      JSON.stringify(
        {
          datasetSize: size,
          fixtureShape: wide ? '4000 titles' : '400 titles',
          queries: output,
        },
        null,
        2,
      ),
    )
  } finally {
    await prisma.$disconnect()
    await mongo.close()
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
