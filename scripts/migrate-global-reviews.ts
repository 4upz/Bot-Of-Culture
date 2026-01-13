/**
 * Migration script: Deduplicate reviews for global reviews feature
 *
 * This script finds duplicate reviews (same user + same media item across different servers)
 * and keeps only the most recent one, deleting the older duplicates.
 *
 * Run this BEFORE applying the new schema with the unique constraint on [mediaId, userId]
 *
 * Usage: npx ts-node scripts/migrate-global-reviews.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface ReviewGroup {
  odriguez: string
  count: number
  reviews: Array<{ id: string; createdAt: Date; guildId: string }>
}

async function deduplicateReviews(
  collectionName: 'movieReview' | 'seriesReview' | 'gameReview' | 'musicReview',
  mediaIdField: 'movieId' | 'seriesId' | 'gameId' | 'musicId'
) {
  console.log(`\n--- Processing ${collectionName} ---`)

  const collection = prisma[collectionName] as any

  // Get all reviews
  const allReviews = await collection.findMany({
    select: {
      id: true,
      userId: true,
      [mediaIdField]: true,
      guildId: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc', // Most recent first
    },
  })

  console.log(`Total reviews: ${allReviews.length}`)

  // Group by userId + mediaId
  const groups = new Map<string, typeof allReviews>()

  for (const review of allReviews) {
    const key = `${review.userId}_${review[mediaIdField]}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(review)
  }

  // Find duplicates (groups with more than 1 review)
  const duplicateGroups = Array.from(groups.entries()).filter(
    ([_, reviews]) => reviews.length > 1
  )

  console.log(`Found ${duplicateGroups.length} users with duplicate reviews`)

  if (duplicateGroups.length === 0) {
    console.log('No duplicates to process')
    return { processed: 0, deleted: 0 }
  }

  let totalDeleted = 0

  for (const [key, reviews] of duplicateGroups) {
    // Reviews are already sorted by createdAt desc, so first one is most recent
    const [keep, ...toDelete] = reviews

    console.log(
      `  User ${keep.userId} has ${reviews.length} reviews for ${mediaIdField}=${keep[mediaIdField]}`
    )
    console.log(`    Keeping review from ${keep.createdAt} (guild: ${keep.guildId})`)

    for (const review of toDelete) {
      console.log(`    Deleting review from ${review.createdAt} (guild: ${review.guildId})`)
      await collection.delete({ where: { id: review.id } })
      totalDeleted++
    }
  }

  return { processed: duplicateGroups.length, deleted: totalDeleted }
}

async function main() {
  console.log('=== Global Reviews Migration: Deduplicating Reviews ===')
  console.log('This will keep the most recent review for each user+media combination')
  console.log('')

  try {
    const results = {
      movie: await deduplicateReviews('movieReview', 'movieId'),
      series: await deduplicateReviews('seriesReview', 'seriesId'),
      game: await deduplicateReviews('gameReview', 'gameId'),
      music: await deduplicateReviews('musicReview', 'musicId'),
    }

    console.log('\n=== Migration Summary ===')
    console.log(`Movie reviews: ${results.movie.processed} users deduplicated, ${results.movie.deleted} reviews deleted`)
    console.log(`Series reviews: ${results.series.processed} users deduplicated, ${results.series.deleted} reviews deleted`)
    console.log(`Game reviews: ${results.game.processed} users deduplicated, ${results.game.deleted} reviews deleted`)
    console.log(`Music reviews: ${results.music.processed} users deduplicated, ${results.music.deleted} reviews deleted`)

    const totalDeleted = results.movie.deleted + results.series.deleted + results.game.deleted + results.music.deleted
    console.log(`\nTotal reviews deleted: ${totalDeleted}`)
    console.log('\nMigration complete! You can now safely apply the new schema.')

  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
