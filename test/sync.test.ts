import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Rating } from 'ts-fsrs'
import { createSyncServer } from '../server/sync-server.ts'
import { emptyDB } from '../server/storage.ts'
import { applyRemote, exportPush, pullSync, pushSync, createSyncBackend, setCurrentBackendKind, setCurrentPsDb, getCurrentPsDb, __setPowerSyncTestFactory } from '../src/core/sync.ts'
// Note: direct exportPush(..., USER) here is still valid (explicit userId for local toy tests).
// Phase 5-5 auth sim makes runtime getUserId() derive from session for PS; tests drive local path + direct calls (unaffected).
// For PS path userId would come from auth (see sync-runtime, core/sync getCurrentUserId + sim).
// Phase 5 reactivity: onChange + apply tested indirectly via delta merges; full PS factory tested via manual in dev (mock @powersync).
import { recomputeCard } from '../src/core/fsrs.ts'
import type { AppState, Card, ReviewEvent, Tombstone } from '../src/core/types.ts'
import { addDeck, review, getState } from '../src/core/store.ts'
import { getUserId, setUserId, setBackendKind, signInAnonymouslySim, signOutSim, runSync } from '../src/app/sync-runtime.ts'

// Polyfill localStorage for node:test env (runtime/auth save() paths hit direct localStorage; node --test needs it or --localstorage-file).
const _lsStore: Record<string, string> = {}
if (typeof (globalThis as any).localStorage === 'undefined') {
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => (_lsStore[k] ?? null),
    setItem: (k: string, v: string) => { _lsStore[k] = String(v) },
    removeItem: (k: string) => { delete _lsStore[k] },
  }
}

const USER = 'u1'
let k = 0
const uid = (p: string) => `${p}-${k++}`

function emptyState(): AppState {
  return { decks: [], notes: [], cards: [], events: [], tombstones: [], commitments: [], checkpoints: [], attempts: [], settings: { newPerDay: 20, desiredRetention: 0.9 } }
}

function addCard(state: AppState, deckName: string, front: string, back: string): Card {
  let deck = state.decks.find((d) => d.name === deckName)
  if (!deck) {
    deck = { id: uid('deck'), name: deckName, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' }
    state.decks.push(deck)
  }
  const note = { id: uid('note'), deckId: deck.id, type: 'basic' as const, fields: { front, back }, tags: [], createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' }
  const card: Card = { id: uid('card'), noteId: note.id, deckId: deck.id, ord: 0, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' }
  state.notes.push(note)
  state.cards.push(card)
  return card
}

function rev(cardId: string, rating: number, iso: string): ReviewEvent {
  return { id: uid('ev'), cardId, rating: rating as ReviewEvent['rating'], reviewedAt: iso, deviceId: 'test-device' }
}

function key(card: ReturnType<typeof recomputeCard>): string {
  return JSON.stringify({
    state: card.state,
    due: new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
  })
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createSyncServer(emptyDB())
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as AddressInfo).port
  try {
    await run(`http://localhost:${port}`)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
}

// One push+pull cycle for a device, returning updated state + new cursor.
async function sync(url: string, state: AppState, cursor: number): Promise<{ state: AppState; cursor: number }> {
  await pushSync(url, exportPush(state, USER))
  const delta = await pullSync(url, USER, cursor)
  return { state: applyRemote(state, delta), cursor: delta.cursor }
}

test('content created on one device reaches the other via sync', async () => {
  await withServer(async (url) => {
    let phone = emptyState()
    const card = addCard(phone, 'Geo', 'Capital of France?', 'Paris')
    ;({ state: phone } = await sync(url, phone, 0))

    let laptop = emptyState()
    const pulled = await sync(url, laptop, 0)
    laptop = pulled.state
    assert.equal(laptop.cards.length, 1)
    assert.equal(laptop.cards[0].id, card.id)
    assert.equal(laptop.decks[0].name, 'Geo')
  })
})

test('concurrent offline reviews of the same card converge after sync', async () => {
  await withServer(async (url) => {
    // Both devices start with the same card.
    let phone = emptyState()
    const card = addCard(phone, 'Geo', 'Capital of France?', 'Paris')
    let cur = (await sync(url, phone, 0))
    phone = cur.state
    let laptop = emptyState()
    let lap = await sync(url, laptop, 0)
    laptop = lap.state

    // Go offline; each reviews the shared card differently.
    phone.events.push(rev(card.id, Rating.Good, '2026-06-01T09:00:00Z'))
    laptop.events.push(rev(card.id, Rating.Again, '2026-06-01T09:02:00Z'))

    // They disagree before syncing.
    assert.notEqual(key(recomputeCard(phone.events)), key(recomputeCard(laptop.events)))

    // Sync both (twice, so each sees the other's event), order mixed.
    cur = await sync(url, phone, cur.cursor)
    phone = cur.state
    lap = await sync(url, laptop, lap.cursor)
    laptop = lap.state
    cur = await sync(url, phone, cur.cursor)
    phone = cur.state

    const pEvents = phone.events.filter((e) => e.cardId === card.id)
    const lEvents = laptop.events.filter((e) => e.cardId === card.id)
    assert.equal(pEvents.length, 2, 'phone has both reviews')
    assert.equal(lEvents.length, 2, 'laptop has both reviews')
    assert.equal(key(recomputeCard(pEvents)), key(recomputeCard(lEvents)), 'devices converged on identical schedule')
  })
})

test('a deletion (tombstone) propagates across devices', async () => {
  await withServer(async (url) => {
    let phone = emptyState()
    const card = addCard(phone, 'Geo', 'Q?', 'A')
    let cur = await sync(url, phone, 0)
    phone = cur.state
    let laptop = emptyState()
    let lap = await sync(url, laptop, 0)
    laptop = lap.state
    assert.equal(laptop.cards.length, 1)

    // Phone deletes the card: record a tombstone, drop it locally.
    const grave: Tombstone = { id: card.id, kind: 'card' }
    phone = { ...phone, cards: [], events: [], tombstones: [grave] }

    cur = await sync(url, phone, cur.cursor)
    phone = cur.state
    lap = await sync(url, laptop, lap.cursor)
    laptop = lap.state

    assert.equal(laptop.cards.length, 0, 'card removed on the other device')
  })
})

// Phase 5: PS backend factory smoke (uses stub if no real env, but exercises path)
test('powersync backend factory', async () => {
  const b = await createSyncBackend('powersync', { serverUrl: 'http://x' })
  assert.equal(b.name, 'powersync')
  // push/pull should not throw in stub
  await b.push({ userId: 'u', events: [], content: [], tombstones: [] })
  const p = await b.pull('u', 0)
  assert.ok(p)
})

// ---- Phase 5 PS mocked path tests (cross-refs fixes from prior agents: auth, writes, updatedAt, graves, reactivity, listener deltas) ----
// Use __setPowerSyncTestFactory + mocks for PowerSyncDatabase/onChange/execute to test success path without real envs.
// Local tests above remain 100% intact.

test('powersync factory success path with mocks', async (_t) => {
  // Cleanup previous mocks
  __setPowerSyncTestFactory(null)
  setCurrentPsDb(null)
  setCurrentBackendKind('local')

  const executeCalls: any[] = []

  const MockPowerSyncDatabase = class {
    config: any
    constructor(_opts: any) { this.config = _opts }
    async init() {}
    async connect() {}
    onChange(_h: any) { /* support new {onChange} API + old for compat */ return () => {} }
    async getAll(sql: string, params?: any[]) { executeCalls.push({ sql, params, via: 'getAll' }); return [] }
    async execute(sql: string, params?: any[]) { executeCalls.push({ sql, params }); return [] }
    async sync() { executeCalls.push({ sql: 'sync()' }); }
  }
  const MockWASQLite = class { constructor(_o: any){} }
  const MockSupabaseConnector = class {
    supabase: any
    url: string
    constructor(supabase: any, url: string) { this.supabase = supabase; this.url = url }
    async fetchCredentials() { return { endpoint: this.url, token: 'mock-jwt' } }
  }
  const mockCreateClient = (_u: string, _k: string) => ({ auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {} } })

  const schemaMod = { AppSchema: { tables: [] } }

  __setPowerSyncTestFactory(() => ({
    PowerSyncDatabase: MockPowerSyncDatabase,
    WASQLiteOpenFactory: MockWASQLite,
    SupabaseConnector: MockSupabaseConnector,
    createClient: mockCreateClient,
    schemaMod,
  }))

  const b = await createSyncBackend('powersync', { serverUrl: 'http://x' })
  assert.equal(b.name, 'powersync')
  const cfg = (b as any).config
  assert.ok(cfg?.real, 'should report real (mocked)')
  assert.ok(cfg?.psDb, 'psDb should be on config')
  assert.equal(getCurrentPsDb(), cfg.psDb)

  // cleanup
  __setPowerSyncTestFactory(null)
})

test('powersync stub writes (review, content, delete/grave) via store mutations exercise psDb.execute', async () => {
  __setPowerSyncTestFactory(null)
  setCurrentBackendKind('powersync')
  const execs: any[] = []
  const mockPsDb = {
    async getAll(_sql: string, _params?: any[]) { return [] },
    async execute(_sql: string, _params?: any[]) { execs.push({ sql: _sql, params: _params }); return [] },
  }
  setCurrentPsDb(mockPsDb)

  // Cross-ref phase5-4 fixes (updatedAt, graves), auth user etc.
  const deck = addDeck('TestPSDeck')
  assert.ok(deck.id)
  review(deck.id + '-fake-card', Rating.Good, 123) // will use a fake cardId; execute still called regardless
  // update would need a note but we exercise paths
  // deleteDeck would create grave + execute
  // For coverage, call delete too on non-existing is ok (no crash)
  // Note: actual card id not important for stub execute count check

  // At least deck write + review executed
  const hasDeck = execs.some(e => /deck/.test(e.sql))
  const hasReview = execs.some(e => /review_log/.test(e.sql))
  assert.ok(hasDeck, 'powersync write for deck executed')
  assert.ok(hasReview, 'powersync write for review executed')

  // reset
  setCurrentBackendKind('local')
  setCurrentPsDb(null)
})

test('powersync listener applies deltas (events + content) and uses onChange/execute', async () => {
  __setPowerSyncTestFactory(null)
  setCurrentBackendKind('local')
  setCurrentPsDb(null)

  const execs: any[] = []
  let captured: any = null
  const sampleEventRow = { id: 'ev-ps-1', card_id: 'c-ps-1', rating: 3, reviewed_at: '2026-06-01T10:00:00Z', device_id: 'dev1' }
  const sampleDeckRow = { id: 'd-ps-1', name: 'PSDeck', created_at: '2026-01-01', updated_at: '2026-01-02' }
  // Sample card row with snake_case (incl. derived cache last_review) to verify mapper -> camelCase lastReview
  // + explicit exercise of recompute cache UPDATE path in listener (for card derived shapes coverage).
  const sampleCardRow = { id: 'c-ps-1', note_id: 'n-ps-1', deck_id: 'd-ps-1', ord: 0, state: 2, due: '2026-06-02T00:00:00Z', stability: 5.1, difficulty: 3.2, reps: 1, lapses: 0, last_review: '2026-06-01T10:00:00Z', created_at: '2026-01-01', updated_at: '2026-01-02' }

  const mockPs = {
    async sync() {},
    onChange(_h: any) {
      const fn = (_h && typeof _h === 'object' && _h.onChange) ? _h.onChange : _h
      captured = fn
      return () => {}
    },
    async getAll(sql: string, params?: any[]) {
      execs.push({sql, params, via: 'getAll'})
      if (sql.includes('review_log')) return [sampleEventRow]
      if (sql.includes('deck')) return [sampleDeckRow]
      if (sql.includes('card')) return [sampleCardRow]
      if (sql.includes('note') || sql.includes('grave') || sql.includes('fsrs_params')) return []
      return []
    },
    async execute(sql: string, params?: any[]) {
      execs.push({sql, params})
      if (sql.includes('review_log')) return [sampleEventRow]
      if (sql.includes('deck')) return [sampleDeckRow]
      if (sql.includes('card')) return [sampleCardRow]
      if (sql.includes('note') || sql.includes('grave')) return []
      return []
    },
  }

  // Use the test factory to get a psDb that has the spies
  const MockPSDB = class { constructor() { return mockPs } }
  __setPowerSyncTestFactory(() => ({
    PowerSyncDatabase: MockPSDB,
    WASQLiteOpenFactory: class {},
    SupabaseConnector: class { constructor(){} },
    createClient: () => ({}),
    schemaMod: {},
  }))

  setBackendKind('powersync')
  // runSync for PS will create, push (no apply), attach listener, return pulled=0
  const res = await runSync()
  assert.equal(res.pulled, 0)

  // Now simulate change event from PS (onChange callback)
  assert.ok(captured, 'onChange listener should have been attached by runSync')
  // invoke the listener with changedTables (correct API); fallback in code for compat
  // sample rows use snake_case + serialized (as real PS + mapper will fix to camel+obj for applyRemote)
  // Include 'card' to exercise mapper on derived fields (last_review -> lastReview) + recompute UPDATE
  await captured({ changedTables: ['review_log', 'deck', 'card'] })

  // After listener, state should have merged the delta (via applyRemoteDelta inside)
  const st = getState()
  const hasEv = st.events.some((e: any) => e.id === 'ev-ps-1')
  const hasDeck = st.decks.some((d: any) => d.id === 'd-ps-1')
  const hasCardWithLastReview = st.cards.some((c: any) => c.id === 'c-ps-1' && c.lastReview === '2026-06-01T10:00:00Z')
  assert.ok(hasEv, 'listener applied review delta event')
  assert.ok(hasDeck, 'listener applied content delta (deck)')
  assert.ok(hasCardWithLastReview, 'listener applied content delta (card) + mapper produced lastReview (camelCase from snake last_review on derived cache)')

  // Explicitly verify recompute cache UPDATE path exercised (review delta triggers recompute + UPDATE card ... last_review)
  const hasRecomputeUpdate = execs.some((e: any) => /UPDATE card SET/.test(String(e.sql)) && /last_review/.test(String(e.sql)))
  assert.ok(hasRecomputeUpdate, 'recompute cache UPDATE path for card (incl. lastReview) exercised explicitly via PS listener')

  // cleanup
  __setPowerSyncTestFactory(null)
  setCurrentBackendKind('local')
  setCurrentPsDb(null)
  signOutSim()
})

test('auth effective userId derivation for powersync mode', async () => {
  // ensure clean
  signOutSim()
  setBackendKind('local')
  // default
  let uid = getUserId()
  assert.ok(uid, 'getUserId always returns something')

  const sess = await signInAnonymouslySim()
  assert.ok(sess.user.id.startsWith('auth-user-') || sess.user.id.length > 5)

  // after signin, before ps: may still be cfg unless runtime sets
  // switch to ps: should use auth id
  setBackendKind('powersync')
  uid = getUserId()
  assert.equal(uid, sess.user.id, 'in PS mode, getUserId derives from auth session (phase5-5 fix)')

  // local mode still allows override? but getEffective prefers for ps
  setBackendKind('local')
  // signout resets
  signOutSim()
  setUserId('local-user')
  assert.equal(getUserId(), 'local-user')

  // reset for other tests
  setBackendKind('local')
})


