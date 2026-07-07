import type { AnswerMode, AppState, Card, Checkpoint, Commitment, Deck, Grade, GradedAttempt, Note, NoteType, ReviewEvent, Settings, Tombstone } from './types.ts'
import type { PullResponse } from './sync-protocol.ts'
import { newId, getDeviceId } from './ids.ts'
import { clozeIndices } from './cloze.ts'
import { csvToNotes } from './csv.ts'
import { applyRemote, getCurrentBackendKind, getCurrentUserId, getCurrentPsDb, getSimulatedUserId, isProductionMode } from './sync.ts'

let _localUserEnforceWarned = false  // module flag to log 'local-user' only once in dev (no noisy repeats)
import { configureScheduler } from './fsrs.ts'
import { clampStake, resolveCommitments } from './accountability.ts'
import { FSRS_PARAMS_INSERT_SQL, fsrsParamsSqlValues, patchStateFromFsrsParams } from './fsrs-params.ts'
import type { FsrsParamsRow } from './fsrs-params.ts'
import { isLearnHighlightActive, learnMasteryRating, mergeLearnHighlight, shouldGraduateLearnMastery } from './learn.ts'
import { ratingFromResult } from './grading.ts'
import type { GradeResult } from './grading.ts'

const STORAGE_KEY = 'memorize-app-v1'
const DEFAULT_SETTINGS: Settings = { newPerDay: 20, desiredRetention: 0.9 }

const now = () => new Date().toISOString()

// Phase 5 subtask 3d + phase5-4: types now aligned with spike/db/postgres-schema.sql + client-schema.ts
// - deviceId required on ReviewEvent (backfilled in load for legacy)
// - userId? optional on Deck/Note/Card/ReviewEvent
// - updatedAt required on content entities (phase5-4: guaranteed in exportPush, used in LWW + PS stubs)
// - Card carries optional DERIVED FSRS cache (state/due/...); truth is still events + recomputeCard()
// All creation paths + updates/deletes ensure fields + tombstones. applyRemote/exportPush carry them.
// Deletes populate tombstones that map to grave (target_id) in PS.

// ---- persistence ----------------------------------------------------------

function load(): AppState | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AppState
    parsed.settings = { ...DEFAULT_SETTINGS, ...parsed.settings }
    parsed.tombstones = parsed.tombstones ?? []
    parsed.commitments = parsed.commitments ?? []
    parsed.checkpoints = parsed.checkpoints ?? []
    parsed.attempts = parsed.attempts ?? []
    parsed.learnHighlight = parsed.learnHighlight ?? null
    if (parsed.learnHighlight && !isLearnHighlightActive(parsed.learnHighlight)) {
      parsed.learnHighlight = null
    }

    // Backfill updatedAt for data created before Phase 5 update support (phase5-4: also used as fallback in LWW).
    // (prod schema has NOT NULL updated_at; we keep local always populated)
    const backfillUpdated = (items: any[]) => items.forEach((item) => { if (!item.updatedAt) item.updatedAt = item.createdAt })
    backfillUpdated(parsed.decks ?? [])
    backfillUpdated(parsed.notes ?? [])
    backfillUpdated(parsed.cards ?? [])

    // Backfill deviceId for legacy ReviewEvents (now required for prod schema alignment: review_log.device_id)
    const dev = getDeviceId()
    ;(parsed.events ?? []).forEach((e: any) => { if (!e.deviceId) e.deviceId = dev })

    return parsed
  } catch {
    return null
  }
}

function persist(s: AppState): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// ---- seed (first run) -----------------------------------------------------

function seed(): AppState {
  const state: AppState = { decks: [], notes: [], cards: [], events: [], tombstones: [], commitments: [], checkpoints: [], attempts: [], settings: { ...DEFAULT_SETTINGS }, learnHighlight: null }
  const geo = mkDeck(state, 'Geography')
  const bio = mkDeck(state, 'Biology')
  mkBasic(state, geo.id, 'Capital of France?', 'Paris')
  mkBasic(state, geo.id, 'Capital of Japan?', 'Tokyo')
  mkBasic(state, geo.id, 'Longest river in the world?', 'The Nile')
  mkCloze(state, bio.id, 'The powerhouse of the cell is the {{c1::mitochondria}}.')
  mkCloze(state, bio.id, '{{c1::DNA}} carries genetic information; it is transcribed into {{c2::RNA}}.')
  return state
}

function mkDeck(state: AppState, name: string): Deck {
  const ts = now()
  const d: Deck = { id: newId(), name, createdAt: ts, updatedAt: ts }
  state.decks.push(d)
  return d
}

function cardsForNote(note: Note): Card[] {
  const ts = now()
  if (note.type === 'cloze') {
    const idxs = clozeIndices(note.fields.text ?? '')
    const list = idxs.length ? idxs : [1]
    return list.map((n) => ({ id: newId(), noteId: note.id, deckId: note.deckId, ord: n - 1, createdAt: ts, updatedAt: ts }))
  }
  return [{ id: newId(), noteId: note.id, deckId: note.deckId, ord: 0, createdAt: ts, updatedAt: ts }]
}

function mkNote(state: AppState, deckId: string, type: NoteType, fields: Record<string, string>, tags: string[] = []): Note {
  const ts = now()
  const note: Note = { id: newId(), deckId, type, fields, tags, createdAt: ts, updatedAt: ts }
  state.notes.push(note)
  state.cards.push(...cardsForNote(note))
  return note
}

const mkBasic = (state: AppState, deckId: string, front: string, back: string, tags: string[] = []) =>
  mkNote(state, deckId, 'basic', { front, back }, tags)
const mkCloze = (state: AppState, deckId: string, text: string, tags: string[] = []) =>
  mkNote(state, deckId, 'cloze', { text }, tags)

// ---- observable store -----------------------------------------------------

let state: AppState = load() ?? (() => { const s = seed(); persist(s); return s })()
configureScheduler(state.settings.fsrsWeights)
{
  // Resolve any commitments that derailed or hit their deadline while away.
  const resolved = resolveCommitments(state, new Date())
  if (resolved !== state.commitments) {
    state = { ...state, commitments: resolved }
    persist(state)
  }
}
const listeners = new Set<() => void>()

function commit(next: AppState): void {
  state = next
  persist(state)
  for (const l of listeners) l()
}

export function getState(): AppState {
  return state
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---- mutations ------------------------------------------------------------

// Phase 5 subtask 3f + phase5-4 basic dual-mode wiring (store.ts):
// When backend==='powersync', mutations additionally call the write stub.
// This is the hook point for real PowerSync writes (direct to local PS SQLite tables
// per client-schema.ts, which then queue via ps_crud to uploadData in connector).
// deviceId is already on ReviewEvent; updatedAt set on content in these paths + backfill.
// phase5-4: for updates include updatedAt; deletes create grave entries ({target_id: id}) that
// flow via stub to PS and cause prune (see applyRemote tombstone handling).
// For 'local' this is a no-op; full state still pushed via exportPush on manual sync.
// Future: replace the stub call with actual psDb.execute('INSERT ...') or ORM writes.
// See sync.ts:createPowerSyncSyncBackend comments, spike/db/connector.ts:uploadData,
// and how to init PS db with schema (from subtask 3e or client-schema.ts ref).

async function powersyncWriteStub(op: string, data: Record<string, unknown>): Promise<void> {
  if (getCurrentBackendKind() !== 'powersync') return

  const psDb = getCurrentPsDb()
  const userId = getCurrentUserId()
  const prod = isProductionMode()

  // Hardened write-time enforcement (Phase 5 fix): reduce noisy 'local-user' warn in dev.
  // Log once at info/debug level for dev. Only error/throw in strict prod && no auth.
  // Keep hard throw ONLY when production && no auth for writes.
  // Local mode unaffected; PS mode still requires auth for *real* use (per spec).
  // Dual always works.
  if (userId === 'local-user' && !getSimulatedUserId()) {
    if (prod) {
      throw new Error('Authentication required for powersync production writes. Please sign in (anon) first.')
    }
    // dev: log once only
    if (!_localUserEnforceWarned) {
      console.info('[store] powersync write: using local-user (dev/sim); sign in via SyncBar for real auth/JWT. (logged once)')
      _localUserEnforceWarned = true
    }
    // proceed for dev compat (real prod throws above)
  }

  if (!psDb) {
    console.debug(`[store powersync-stub] ${op} (userId=${userId}) no psDb yet`, data)
    return
  }

  try {
    switch (op) {
      case 'review': {
        const { id, cardId, rating, reviewedAt, deviceId, durationMs } = data as any
        await psDb.execute(
          `INSERT INTO review_log (id, user_id, card_id, rating, reviewed_at, device_id, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, userId, cardId, rating, reviewedAt, deviceId || getDeviceId(), durationMs || null]
        )
        break
      }
      case 'addDeck':
      case 'updateDeck': {
        const { id, deckId, name, patch, createdAt, updatedAt } = data as any
        const realId = id || deckId
        const realName = name || (patch && patch.name) || '?'
        const ts = updatedAt || createdAt || now()
        let cAt = createdAt || ts
        if (!createdAt && realId) {
          try {
            const rows = await psDb.getAll('SELECT created_at FROM deck WHERE id = ?', [realId])
            if (rows.length && rows[0].created_at) cAt = rows[0].created_at
          } catch {}
        }
        await psDb.execute(
          `INSERT OR REPLACE INTO deck (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [realId, userId, realName, cAt, ts]
        )
        break
      }
      case 'addNote':
      case 'updateNote': {
        const { id, noteId, deckId, fields, tags, patch, createdAt, updatedAt } = data as any
        const realId = id || noteId
        const ts = updatedAt || createdAt || now()
        const flds = fields !== undefined ? fields : (patch && patch.fields) || {}
        const tgs = tags !== undefined ? tags : (patch && patch.tags) || []
        let dId = deckId
        let cAt = createdAt || ts
        if (realId) {
          try {
            const rows = await psDb.getAll('SELECT created_at, deck_id FROM note WHERE id = ?', [realId])
            if (rows.length) {
              if (rows[0].created_at && !createdAt) cAt = rows[0].created_at
              if (rows[0].deck_id && !dId) dId = rows[0].deck_id
            }
          } catch {}
        }
        const fieldsJson = JSON.stringify(flds || {})
        const tagsArr = tgs || []
        await psDb.execute(
          `INSERT OR REPLACE INTO note (id, user_id, deck_id, fields, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [realId, userId, dId, fieldsJson, JSON.stringify(tagsArr), cAt, ts]
        )
        // Add card writes for completeness (cards are template instances from note)
        // Only on addNote (updates to note fields do not auto-regen cards in current model)
        if (op === 'addNote' && data.cards && Array.isArray(data.cards)) {
          for (const card of data.cards as any[]) {
            await psDb.execute(
              `INSERT OR REPLACE INTO card (id, user_id, note_id, deck_id, ord, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [card.id, userId, realId, dId, card.ord, card.createdAt || ts, card.updatedAt || ts]
            )
          }
        }
        break
      }
      case 'deleteDeck':
      case 'deleteNote': {
        const { deckId, noteId, cardIds, graves } = data as any
        const ts = (data as any).tombstoneAt || now()
        // phase5-4: write to grave table for tombstone propagation (target_id = the deleted id)
        if (graves && Array.isArray(graves)) {
          for (const g of graves) {
            const graveId = newId() // or use a deterministic one
            await psDb.execute(
              `INSERT INTO grave (id, user_id, kind, target_id, created_at) VALUES (?, ?, ?, ?, ?)`,
              [graveId, userId, g.kind, g.target_id, ts]
            )
          }
        } else if (deckId) {
          const graveId = newId()
          await psDb.execute(
            `INSERT INTO grave (id, user_id, kind, target_id, created_at) VALUES (?, ?, ?, ?, ?)`,
            [graveId, userId, 'deck', deckId, ts]
          )
        } else if (noteId) {
          const graveId = newId()
          await psDb.execute(
            `INSERT INTO grave (id, user_id, kind, target_id, created_at) VALUES (?, ?, ?, ?, ?)`,
            [graveId, userId, 'note', noteId, ts]
          )
        }
        // Also delete the rows themselves (PS will sync the deletes)
        if (deckId) await psDb.execute(`DELETE FROM deck WHERE id = ?`, [deckId])
        if (noteId) await psDb.execute(`DELETE FROM note WHERE id = ?`, [noteId])
        if (cardIds && Array.isArray(cardIds)) {
          for (const cid of cardIds) {
            await psDb.execute(`DELETE FROM card WHERE id = ?`, [cid])
          }
        }
        break
      }
      case 'importCsv': {
        // Bulk import now writes decks/notes/cards directly to PS (was only logging counts).
        // Uses pre-built lists passed from importCsv() to ensure consistent IDs and full content.
        // Cross-ref: cardsForNote, client-schema.ts card table (user_id, note_id, deck_id, ord, *_at), reactivity listener (expects card deltas).
        const { newDecks, newNotes, newCards } = data as any
        if (newDecks && Array.isArray(newDecks)) {
          for (const d of newDecks) {
            await psDb.execute(
              `INSERT OR REPLACE INTO deck (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
              [d.id, userId, d.name, d.createdAt, d.updatedAt]
            )
          }
        }
        if (newNotes && Array.isArray(newNotes)) {
          for (const n of newNotes) {
            await psDb.execute(
              `INSERT OR REPLACE INTO note (id, user_id, deck_id, fields, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [n.id, userId, n.deckId, JSON.stringify(n.fields || {}), JSON.stringify(n.tags || []), n.createdAt, n.updatedAt]
            )
          }
        }
        if (newCards && Array.isArray(newCards)) {
          for (const c of newCards) {
            await psDb.execute(
              `INSERT OR REPLACE INTO card (id, user_id, note_id, deck_id, ord, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [c.id, userId, c.noteId, c.deckId, c.ord ?? 0, c.createdAt, c.updatedAt]
            )
          }
        }
        console.debug(`[store powersync-stub] importCsv wrote decks=${(newDecks||[]).length} notes=${(newNotes||[]).length} cards=${(newCards||[]).length}`)
        break
      }
      case 'updateSettings':
      case 'syncFsrsParams': {
        await psDb.execute(FSRS_PARAMS_INSERT_SQL, fsrsParamsSqlValues(userId, getState()))
        break
      }
      default:
        console.debug(`[store powersync-stub] unhandled op ${op}`, data)
    }
  } catch (e) {
    console.error(`[store powersync] write error for ${op}`, e)
  }
}

export function addDeck(name: string): Deck {
  const ts = now()
  const deck: Deck = { id: newId(), name: name.trim() || 'Untitled', createdAt: ts, updatedAt: ts }
  commit({ ...state, decks: [...state.decks, deck] })
  // 3f dual-mode powersync stub (see powersyncWriteStub)
  powersyncWriteStub('addDeck', { id: deck.id, name: deck.name, createdAt: ts, updatedAt: ts })
  return deck
}

export function updateDeck(deckId: string, patch: Partial<Pick<Deck, 'name'>>): void {
  const ts = now()
  const prev = state.decks.find((d) => d.id === deckId)
  commit({
    ...state,
    decks: state.decks.map((d) =>
      d.id === deckId ? { ...d, ...patch, updatedAt: ts } : d
    ),
  })
  // 3f dual-mode: updatedAt for LWW content sync in PS/Postgres
  // pass createdAt + name so stub INSERT OR REPLACE doesn't clobber created_at or fail to extract from patch
  powersyncWriteStub('updateDeck', { deckId, name: patch.name ?? prev?.name, createdAt: prev?.createdAt, updatedAt: ts })
}

export function deleteDeck(deckId: string): void {
  const ts = now()
  const noteIds = new Set(state.notes.filter((n) => n.deckId === deckId).map((n) => n.id))
  const cardIds = new Set(state.cards.filter((c) => noteIds.has(c.noteId)).map((c) => c.id))
  const graves: Tombstone[] = [
    { id: deckId, kind: 'deck' },
    ...[...noteIds].map((id): Tombstone => ({ id, kind: 'note' })),
    ...[...cardIds].map((id): Tombstone => ({ id, kind: 'card' })),
  ]
  commit({
    ...state,
    decks: state.decks.filter((d) => d.id !== deckId),
    notes: state.notes.filter((n) => !noteIds.has(n.id)),
    cards: state.cards.filter((c) => !cardIds.has(c.id)),
    events: state.events.filter((e) => !cardIds.has(e.cardId)),
    tombstones: [...state.tombstones, ...graves],
  })
  // phase5-4: include updatedAt equiv + graves for PS (will INSERT into grave table with target_id; DELETE or grave for content prune)
  powersyncWriteStub('deleteDeck', { deckId, noteIds: [...noteIds], cardIds: [...cardIds], tombstoneAt: ts, graves: graves.map(g => ({ target_id: g.id, kind: g.kind })) })
}

function addNote(deckId: string, type: NoteType, fields: Record<string, string>, tags: string[]): Note {
  const ts = now()
  const note: Note = { id: newId(), deckId, type, fields, tags, createdAt: ts, updatedAt: ts }
  const cards = cardsForNote(note) // compute once to ensure ID consistency between local state and PS writes (was double newId call)
  commit({ ...state, notes: [...state.notes, note], cards: [...state.cards, ...cards] })
  // 3f dual-mode powersync (note + derived cards)
  powersyncWriteStub('addNote', { id: note.id, deckId, type, fields, tags, updatedAt: ts, cards })
  return note
}

export function updateNote(noteId: string, patch: Partial<Pick<Note, 'fields' | 'tags'>>): void {
  const ts = now()
  const prev = state.notes.find((n) => n.id === noteId)
  commit({
    ...state,
    notes: state.notes.map((n) =>
      n.id === noteId ? { ...n, ...patch, updatedAt: ts } : n
    ),
  })
  // 3f dual-mode: updatedAt LWW for PS content sync (Phase 5 edit support)
  // pass deckId + createdAt so stub can do correct INSERT OR REPLACE (callers pass only {noteId,patch,updatedAt})
  powersyncWriteStub('updateNote', { noteId, patch, deckId: prev?.deckId, createdAt: prev?.createdAt, updatedAt: ts })
}

export const addBasicNote = (deckId: string, front: string, back: string, tags: string[] = []) =>
  addNote(deckId, 'basic', { front: front.trim(), back: back.trim() }, tags)

export const addClozeNote = (deckId: string, text: string, tags: string[] = []) =>
  addNote(deckId, 'cloze', { text: text.trim() }, tags)

export function deleteNote(noteId: string): void {
  const ts = now()
  const cardIds = new Set(state.cards.filter((c) => c.noteId === noteId).map((c) => c.id))
  const graves: Tombstone[] = [
    { id: noteId, kind: 'note' },
    ...[...cardIds].map((id): Tombstone => ({ id, kind: 'card' })),
  ]
  commit({
    ...state,
    notes: state.notes.filter((n) => n.id !== noteId),
    cards: state.cards.filter((c) => !cardIds.has(c.id)),
    events: state.events.filter((e) => !cardIds.has(e.cardId)),
    tombstones: [...state.tombstones, ...graves],
  })
  // phase5-4: include tombstoneAt/updated + graves (target_id) for PS grave table propagation + prune
  powersyncWriteStub('deleteNote', { noteId, cardIds: [...cardIds], tombstoneAt: ts, graves: graves.map(g => ({ target_id: g.id, kind: g.kind })) })
}

/** Record a review — appends an immutable event (the only scheduling write). */
export function review(cardId: string, rating: Grade, durationMs?: number, at: Date = new Date()): void {
  const ev: ReviewEvent = {
    id: newId(),
    cardId,
    rating,
    reviewedAt: at.toISOString(),
    durationMs,
    deviceId: getDeviceId(),
  }
  commit({ ...state, events: [...state.events, ev] })
  // 3f dual-mode: for powersync also stub-write (review_log is append-only in schema)
  powersyncWriteStub('review', { id: ev.id, cardId, rating, reviewedAt: ev.reviewedAt, deviceId: ev.deviceId, durationMs })
}

/**
 * Record a graded review (typed/blank/mcq answer mode). Auto-grading sets the
 * FSRS rating (correct → Good, near-miss → Hard, wrong → Again) so it drives
 * scheduling, and also logs a GradedAttempt for weak-concept scoring.
 */
export function submitGradedReview(cardId: string, mode: AnswerMode, result: GradeResult, durationMs?: number): void {
  const rating = ratingFromResult(result)
  const ts = now()
  const ev: ReviewEvent = { id: newId(), cardId, rating, reviewedAt: ts, durationMs, deviceId: getDeviceId(), mode, correct: result.correct }
  const attempt: GradedAttempt = { id: newId(), cardId, mode, correct: result.correct, answeredAt: ts, source: 'review', durationMs }
  commit({ ...state, events: [...state.events, ev], attempts: [...state.attempts, attempt] })
  powersyncWriteStub('review', { id: ev.id, cardId, rating, reviewedAt: ts, deviceId: ev.deviceId, durationMs })
}

/** Record a Quiz attempt — scores for weak-concept analysis but does NOT affect FSRS scheduling. */
export function recordQuizAttempt(cardId: string, mode: AnswerMode, correct: boolean, durationMs?: number): GradedAttempt {
  const attempt: GradedAttempt = { id: newId(), cardId, mode, correct, answeredAt: now(), source: 'quiz', durationMs }
  commit({ ...state, attempts: [...state.attempts, attempt] })
  return attempt
}

/** Record a Learn-mode graded rung — feeds weak-concept analysis; SRS is driven by the self-rate rung via review(). */
export function recordLearnAttempt(cardId: string, mode: AnswerMode, correct: boolean, durationMs?: number): GradedAttempt {
  const attempt: GradedAttempt = { id: newId(), cardId, mode, correct, answeredAt: now(), source: 'learn', durationMs }
  commit({ ...state, attempts: [...state.attempts, attempt] })
  return attempt
}

/**
 * Graduate a card into FSRS after learn-mode mastery. Maps the top rung to a
 * rating (typed/passage → Good, blank → Good, mcq → Hard). Only runs when
 * learnGraduateFsrs is enabled; skips if the card already has review events
 * unless the mastery happened in a learn/catch-up phase (first introduction).
 */
export function graduateLearnMastery(
  cardId: string,
  mode: AnswerMode,
  phase: 'learn' | 'review' | 'catchup',
): void {
  if (!shouldGraduateLearnMastery(state, cardId, phase, mode)) return

  const rating = learnMasteryRating(mode)
  const ts = now()
  const ev: ReviewEvent = {
    id: newId(),
    cardId,
    rating,
    reviewedAt: ts,
    deviceId: getDeviceId(),
    mode,
    correct: true,
  }
  commit({ ...state, events: [...state.events, ev] })
  powersyncWriteStub('review', { id: ev.id, cardId, rating, reviewedAt: ts, deviceId: ev.deviceId })
}

function syncFsrsParamsStub(): void {
  powersyncWriteStub('syncFsrsParams', {})
}

/** Surface recently learn-graduated cards at the front of the Review queue. */
export function addLearnHighlight(cardIds: string[]): void {
  if (cardIds.length === 0) return
  const learnHighlight = mergeLearnHighlight(state.learnHighlight, cardIds)
  commit({ ...state, learnHighlight })
  syncFsrsParamsStub()
}

export function clearLearnHighlight(): void {
  if (!state.learnHighlight) return
  commit({ ...state, learnHighlight: null })
  syncFsrsParamsStub()
}

/** Remove one card from the learn highlight after it is reviewed. */
export function markLearnHighlightReviewed(cardId: string): void {
  if (!state.learnHighlight?.cardIds.includes(cardId)) return
  const remaining = state.learnHighlight.cardIds.filter((id) => id !== cardId)
  commit({ ...state, learnHighlight: remaining.length ? { ...state.learnHighlight, cardIds: remaining } : null })
  syncFsrsParamsStub()
}

/** Apply a synced fsrs_params row (settings + learn highlight) from PowerSync. */
export function applyFsrsParamsFromPs(row: FsrsParamsRow): void {
  commit(patchStateFromFsrsParams(state, row, { configureWeights: (w) => configureScheduler(w) }))
}

/** Test-only: replace in-memory state without touching localStorage seed. */
export function __setStateForTest(s: AppState): void {
  state = { ...s, learnHighlight: s.learnHighlight ?? null }
  configureScheduler(state.settings.fsrsWeights)
}

export function importCsv(text: string, defaultDeck = 'Imported'): { decksCreated: number; cardsAdded: number } {
  const rows = csvToNotes(text, defaultDeck)
  if (rows.length === 0) return { decksCreated: 0, cardsAdded: 0 }

  const decks = [...state.decks]
  const notes = [...state.notes]
  const cards = [...state.cards]
  const deckByName = new Map(decks.map((d) => [d.name.toLowerCase(), d]))
  let decksCreated = 0
  let cardsAdded = 0

  const newDecks: any[] = []
  const newNotes: any[] = []
  const newCards: any[] = []

  for (const r of rows) {
    let deck = deckByName.get(r.deck.toLowerCase())
    if (!deck) {
      const ts = now()
      deck = { id: newId(), name: r.deck, createdAt: ts, updatedAt: ts }
      decks.push(deck)
      deckByName.set(deck.name.toLowerCase(), deck)
      decksCreated++
      newDecks.push(deck)
    }
    const ts = now()
    const fields: Record<string, string> = r.type === 'cloze' ? { text: r.text } : { front: r.front, back: r.back }
    const note: Note = { id: newId(), deckId: deck.id, type: r.type, fields, tags: r.tags, createdAt: ts, updatedAt: ts }
    notes.push(note)
    const noteCards = cardsForNote(note) // one call -> consistent ids; cloze notes yield one card per {{cN::}}
    cards.push(...noteCards)
    cardsAdded += noteCards.length
    newNotes.push(note)
    newCards.push(...noteCards)
  }

  commit({ ...state, decks, notes, cards })
  powersyncWriteStub('importCsv', { decksCreated, cardsAdded, newDecks, newNotes, newCards })
  return { decksCreated, cardsAdded }
}

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...state.settings, ...patch }
  commit({ ...state, settings: next })
  // write fsrs_params in PS path (covers newPerDay, desiredRetention, weights etc.)
  powersyncWriteStub('updateSettings', { settings: next })
}

/** Wipe everything and re-seed (handy for demos). */
export function resetAll(): void {
  const s = seed()
  commit(s)
}

// Phase 5 dual-mode note (3f + phase5-4): all create/update/delete paths now set updatedAt (guaranteed),
// flow deviceId, and create grave-style tombstones on delete. powersyncWriteStub is called conditionally (incl. updatedAt + grave maps).
// 'local' completely unaffected.

/** Fold a server sync delta into local state (union events, upsert content, apply tombstones).
 * Backend-agnostic: called with deltas from either the local toy HTTP or (future) PowerSync buckets.
 * New fields from type alignment (userId, Card derived cache, deviceId req) flow through data.
 * phase5-4: tombstones/grave + updatedAt LWW fully supported in applyRemote.
 * See sync.ts:applyRemote and ../memorize-spike/db/ for production delta sources (Phase 5 subtask 3d + phase5-4).
 */
export function applyRemoteDelta(delta: PullResponse): void {
  commit(applyRemote(state, delta))
}

/** Apply personalized FSRS weights from the optimizer and persist them. */
export function setOptimizedWeights(weights: number[], reviewCount: number): void {
  configureScheduler(weights)
  const next = { ...state.settings, fsrsWeights: weights, lastOptimized: now(), optimizedReviewCount: reviewCount }
  commit({ ...state, settings: next })
  powersyncWriteStub('updateSettings', { settings: next })
}

/** Revert to default FSRS weights. */
export function resetWeights(): void {
  configureScheduler(null)
  const next = { ...state.settings, fsrsWeights: undefined, lastOptimized: undefined, optimizedReviewCount: undefined }
  commit({ ...state, settings: next })
  powersyncWriteStub('updateSettings', { settings: next })
}

// ---- accountability (Phase 4) ---------------------------------------------

export function addCommitment(input: Omit<Commitment, 'id' | 'createdAt' | 'status'>): Commitment {
  const c: Commitment = { ...input, id: newId(), createdAt: now(), status: 'active', stakeCents: clampStake(input.stakeCents) }
  const next = { ...state, commitments: [...state.commitments, c] }
  commit({ ...next, commitments: resolveCommitments(next, new Date()) })
  return c
}

export function cancelCommitment(id: string): void {
  commit({
    ...state,
    commitments: state.commitments.map((c) =>
      c.id === id && c.status === 'active' ? { ...c, status: 'cancelled', resolvedAt: now() } : c,
    ),
  })
}

/** Record a verified-recall checkpoint result, then re-resolve commitments. */
export function recordCheckpoint(cp: Omit<Checkpoint, 'id' | 'takenAt'>): Checkpoint {
  const full: Checkpoint = { ...cp, id: newId(), takenAt: now() }
  const next = { ...state, checkpoints: [...state.checkpoints, full] }
  commit({ ...next, commitments: resolveCommitments(next, new Date()) })
  return full
}

/** Re-evaluate commitments against the current time (call on mount / interval). */
export function tickCommitments(): void {
  const resolved = resolveCommitments(state, new Date())
  if (resolved !== state.commitments) commit({ ...state, commitments: resolved })
}
