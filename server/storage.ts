import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ReviewEvent, Tombstone } from '../src/core/types.ts'
import type { ContentRow, PullResponse } from '../src/core/sync-protocol.ts'

// The server's source of truth (dev toy only).
// Every stored row carries a monotonic `seq` so clients can pull only what's
// newer than their checkpoint cursor — the same idea as PowerSync's write
// checkpoints, just hand-rolled.
//
// Phase 5: In real PowerSync + Postgres, this role is played by the database
// + sync rules. See spike/db/ for the production schema (review_log is still
// append-only, content has updated_at for LWW; phase5-4: grave for tombstones).

interface Seq<T> {
  seq: number
  row: T
}
interface UserBag {
  events: Record<string, Seq<ReviewEvent>>
  content: Record<string, Seq<ContentRow>>
  tombs: Record<string, Seq<Tombstone>>
}
export interface DB {
  seq: number
  users: Record<string, UserBag>
}

export function emptyDB(): DB {
  return { seq: 0, users: {} }
}

function bag(db: DB, userId: string): UserBag {
  let b = db.users[userId]
  if (!b) {
    b = { events: {}, content: {}, tombs: {} }
    db.users[userId] = b
  }
  return b
}

/** Union a client's upload into the DB.
 * Events and tombstones are append-only by id.
 * Content now supports updates (Phase 5 + phase5-4 updatedAt prop) — we take the row (last writer wins for toy server).
 * Tombstones (phase5-4) align with grave table.
 */
export function pushDB(db: DB, userId: string, events: ReviewEvent[], content: ContentRow[], tombstones: Tombstone[]): void {
  const b = bag(db, userId)
  for (const e of events) if (!b.events[e.id]) b.events[e.id] = { seq: ++db.seq, row: e }
  for (const c of content) {
    // For updates, always (re)store with new seq so clients see the change
    b.content[c.id] = { seq: ++db.seq, row: c }
  }
  for (const t of tombstones) if (!b.tombs[t.id]) b.tombs[t.id] = { seq: ++db.seq, row: t }
}

/** Return every row with seq > cursor, plus the new high-water cursor. */
export function pullDB(db: DB, userId: string, cursor: number): PullResponse {
  const b = db.users[userId]
  if (!b) return { cursor, events: [], content: [], tombstones: [] }

  const after = <T>(rec: Record<string, Seq<T>>) => Object.values(rec).filter((x) => x.seq > cursor)
  const e = after(b.events)
  const c = after(b.content)
  const t = after(b.tombs)

  let maxSeq = cursor
  for (const x of [...e, ...c, ...t]) if (x.seq > maxSeq) maxSeq = x.seq

  return { cursor: maxSeq, events: e.map((x) => x.row), content: c.map((x) => x.row), tombstones: t.map((x) => x.row) }
}

export function loadDB(path: string): DB {
  if (!existsSync(path)) return emptyDB()
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DB
  } catch {
    return emptyDB()
  }
}

export function saveDB(path: string, db: DB): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(db))
}
