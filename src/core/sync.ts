import type { AppState, Card, Deck, Note, Tombstone } from './types.ts'
import type { ContentRow, PullResponse, PushBody, SyncBackend, SyncBackendKind } from './sync-protocol.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Centralized env var access. Prefers Vite's import.meta.env (VITE_* exposed in browser).
 * Falls back to process.env (node) and window (legacy). Used by runtime + PS backend.
 * Single definition to eliminate dup (was also in sync-runtime.ts).
 */
export function getEnvVar(name: string): string | undefined {
  if (typeof import.meta !== 'undefined' && (import.meta as any)?.env) {
    const env = (import.meta as any).env
    if (env[name] !== undefined) return env[name]
  }
  if (typeof process !== 'undefined' && process.env && process.env[name] !== undefined) {
    return process.env[name]
  }
  if (typeof window !== 'undefined') {
    const w: any = window
    if (w[name] !== undefined) return w[name]
  }
  return undefined
}

let currentBackendKind: SyncBackendKind = 'local'
let currentPsDb: any = null
let currentPsIsReal = false

// Production flag for strict enforcement (synced from runtime; core store.ts can read without cycle)
let _isProduction = false
export function setProductionMode(enabled: boolean): void {
  _isProduction = !!enabled
}
export function isProductionMode(): boolean {
  return _isProduction
}

// ---- Test-only hook for mocking PowerSync success path (no-op in prod) ----
// Allows tests to inject mocked PowerSyncDatabase / connector etc to cover
// factory success, onChange listener attachment, execute queries for deltas.
let __psTestFactory: any = null
export function __setPowerSyncTestFactory(factory: any): void {
  __psTestFactory = factory
}

// ---- Phase 5 subtask 5 (auth simulation) ----------------------------------
// Simulate Supabase auth (beyond 'local-user') to derive real userId + JWT for PS mode.
// Mirrors spike/db/connector.ts : fetchCredentials() returns {endpoint, token} from supabase.auth.getSession()
// We provide fetchSimulatedCredentials() + setSimulatedAuthToken() for dual-mode use.
// - local mode: may still use manual 'local-user' string via cfg (for sim/testing multi-user)
// - powersync mode: userId comes from auth session (set by runtime UI sign-in sim); token passed for connector.
// No @supabase/supabase-js dep yet (plan install later); this is pure sim so typecheck + run work immediately.
// When real: import { SupabaseClient } from '@supabase/supabase-js'; use actual getSession() in connector.
// See sync-runtime.ts for session load/signin, SyncBar for UI, postgres-schema.sql (user_id = auth.users.id)

export interface SimulatedAuthSession {
  user: { id: string; email?: string }
  access_token: string  // JWT used as PowerSync token (see connector.fetchCredentials)
}

let _simToken: string | null = null
let _simUserId: string | null = null

/** Set the simulated JWT (from anon signin). Called by runtime after sign-in. */
export function setSimulatedAuthToken(token: string | null, userId?: string | null): void {
  _simToken = token
  if (userId) _simUserId = userId
}

/** Mimics SupabaseConnector.fetchCredentials() from spike/db/connector.ts (without real Supabase).
 * Used by createPowerSyncSyncBackend and future real wiring.
 * In prod: await supabase.auth.getSession() then { endpoint: powersyncUrl, token: session.access_token }
 */
export function fetchSimulatedCredentials(powersyncUrl?: string): { endpoint: string; token: string } | null {
  if (!_simToken) return null
  return {
    endpoint: powersyncUrl || 'http://localhost:8080',  // placeholder; real from PS service url
    token: _simToken,
  }
}

/** Current effective userId from auth sim (or null). Runtime syncs this for PS mode. */
export function getSimulatedUserId(): string | null {
  return _simUserId
}

// Effective userId for dual mode (used by exportPush callers and powersyncWriteStub in store).
// Set by runtime when auth derives it (PS mode) or cfg (local). Tests may use direct exportPush with explicit.
let _currentUserId: string = 'local-user'

export function setCurrentUserId(id: string): void {
  _currentUserId = id?.trim() || 'local-user'
}

export function getCurrentUserId(): string {
  // Prefer auth-derived when present (PS/prod path)
  return getSimulatedUserId() || _currentUserId
}

// ---- pure merge logic (unit-testable, no I/O) -----------------------------
//
// Phase 5 (production): this logic is the invariant that survives the switch
// to real PowerSync + Postgres.
// - Events are always unioned by id (CRDT-style, append only).
// - Content uses updatedAt (with createdAt fallback) for last-writer-wins (supports edits).
// - Tomstones (grave) delete + prune events/content.
// PowerSync will deliver similar deltas (via bucket stream); we will call applyRemote after sync.
//
// exportPush + applyRemote are deliberately backend-agnostic (Phase 5 subtask phase5-4:
// full updatedAt propagation + tombstone/grave improvements for PS integration).
// The pluggable SyncBackend (see sync-protocol.ts) only abstracts the network step.
// See spike/db/postgres-schema.sql (updated_at on deck/note/card, grave table for tombstones),
// client-schema.ts (updated_at + grave with target_id), connector.ts (uploadData for PUT/PATCH/DELETE).

/** Everything this device knows, packaged for an upload.
 *
 * Backend-agnostic: same shape used for toy HTTP and (future) PowerSync upload queue.
 * deviceId (on events, now required) and updatedAt (on content) + optional userId/derived Card fields
 * are propagated from state (Phase 5 subtask 3d type alignment).
 * See ../memorize-spike/db/postgres-schema.sql (user_id, device_id, derived cache) + powersync-sync-rules.yaml.
 *
 * Phase 5-5 (auth): userId passed here is now typically derived from Supabase auth session (real user.id)
 * rather than editable 'local-user'. In local mode manual cfg still allowed for simulation.
 * exportPush itself is pure; caller (runtime) ensures correct id from getCurrentUserId / auth.
 */
export function exportPush(state: AppState, userId: string): PushBody {
  // Phase 5 phase5-4: guarantee updatedAt on every content row for full propagation
  // to PowerSync (maps to updated_at column for LWW). Fallback to createdAt ensures
  // robustness (backfills, legacy, or direct data).
  const ensureUpdatedAt = <T extends { createdAt: string; updatedAt?: string }>(obj: T) =>
    ({ ...obj, updatedAt: obj.updatedAt || obj.createdAt } as T & { updatedAt: string })

  const content: ContentRow[] = [
    ...state.decks.map((d): ContentRow => ({ id: d.id, kind: 'deck', data: ensureUpdatedAt(d) })),
    ...state.notes.map((n): ContentRow => ({ id: n.id, kind: 'note', data: ensureUpdatedAt(n) })),
    ...state.cards.map((c): ContentRow => ({ id: c.id, kind: 'card', data: ensureUpdatedAt(c) })),
  ]
  return { userId, events: state.events, content, tombstones: state.tombstones }
}

/**
 * Fold a server delta into local state. This is the Phase 0 thesis applied to a
 * real network boundary:
 *   - events    -> union by id (append-only, conflict-free)
 *   - content   -> upsert by id + updatedAt LWW (supports note/deck/card edits; phase5-4 strengthened)
 *   - tombstones -> union, then drop the tombstoned ids (and any orphaned events)
 * Pure and order-independent: applying deltas in any order yields the same state,
 * and a card's schedule is whatever recomputeCard() derives from the merged log.
 * New fields (userId, Card derived cache) flow through as part of the data row (LWW).
 *
 * Used by both the current toy backend and the future PowerSync path (deltas
 * from bucket stream will be fed here). See spike/db/postgres-schema.sql (incl. DERIVED CACHE, updated_at),
 * powersync-sync-rules.yaml, client-schema.ts for the shape of rows.
 *
 * (Phase 5 subtask 3d + phase5-4: full updatedAt propagation + tombstone/grave for PS.)
 */
export function applyRemote(state: AppState, delta: PullResponse): AppState {
  const eventById = new Map(state.events.map((e) => [e.id, e]))
  for (const e of delta.events) if (!eventById.has(e.id)) eventById.set(e.id, e)

  const deckById = new Map(state.decks.map((d) => [d.id, d]))
  const noteById = new Map(state.notes.map((n) => [n.id, n]))
  const cardById = new Map(state.cards.map((c) => [c.id, c]))

  // Phase 5 phase5-4: strengthen LWW using updatedAt or createdAt fallback.
  // This ensures correct ordering even if a row arrives without updatedAt (legacy/partial PS row).
  // In real PS path, rows will map updated_at -> updatedAt (or use created_at).
  const getTs = (obj: any) => {
    const u = obj?.updatedAt
    const c = obj?.createdAt
    const v = u || c
    return v ? Date.parse(v) : 0
  }

  for (const row of delta.content) {
    if (row.kind === 'deck') {
      const existing = deckById.get(row.id)
      const incoming = row.data as Deck
      if (!existing || getTs(incoming) >= getTs(existing)) deckById.set(row.id, incoming)
    } else if (row.kind === 'note') {
      const existing = noteById.get(row.id)
      const incoming = row.data as Note
      if (!existing || getTs(incoming) >= getTs(existing)) noteById.set(row.id, incoming)
    } else {
      const existing = cardById.get(row.id)
      const incoming = row.data as Card
      if (!existing || getTs(incoming) >= getTs(existing)) cardById.set(row.id, incoming)
    }
  }

  const tombById = new Map(state.tombstones.map((t) => [t.id, t]))
  // Phase 5 phase5-4 tombstone improvement: tolerate grave rows from PS (which use target_id instead of id)
  // so applyRemote works directly with deltas containing either shape (full sync integration).
  // Grave table (client-schema): {target_id, kind, ...} ; Tombstone wire: {id, kind}
  for (const t of delta.tombstones) {
    // Tolerate grave from PS (snake target_id from rows or camel targetId after mapPsRowToApp), plus plain {id,kind} tombstones
    const tid = (t as any).target_id || (t as any).targetId || (t as any).id
    const kind = t.kind
    if (tid && !tombById.has(tid)) tombById.set(tid, { id: tid, kind } as Tombstone)
  }

  const deadCards = new Set<string>()
  for (const t of tombById.values()) {
    if (t.kind === 'deck') deckById.delete(t.id)
    else if (t.kind === 'note') noteById.delete(t.id)
    else { cardById.delete(t.id); deadCards.add(t.id) }
  }

  return {
    ...state,
    decks: [...deckById.values()],
    notes: [...noteById.values()],
    cards: [...cardById.values()],
    events: [...eventById.values()].filter((e) => !deadCards.has(e.cardId)),
    tombstones: [...tombById.values()],
  }
}

// ---- HTTP transport (usable from browser and Node) ------------------------
// These implement the 'local' backend and are kept for:
// - direct use by tests (test/sync.test.ts imports them)
// - the pluggable local SyncBackend factory below
// Phase 5: in production these are replaced by PowerSync SDK calls (see connector.ts in spike).
// 3f: local kept fully working; powersync stub added.

export async function pushSync(baseUrl: string, body: PushBody): Promise<void> {
  const res = await fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`push failed: ${res.status}`)
}

export async function pullSync(baseUrl: string, userId: string, cursor: number): Promise<PullResponse> {
  const res = await fetch(`${baseUrl}/sync/pull?userId=${encodeURIComponent(userId)}&cursor=${cursor}`)
  if (!res.ok) throw new Error(`pull failed: ${res.status}`)
  return (await res.json()) as PullResponse
}

// ---- Phase 5 pluggable SyncBackend factories + dual-mode support -----------

// Phase 5 subtask 3f + phase5-4: basic dual mode for 'local' (toy) vs 'powersync'.
// 'local' path is 100% unaffected and continues to use the full-state exportPush + HTTP.
// 'powersync' returns a ready-for-impl SyncBackend stub; mutations in store.ts do basic
// conditional wiring for future direct writes.
// deviceId (from ids.ts getDeviceId) and updatedAt (set on all creates/updates, guaranteed in exportPush) flow
// automatically via exportPush and content rows (LWW in applyRemote).
// Tombstones from deletes also flow (phase5-4: mapped as grave for PS).

/** For store.ts dual-mode wiring (avoids app<->core cycle; runtime updates this on cfg change). */
export function setCurrentBackendKind(kind: SyncBackendKind): void {
  currentBackendKind = kind
}

export function getCurrentBackendKind(): SyncBackendKind {
  return currentBackendKind
}

export function setCurrentPsDb(db: any, isReal: boolean = !!db): void {
  currentPsDb = db
  currentPsIsReal = !!db && !!isReal
}

export function getCurrentPsDb(): any {
  return currentPsDb
}

/** Returns true if getCurrentPsDb() is a real initialized PowerSync instance (vs stub fallback).
 * Used for SyncBar status + enforcement UX. */
export function getIsRealPsDb(): boolean {
  return currentPsIsReal
}

/** Create the current dev 'local' (toy HTTP) backend using the given server URL. */
export function createLocalSyncBackend(serverUrl: string): SyncBackend {
  const url = serverUrl.replace(/\/$/, '')
  return {
    name: 'local-http',
    async push(body: PushBody) {
      await pushSync(url, body)
    },
    async pull(userId: string, cursor: number) {
      return pullSync(url, userId, cursor)
    },
  }
}

/**
 * Basic createPowerSyncSyncBackend (Phase 5 subtask 3f + 5 auth sim + continuation).
 *
 * Returns a SyncBackend ready for real impl. push/pull are graceful no-ops (warn + empty delta)
 * so dual-mode switching and runSync do not throw and 'local' remains unaffected.
 *
 * For the *real* implementation (see PHASE5_MIGRATION_PLAN.md):
 * - Use dynamic import so the packages are not required at dev time.
 * - Initialize a PowerSyncDatabase with the schema from @db/client-schema (or ../../db/... at runtime).
 *   (Cross-ref: PHASE5_MIGRATION_PLAN.md remaining work, db/client-schema.ts comments.)
 * - Use (or adapt) the SupabaseConnector from spike/db/connector.ts
 * - In push: either let PS queue writes automatically, or explicitly call execute/inserts from store.
 * - In pull/sync: use psDb.sync() or watchers that feed into applyRemoteDelta.
 *
 * Auth (Phase 5-5): now accepts/uses simulated auth token (per connector.fetchCredentials).
 * - Call setSimulatedAuthToken(token, userId) from runtime after sign-in (mimics supabase session).
 * - Inside: fetchSimulatedCredentials() provides {endpoint, token} like SupabaseConnector.
 * - In real PS: the connector (from spike/db/connector.ts) will be passed to psDb.connect(connector);
 *   connector.fetchCredentials() will do the real supabase.auth.getSession() for JWT.
 * - userId for PushBody (when used) and backend logs comes from auth-derived getCurrentUserId().
 *
 * Future completion steps (deps + schema wiring from 3e):
 * - Install: npm install @powersync/web @supabase/supabase-js  (add to package.json; see below)
 * - Adapt SupabaseConnector from reference: ../memorize-spike/db/connector.ts
 *   (fetchCredentials for JWT + powersyncUrl; uploadData drains tx.crud PUT/PATCH/DELETE to supabase.from)
 * - Create PowerSyncDatabase instance with schema (from @db or prior 3e output; see CHANGELOG for wiring)
 * - Use dynamic import here to avoid hard dep: const mod = await import('@powersync/web')
 * - Mutations will write directly to the PS db tables (review_log appends, content upserts with updated_at).
 * - Sync happens via PS watch() + connector; runSync may call db.sync() or be skipped.
 * - See: SYNC.md "Swapping in PowerSync", spike/db/powersync-sync-rules.yaml, postgres-schema.sql
 * - uploadData + ps_crud is the replacement for our toy /sync/push.
 * - Keep using exportPush/applyRemote? Adapt or keep for compatibility; deltas from PS buckets feed applyRemote.
 *
 * deviceId -> review_log.device_id ; updatedAt -> LWW on deck/note/card.updated_at
 *
 * phase5-4 (updated_at + tombstones): exportPush now guarantees updatedAt (for PS updated_at);
 * applyRemote strengthens LWW + normalizes tombstones from grave (target_id) shape.
 * In real: PS pull deltas will include grave rows converted to tombstones; push body tombstones drive grave inserts.
 *
 * NOTE: package.json now lists @supabase/supabase-js and @powersync/web (see recent CHANGELOG).
 * Dynamic + alias in vite/tsconfig handle resolution without pulling db/ into src/ typecheck.
 */
export async function createPowerSyncSyncBackend(opts?: Record<string, unknown> & { serverUrl?: string; supabaseClient?: SupabaseClient }): Promise<SyncBackend> {
  // Phase 5: attempt real dynamic wiring (see PHASE5_MIGRATION_PLAN.md + review unification)
  // Singleton client from runtime (getSupabaseClient) passed through to connector to avoid multiple creations.
  // Real client ensures onAuth + signIn sessions propagate to fetchCredentials. Sim fallback in connector.
  fetchSimulatedCredentials(typeof opts?.serverUrl === 'string' ? opts.serverUrl : undefined) // legacy side
  getCurrentUserId() // side

  // Test hook path first (for mocked tests of factory success, onChange, execute, reactivity)
  if (__psTestFactory) {
    try {
      const f = __psTestFactory()
      const PowerSyncDatabase = f.PowerSyncDatabase
      const WASQLiteOpenFactory = f.WASQLiteOpenFactory
      const SupabaseConnectorCtor = f.SupabaseConnector
      const createClientFn = f.createClient
      const schemaMod = f.schemaMod || { AppSchema: {} }

      // Prefer passed client for auth unification even in test hook path
      const passed = (opts as any)?.supabaseClient
      const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || 'http://localhost:54321'
      const supabaseKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || 'anon-key-placeholder'
      const supabase = passed || ((typeof createClientFn === 'function')
        ? createClientFn(supabaseUrl, supabaseKey, { auth: { persistSession: true } })
        : { auth: { getSession: async () => ({ data: { session: null } }) } })

      const powersyncUrl = getEnvVar('VITE_POWERSYNC_URL') || 'http://localhost:8080'
      const connector = (typeof SupabaseConnectorCtor === 'function')
        ? new SupabaseConnectorCtor(supabase, powersyncUrl)
        : { fetchCredentials: async () => ({ endpoint: powersyncUrl, token: 'mock-token' }) }

      const fac = WASQLiteOpenFactory ? new WASQLiteOpenFactory({ dbFilename: 'powersync.db' }) : {}
      const psDb = new PowerSyncDatabase({ schema: (schemaMod as any).AppSchema || schemaMod, database: fac })
      setCurrentPsDb(psDb, true)
      return {
        name: 'powersync',
        async push(_body: PushBody) { if (typeof (psDb as any).sync === 'function') { try { await (psDb as any).sync() } catch {} } },
        async pull(_userId: string, cursor: number) { return { cursor, events: [], content: [], tombstones: [] } },
        config: { real: true, psDb, connector, how: 'test-mocked' },
      }
    } catch (e) {
      // continue to stub
    }
  }

  try {
    // Dynamic import so it doesn't break if not installed or in certain envs
    const { PowerSyncDatabase, WASQLiteOpenFactory } = await import('@powersync/web')
    // Use .ts extension (allowed by tsconfig allowImportingTsExtensions) for robust resolution in Node ESM --test (strip-types) + Vite.
    // Prevents ERR_MODULE_NOT_FOUND on relative dynamic in pure node runs; browser/Vite builds unaffected (resolve.extensions + alias).
    // Alias not needed here (file inside src/).
    const { SupabaseConnector } = await import('../powersync/supabase-connector.ts')

    // Prefer singleton real client passed from runtime.getSupabaseClient() (fixes multiple clients + propagation).
    // Only create fallback here for direct calls (e.g. some tests); real flow always passes it.
    let supabase: SupabaseClient
    const passed = (opts as any)?.supabaseClient as SupabaseClient | undefined
    if (passed) {
      supabase = passed
    } else {
      const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || 'http://localhost:54321'
      const supabaseKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || 'anon-key-placeholder'
      const { createClient } = await import('@supabase/supabase-js')
      supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: true }
      })
    }

    const powersyncUrl = getEnvVar('VITE_POWERSYNC_URL') || 'http://localhost:8080'

    const connector = new SupabaseConnector(supabase, powersyncUrl)

    // Use a simple in-memory / file based for browser dev. In real use proper VFS.
    const factory = new WASQLiteOpenFactory({ dbFilename: 'powersync.db' })

    // Dynamic import of our schema via @db alias (configured in vite.config.ts + tsconfig paths).
    // This fixes the Rollup resolution failure ("Could not resolve '../db/...'" during vite build).
    // Uses extensionless; @ts-ignore because db/ intentionally outside tsconfig include (excludes from typecheck).
    // Cross-ref PHASE5_MIGRATION_PLAN.md and recent CHANGELOG for migration context + dual-mode.
    // @ts-ignore - dynamic schema from @db/ (db/client-schema.ts kept outside src/ for typecheck reasons)
    const schemaMod = await import('@db/client-schema')
    const psDb = new PowerSyncDatabase({
      schema: (schemaMod as any).AppSchema,
      database: factory,
    })

    await psDb.init()
    await psDb.connect(connector)

    setCurrentPsDb(psDb, true)
    console.info('[powersync] Real PowerSyncDatabase initialized with dynamic import (using auth sim for credentials)')

    return {
      name: 'powersync',
      async push(_body: PushBody) {
        // In real PS, writes should be done via the psDb in store.ts mutations.
        // This push can trigger sync if wanted.
        try {
          // psDb.sync() may be available; use if present, else no-op (framework handles)
          if (typeof (psDb as any).sync === 'function') {
            await (psDb as any).sync()
          }
        } catch (e) {
          console.warn('[powersync] sync after push stub:', e)
        }
      },
      async pull(_userId: string, cursor: number) {
        // For demo, we can return empty; real usage should use db.watch() or onChange to feed applyRemoteDelta.
        // To make dual useful, expose the db for external use.
        return { cursor, events: [], content: [], tombstones: [] }
      },
      config: {
        real: true,
        psDb,           // callers (store) can use this for writes if they want
        connector,
        how: 'Mutations should use psDb.execute or the connector pattern now'
      },
    }
  } catch (err) {
    console.warn('[powersync] Dynamic load failed, falling back to pure stub. Install @powersync/web @supabase/supabase-js and provide VITE_* envs. Error:', err)
    // Fallback to the no-op stub (previous behavior)
    return {
      name: 'powersync',
      async push(_body: PushBody) {
        const u = getCurrentUserId()
        console.warn(`[powersync] stub push user=${u} (install deps + real config to use real PowerSync)`)
      },
      async pull(_u: string, c: number) {
        return { cursor: c, events: [], content: [], tombstones: [] }
      },
      config: { stub: true, error: String(err) }
    }
  }
}

/** Factory that returns the right SyncBackend for the given kind + options.
 * Also updates currentBackendKind for dual-mode use in store.ts.
 * Note: powersync variant is now async (dynamic imports).
 * Supports optional supabaseClient (from runtime singleton) for unified real auth.
 */
export async function createSyncBackend(kind: SyncBackendKind, opts: { serverUrl: string; supabaseClient?: SupabaseClient }): Promise<SyncBackend> {
  setCurrentBackendKind(kind)
  if (kind === 'powersync') {
    return await createPowerSyncSyncBackend(opts)
  }
  return createLocalSyncBackend(opts.serverUrl)
}
