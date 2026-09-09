/** Missing preference means public. An unreadable/invalid preference never does. */
export async function getWebVisibility(db: any, userId: string): Promise<boolean> {
  const preference = await db.reviewPreference.findUnique({ where: { userId } })
  if (!preference) return true
  if (typeof preference.isPublic !== 'boolean') throw new Error('Invalid review visibility preference')
  return preference.isPublic
}

export async function setWebVisibility(db: any, userId: string, isPublic: boolean): Promise<void> {
  await db.reviewPreference.upsert({
    where: { userId },
    create: { userId, isPublic },
    update: { isPublic, updatedAt: new Date() },
  })
}

export function publicReviewUrl(kind: 'user' | 'guild', id: string): string | null {
  if (process.env.WEB_ENABLED !== 'true' || !process.env.PUBLIC_WEB_BASE_URL) return null
  try {
    const base = new URL(process.env.PUBLIC_WEB_BASE_URL)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null
    base.pathname = `${base.pathname.replace(/\/$/, '')}/${kind === 'user' ? 'u' : 'g'}/${encodeURIComponent(id)}`
    base.search = ''
    base.hash = ''
    return base.toString()
  } catch {
    return null
  }
}
