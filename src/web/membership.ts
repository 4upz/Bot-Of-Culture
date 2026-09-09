import { BotClient } from '../Bot'
import { HttpError } from './query'
interface Snapshot {
  members: Set<string>
  name: string
  syncedAt: number
  generation: number
  ready: boolean
}
export class MembershipService {
  private snapshots = new Map<string, Snapshot>()
  private pending = new Map<string, Promise<void>>()
  private changes = new Map<string, Array<{ id: string; add: boolean }>>()
  private invalidations = 0
  private timer: ReturnType<typeof setInterval>
  constructor(private bot: BotClient, private now = () => Date.now()) {}
  get(id: string) {
    const s = this.snapshots.get(id)
    if (
      !s?.ready ||
      this.now() - s.syncedAt > 300000 ||
      !this.bot.isReady() ||
      !this.bot.guilds.cache.has(id)
    )
      throw new HttpError(
        503,
        'Server library temporarily unavailable. Try again shortly.',
      )
    return {
      members: [...s.members],
      name: s.name,
      syncedAt: s.syncedAt,
      generation: s.generation,
    }
  }
  invalidate(id?: string) {
    this.invalidations++
    for (const [key, s] of this.snapshots)
      if (!id || key === id) {
        s.ready = false
        s.generation++
      }
  }
  change(guildId: string, id: string, add: boolean) {
    this.changes.get(guildId)?.push({ id, add })
    const s = this.snapshots.get(guildId)
    if (s) {
      if (add) s.members.add(id)
      else s.members.delete(id)
      s.generation++
    }
  }
  async sync(id: string): Promise<void> {
    if (this.pending.has(id)) return this.pending.get(id)
    const job = this.fetch(id)
    this.pending.set(id, job)
    try {
      await job
    } finally {
      this.pending.delete(id)
    }
  }
  private async fetch(id: string) {
    const guild = this.bot.guilds.cache.get(id)
    if (!guild) {
      this.invalidate(id)
      return
    }
    const epoch = this.invalidations
    this.changes.set(id, [])
    try {
      const result = await guild.members.fetch({ time: 30000 })
      if (result.size < guild.memberCount)
        throw Error('Incomplete member snapshot')
      if (
        epoch !== this.invalidations ||
        !this.bot.isReady() ||
        !this.bot.guilds.cache.has(id)
      )
        throw Error('Snapshot invalidated')
      const members = new Set(result.keys())
      for (const event of this.changes.get(id) || [])
        event.add ? members.add(event.id) : members.delete(event.id)
      const previous = this.snapshots.get(id)
      const changed =
        !previous ||
        previous.members.size !== members.size ||
        [...members].some((member) => !previous.members.has(member))
      this.snapshots.set(id, {
        members,
        name: guild.name,
        syncedAt: this.now(),
        generation: (previous?.generation || 0) + (changed ? 1 : 0),
        ready: true,
      })
    } catch {
      this.invalidate(id)
    } finally {
      this.changes.delete(id)
    }
  }
  start() {
    this.bot.on('guildMemberAdd', (m) => this.change(m.guild.id, m.id, true))
    this.bot.on('guildMemberRemove', (m) =>
      this.change(m.guild.id, m.id, false),
    )
    this.bot.on('guildDelete', (g) => this.invalidate(g.id))
    this.bot.on('guildCreate', (g) => {
      void this.sync(g.id)
    })
    this.bot.on('shardDisconnect', () => this.invalidate())
    this.bot.on('shardReconnecting', () => this.invalidate())
    this.bot.on('shardResume', () => {
      void this.syncAll()
    })
    this.bot.on('ready', () => {
      void this.syncAll()
    })
    this.timer = setInterval(() => {
      void this.syncAll()
    }, 240000)
    this.timer.unref()
    if (this.bot.isReady()) void this.syncAll()
  }
  private async syncAll() {
    for (const id of this.bot.guilds.cache.keys()) await this.sync(id)
  }
  stop() {
    clearInterval(this.timer)
    this.invalidate()
  }
}
export class WebRevision {
  value = 0
  bump() {
    this.value++
  }
}
