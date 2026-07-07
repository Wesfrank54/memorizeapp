import { applyFsrsParamsFromPs, applyRemoteDelta, getState } from '../core/store.ts'
import { parseFsrsParamsRow } from '../core/fsrs-params.ts'
import { recomputeCard } from '../core/fsrs.ts'
import {
  exportPush,
  createSyncBackend,
  createLocalSyncBackend,
  createPowerSyncSyncBackend,
  setCurrentBackendKind,
  setSimulatedAuthToken,
  setCurrentUserId,
  getSimulatedUserId,
  getCurrentPsDb,
  getEnvVar,
  setProductionMode as setCoreProductionMode,
  isProductionMode as coreIsProductionMode,
  setCurrentPsDb,
} from '../core/sync.ts'
import type { SyncBackendKind } from '../core/sync-protocol.ts'
import type { SimulatedAuthSession } from '../core/sync.ts'

// Real Supabase client (Phase 5 real auth)
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient
  const url = getEnvVar('VITE_SUPABASE_URL')
  const key = getEnvVar('VITE_SUPABASE_ANON_KEY')
  if (url && key) {
    supabaseClient = createClient(url, key, { auth: { persistSession: true } })
    // Auto hydrate on real client. Note: full unify via saveAuthSim + onAuthStateChange listener (setupRealAuth)
    // This also ensures early session if persisted by supabase.
    supabaseClient.auth.getSession().then(({ data }) => {
      if (data.session) {
        const sess: SimulatedSession = { user: { id: data.session.user.id }, access_token: data.session.access_token }
        saveAuthSim(sess)
      }
    })
  }
  return supabaseClient
}

/** Setup real auth state change if real client (for phase5 real auth).
 * Improved to fully propagate: uses saveAuthSim which updates currentAuthSession + core _sim* + setCurrentUserId + storage.
 * onAuth fires for real Supabase; same client instance passed to connector so fetchCredentials sees updates.
 * No longer pure fire-and-forget.
 */
function setupRealAuth() {
  const client = getSupabaseClient()
  if (client && typeof client.auth.onAuthStateChange === 'function') {
    client.auth.onAuthStateChange((event, session) => {
      if (session) {
        const sess: SimulatedSession = { user: { id: session.user.id }, access_token: session.access_token }
        saveAuthSim(sess) // unifies scattered state: currentAuthSession, _simToken/_simUserId, cfg for PS, localStorage
        if (cfg.backend === 'powersync' || cfg.production) {
          cfg = { ...cfg, userId: session.user.id }
          save()
          setCurrentUserId(session.user.id)
        }
      } else if (event === 'SIGNED_OUT') {
        saveAuthSim(null)
      }
      // UI will refresh on next render or via its own listener
    })
  }
}
setupRealAuth()

// Owns the connection config + checkpoint cursor for the running app, and
// orchestrates one push+pull cycle against the sync server. The pure merge
// (applyRemote) and transport (push/pull) live in core/sync.ts.
//
// Phase 5: refactored for pluggable SyncBackend so we can swap the toy HTTP
// transport for PowerSync without changing export/apply or callers like SyncBar.
//
// Current default: 'local' (uses createLocalSyncBackend + fetch to /sync/push|pull).
// 'powersync' uses createPowerSyncSyncBackend (basic stub in 3f; ready for real).
//
// Dual mode: 'local' unaffected. runSync now handles powersync gracefully (no-op).
// The exportPush / applyRemote remain backend-agnostic (see sync.ts comments; phase5-4 updated).
// deviceId (from getDeviceId in review()) and updatedAt (from mutations, guaranteed in exportPush) flow
// through exportPush into PushBody automatically. Tombstones also propagate (mapped as grave in PS).
//
// References for PowerSync impl:
//   ../memorize-spike/db/connector.ts  (SupabaseConnector, uploadData for ps_crud; phase5-4 DELETE/grave)
//   ../memorize-spike/db/client-schema.ts  (AppSchema for PS init; grave, updated_at)
//   ../memorize-spike/db/postgres-schema.sql
//   ../memorize-spike/db/powersync-sync-rules.yaml
//   SYNC.md "Swapping in PowerSync (production)"
//   To complete: install deps, init PowerSyncDatabase w/ schema (3e), wire connector
//   server/ is the dev stand-in (see server/sync-server.ts comments).

// ---- Phase 5-5: Auth simulation (Supabase beyond local-user) ----------------
// Provides anon sign-in sim + session (JWT) to derive real userId (like auth.users.id).
// - local backend: still allows manual userId cfg for multi-user simulation/testing.
// - powersync: userId + token REQUIRED from auth; manual edit hidden in UI; PushBody uses auth id.
// Mirrors: spike/db/connector.ts fetchCredentials() using supabase.auth.getSession() for JWT.
// Simulated only (no @supabase dep yet) so everything runs. Real flow later: replace sim with
//   import { createClient } from '@supabase/supabase-js'
//   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
//   const { data } = await supabase.auth.signInAnonymously() or getSession()
//   then token = data.session.access_token ; userId = data.session.user.id
// Persists to localStorage so "user" survives reloads in dev. Prod will use real Supabase session.

const AUTH_KEY = 'memorize-auth-sim'

interface SimulatedSession extends SimulatedAuthSession {}  // re-export shape

let currentAuthSession: SimulatedSession | null = null

function loadAuthSim(): SimulatedSession | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as SimulatedSession
    // hydrate core sim too
    setSimulatedAuthToken(s.access_token, s.user.id)
    setCurrentUserId(s.user.id)
    return s
  } catch {
    return null
  }
}

function saveAuthSim(s: SimulatedSession | null): void {
  if (typeof localStorage !== 'undefined' && localStorage) {
    if (s) {
      localStorage.setItem(AUTH_KEY, JSON.stringify(s))
    } else {
      localStorage.removeItem(AUTH_KEY)
    }
  }
  if (s) {
    setSimulatedAuthToken(s.access_token, s.user.id)
    setCurrentUserId(s.user.id)
  } else {
    setSimulatedAuthToken(null, null)
    setCurrentUserId('local-user')
  }
  currentAuthSession = s
}

export function getAuthSession(): SimulatedSession | null {
  // Sync version for immediate use; prefer async version for real
  const realClient = getSupabaseClient()
  if (realClient) {
    // hydrate from real client (will trigger onAuthStateChange too for full update)
    realClient.auth.getSession().then(({ data }) => {
      if (data.session) {
        const sess: SimulatedSession = { user: { id: data.session.user.id }, access_token: data.session.access_token }
        saveAuthSim(sess)  // sets currentAuthSession + unifies with core sim + cfg
      }
    })
  }
  if (currentAuthSession === null) {
    currentAuthSession = loadAuthSim()
  }
  return currentAuthSession
}

/** Sign in (anon). Prefers real Supabase if VITE_SUPABASE_* envs are present (via getSupabaseClient).
 * Falls back to sim. Returns session. In PS mode this drives userId/JWT.
 */
export async function signInAnonymouslySim(): Promise<SimulatedSession> {
  const realClient = getSupabaseClient()
  if (realClient) {
    const { data, error } = await realClient.auth.signInAnonymously()
    if (!error && data.session) {
      const id = data.session.user.id
      const token = data.session.access_token
      const session: SimulatedSession = { user: { id }, access_token: token }
      saveAuthSim(session)
      if (cfg.backend === 'powersync' || cfg.production) {
        cfg = { ...cfg, userId: id }
        save()
      }
      return session
    }
    console.warn('[auth] real anon signin failed, falling to sim', error)
  }

  // Sim fallback (no real keys)
  const id = 'auth-user-' + (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14))
  const payload = btoa(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now()/1000) + 3600 }))
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.simulated-signature`
  const session: SimulatedSession = { user: { id }, access_token: token }
  saveAuthSim(session)
  if (cfg.backend === 'powersync' || cfg.production) {
    cfg = { ...cfg, userId: id }
    save()
  }
  return session
}

export function signOutSim(): void {
  saveAuthSim(null)
  // Always reset cfg userId on signout for clean state (local + PS getEffective will derive local-user when no auth)
  cfg = { ...cfg, userId: 'local-user' }
  save()
}

/** Effective userId: in PS/prod prefers auth-derived (from session), else cfg (local sim still editable). */
function getEffectiveUserId(): string {
  const auth = getAuthSession()
  if (auth && (cfg.backend === 'powersync' || cfg.production)) {
    return auth.user.id
  }
  return cfg.userId || 'local-user'
}

interface SyncConfig {
  serverUrl: string
  userId: string
  cursor: number
  /** 'local' (toy HTTP) or 'powersync' (Phase 5 dual mode stub ready for real PS). Persisted. */
  backend: SyncBackendKind
  /** Basic production flag (e.g. for future default URLs, stricter behavior, or UI). */
  production?: boolean
}

// Note: in powersync mode, userId in cfg is kept in sync with auth session (see getEffectiveUserId + set*).
// Manual setUserId is still accepted for 'local' simulation of other users.

const KEY = 'memorize-sync-cfg'
const DEFAULT: SyncConfig = {
  serverUrl: 'http://localhost:8787',
  userId: 'local-user',
  cursor: 0,
  backend: 'local',
  production: false,
}

function load(): SyncConfig {
  try {
    let rawObj: any = {}
    if (typeof localStorage !== 'undefined' && localStorage) {
      rawObj = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    }
    const raw = rawObj as Partial<SyncConfig>
    const loaded = { ...DEFAULT, ...raw }
    // back-compat + production flag: if legacy or prod mode requested, use powersync
    const backend: SyncBackendKind = (raw.backend === 'powersync' || loaded.production) ? 'powersync' : 'local'
    const cfgLoaded = { ...loaded, backend }
    // Phase 5 3f: keep core in sync for dual-mode store wiring (getCurrentBackendKind)
    setCurrentBackendKind(backend)
    setCoreProductionMode(!!loaded.production)  // sync prod to core early for writes enforcement
    // Phase 5-5 auth: hydrate auth session (may override userId for PS)
    loadAuthSim()
    if ((backend === 'powersync' || loaded.production) && getAuthSession()) {
      const authId = getAuthSession()!.user.id
      cfgLoaded.userId = authId
    }
    setCurrentUserId(cfgLoaded.userId)
    return cfgLoaded
  } catch {
    setCurrentBackendKind('local')
    setCurrentUserId('local-user')
    return { ...DEFAULT }
  }
}

let cfg = load()

function save(): void {
  if (typeof localStorage !== 'undefined' && localStorage) {
    localStorage.setItem(KEY, JSON.stringify(cfg))
  }
}

export function getServerUrl(): string {
  return cfg.serverUrl
}

export function setServerUrl(url: string): void {
  cfg = { ...cfg, serverUrl: url.trim() }
  save()
}

export function getUserId(): string {
  // Phase 5-5: returns effective (auth-derived in PS mode, cfg otherwise)
  return getEffectiveUserId()
}

export function setUserId(id: string): void {
  const trimmed = id.trim() || 'local-user'
  cfg = { ...cfg, userId: trimmed }
  setCurrentUserId(trimmed)
  // Only persist manual for local sim; in PS the auth session owns userId (hide edit in UI)
  if (cfg.backend !== 'powersync' && !cfg.production) {
    save()
  }
}

// ---- Phase 5 backend + production config -----------------------------------

export function getBackendKind(): SyncBackendKind {
  return cfg.backend
}

export function setBackendKind(kind: SyncBackendKind): void {
  cfg = { ...cfg, backend: kind }
  setCurrentBackendKind(kind)  // Phase 5 3f: sync to core for store dual-mode if/when checks
  // Phase 5-5: if switching to PS and have auth, adopt its userId
  const auth = getAuthSession()
  if ((kind === 'powersync' || cfg.production) && auth) {
    cfg = { ...cfg, userId: auth.user.id }
    setCurrentUserId(auth.user.id)
  } else {
    setCurrentUserId(cfg.userId)
  }
  save()
}

/** Toggle basic production mode flag. Can be used to pick prod URLs or enable real backend wiring later. */
export function setProductionMode(enabled: boolean): void {
  const newBackend: SyncBackendKind = enabled ? 'powersync' : 'local'
  cfg = { ...cfg, production: !!enabled, backend: newBackend }
  setCurrentBackendKind(newBackend)
  setCoreProductionMode(!!enabled)  // sync to core for store.ts enforcement
  // 5-5 auth: adopt auth userId if present (PS/prod requires it)
  const auth = getAuthSession()
  if (enabled && auth) {
    cfg = { ...cfg, userId: auth.user.id }
    setCurrentUserId(auth.user.id)
  } else {
    setCurrentUserId(cfg.userId)
  }
  save()
}

export function isProductionMode(): boolean {
  return !!cfg.production
}

/** Returns the active backend name (e.g. 'local-http' or 'powersync'). Useful for debug.
 * (3f: now 'powersync' not '-stub')
 */
export async function getActiveBackendName(): Promise<string> {
  // Pass singleton client so powersync path uses unified real client (same as onAuth/signin) for connector
  const be = await createSyncBackend(cfg.backend, { serverUrl: cfg.serverUrl, supabaseClient: getSupabaseClient() as any })
  return be.name
}

// Factory helpers re-exported for tests / advanced use (they create fresh instances).
// 3f: createPowerSyncSyncBackend now returns non-throwing dual-mode stub.
// 5: auth sim helpers are defined+exported above; also re-export some core sim accessors
// getEnvVar centralized in core/sync.ts (imported + reexported)
export {
  createLocalSyncBackend,
  createPowerSyncSyncBackend,
  createSyncBackend,
  getSimulatedUserId,
  getEnvVar,
  getSupabaseClient,
}

let currentPowerSyncDb: any = null;
let psOnChangeDispose: (() => void) | null = null;

/** Expose the active PowerSyncDatabase instance (when powersync backend active).
 * Falls back to core's getCurrentPsDb() for advanced use / after factory before runSync.
 * Use for direct queries, custom watches, or debugging in prod/dual-mode.
 * Returns null/undefined when using local backend or not initialized.
 */
export function getPowerSyncDb() {
  return currentPowerSyncDb || getCurrentPsDb()
}

// Re-export core getters for convenience (advanced use, tests, without deep imports)
export { getCurrentPsDb, getIsRealPsDb, isProductionMode as coreIsProductionMode } from '../core/sync.ts'

/** Map PS row (snake_case + serialized JSON from SQLite) to app shape (camelCase + parsed objects).
 * Critical for PS path: PowerSync delivers rows with snake_case cols (per client-schema.ts + spike/db/postgres-schema.sql)
 * and text JSON for fields/tags/weights. applyRemote + UI + downstream expect camel + objects (note.deckId, note.fields.front, note.type, Card.lastReview etc).
 * Also handles grave normalization (target_id -> id) for applyRemote LWW tomb pruning.
 * Note table has no 'type' column (per schema); infer from fields shape for roundtrip.
 */
function mapPsRowToApp(row: any, kind: 'deck' | 'note' | 'card' | 'review' | 'grave' | 'fsrs_params'): any {
  if (!row) return row;
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    let key = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = v;
  }
  // Parse serialized JSON columns (fields for note content, tags array, weights for fsrs, sampled for checkpoints)
  if ((kind === 'note' || kind === 'fsrs_params') && typeof out.fields === 'string') {
    try { out.fields = JSON.parse(out.fields); } catch {}
  }
  if (kind === 'note' && typeof out.tags === 'string') {
    try { out.tags = JSON.parse(out.tags); } catch { out.tags = []; }
  }
  if (kind === 'fsrs_params' && typeof out.weights === 'string') {
    try { out.weights = JSON.parse(out.weights); } catch {}
  }
  if (kind === 'fsrs_params' && typeof out.learnHighlightCardIds === 'string') {
    try { out.learnHighlightCardIds = JSON.parse(out.learnHighlightCardIds); } catch {}
  }
  if (kind === 'fsrs_params' && typeof out.learnSettingsJson === 'string') {
    /* kept as string — parseFsrsParamsRow reads learnSettingsJson */
  }
  if (kind === 'fsrs_params' && typeof out.sampledCardIds === 'string') {
    try { out.sampledCardIds = JSON.parse(out.sampledCardIds); } catch {}
  }
  // Infer note.type (absent from PS schema tables; derived from fields for cloze vs basic)
  if (kind === 'note') {
    if (!out.type) {
      out.type = (out.fields && typeof out.fields === 'object' && 'text' in out.fields) ? 'cloze' : 'basic';
    }
  }
  // Normalize grave for tombstones: ensure {id, kind} where id === target (applyRemote tolerates; consistent with manual)
  if (kind === 'grave') {
    if (out.targetId) {
      out.id = out.targetId;
    }
  }
  return out;
}

/** One sync cycle: upload everything we know, download what's new, merge it in.
 * Uses the pluggable backend chosen by cfg.backend (dual-mode).
 *
 * Phase 5 3f: for 'powersync' we instantiate via createPowerSyncSyncBackend but treat push/pull
 * as no-op (see its impl + warnings). Real PS will drive writes from mutations (store.ts) and
 * receive via watch/connector rather than explicit runSync push+pull.
 * Pass config (serverUrl etc.); future will pass powersyncUrl, supabase etc.
 * References: ../memorize-spike/db/connector.ts (for uploadData impl), client-schema.ts
 *
 * Phase 5-5 auth: always uses getEffectiveUserId() (auth-derived for PS) for exportPush + pull.
 * Before push in PS, ensure a simulated session exists (sign-in provides JWT for future connector).
 */
export async function runSync(): Promise<{ pulled: number }> {
  const userId = getEffectiveUserId()
  // Ensure core state and sim token are in sync (for PS backend config + stubs)
  setCurrentUserId(userId)
  // Pass singleton client consistently: unifies auth (client from getSupabaseClient has live session from signin/onAuth)
  const backend = await createSyncBackend(cfg.backend, { serverUrl: cfg.serverUrl, supabaseClient: getSupabaseClient() as any })
  if (cfg.backend === 'powersync') {
    // Auth check for PS: auto-provision sim anon signin only in non-prod dev (convenience).
    // In strict prod/production mode: do not auto, require explicit sign-in; hard throw below.
    const isProd = cfg.production || coreIsProductionMode()
    if (!getAuthSession() && !isProd) {
      console.info('[sync-runtime] powersync selected with no auth — performing anon sign-in to derive userId/JWT.')
      await signInAnonymouslySim()
    }
    // Enforce hard throw ONLY when production && no auth (writes also enforce in store)
    if ((cfg.backend === 'powersync' || cfg.production) && !getAuthSession()) {
      throw new Error('Authentication required for powersync mode. Please sign in first.')
    }
    const auth = getAuthSession()
    if (auth) {
      setSimulatedAuthToken(auth.access_token, auth.user.id)
    }
    // phase5-4: still execute push so exportPush (updatedAt guaranteed + tombstones for grave) is sent to stub.
    // Real impl: PS watches local writes (incl. grave for deletes) + uses uploadData; applyRemoteDelta called from listeners with deltas containing tombstones.
    await backend.push(exportPush(getState(), userId))

    const psDb = (backend as any).config?.psDb

    if (psDb) {
      currentPowerSyncDb = psDb;
      setCurrentPsDb(psDb, true)  // ensure core flag + isReal for status/enforcement

      // Real impl step: trigger sync on the PS DB
      try {
        if (typeof psDb.sync === 'function') {
          await psDb.sync()
        }
        console.info('[sync-runtime] powersync sync() called')
      } catch (e) {
        console.warn('[sync-runtime] psDb.sync() failed', e)
      }

      // Dispose prior listener to prevent leaks on repeated runSync() calls (was attached inside without dispose)
      if (psOnChangeDispose) {
        try { psOnChangeDispose(); } catch {}
        psOnChangeDispose = null;
      }

      // Bootstrap: load current full state from PS (onChange only fires for *subsequent* changes, not initial data)
      // This ensures shapes roundtrip on first connect (local PS path or real); deltas are LWW/ union safe.
      async function bootstrapFromPs() {
        try {
          const deltaContent: any[] = [];
          for (const tbl of ['deck', 'note', 'card'] as const) {
            const rows = await psDb.getAll(`SELECT * FROM ${tbl} WHERE user_id = ?`, [userId]);
            deltaContent.push(...rows.map((r: any) => ({ id: r.id, kind: tbl, data: mapPsRowToApp(r, tbl) })));
          }
          const evRows = await psDb.getAll('SELECT * FROM review_log WHERE user_id = ? ORDER BY reviewed_at DESC', [userId]);
          const deltaEvents = evRows.map((r: any) => mapPsRowToApp(r, 'review'));
          const grRows = await psDb.getAll('SELECT * FROM grave WHERE user_id = ? ORDER BY created_at DESC', [userId]);
          const deltaTombstones = grRows.map((g: any) => mapPsRowToApp(g, 'grave'));
          // fsrs_params bootstrap (configure if present)
          const fsRows = await psDb.getAll('SELECT * FROM fsrs_params WHERE user_id = ? LIMIT 1', [userId]);
          if (fsRows.length > 0) {
            const p = mapPsRowToApp(fsRows[0], 'fsrs_params');
            applyFsrsParamsFromPs(parseFsrsParamsRow(p));
            if (p.weights && Array.isArray(p.weights)) {
              console.info('[powersync] bootstrapped fsrs_params (weights + learn highlight)');
            }
          }
          const delta = { cursor: Date.now(), events: deltaEvents, content: deltaContent, tombstones: deltaTombstones };
          applyRemoteDelta(delta);
          console.info(`[powersync reactivity] bootstrap applied: ${deltaEvents.length} events, ${deltaContent.length} content, ${deltaTombstones.length} tombs`);
        } catch (bErr) {
          console.warn('[powersync] bootstrap load failed', bErr);
        }
      }

      // Attach listener using correct PowerSync API (returns dispose fn; handler as {onChange}).
      // Use getAll() not execute() for SELECTs (execute returns QueryResult{rows:{_array}} not T[]).
      // Use changedTables (not .tables). Maps ensure camel+parsed shapes for applyRemote.
      if (typeof psDb.onChange === 'function') {
        try {
          psOnChangeDispose = psDb.onChange({
            onChange: async (event: any) => {
              console.debug('[powersync reactivity] onChange event', event);

              const changedTables = event?.changedTables || event?.tables || [];
              const hasReviewOrGrave = changedTables.includes('review_log') || changedTables.includes('grave');
              const hasContent = changedTables.some((t: string) => ['deck', 'note', 'card'].includes(t));
              const hasFsrs = changedTables.includes('fsrs_params');

              if (hasReviewOrGrave || hasContent || hasFsrs) {
                console.info(`[powersync reactivity] change in ${changedTables.join(', ')} - applying deltas + recompute`);
                try {
                  let deltaEvents: any[] = [];
                  let deltaContent: any[] = [];
                  let deltaTombstones: any[] = [];

                  if (hasReviewOrGrave) {
                    // Use getAll for plain row array; no LIMIT (full recent for safety; small datasets)
                    const evRows = await psDb.getAll(
                      'SELECT * FROM review_log WHERE user_id = ? ORDER BY reviewed_at DESC',
                      [userId]
                    );
                    deltaEvents = evRows.map((r: any) => mapPsRowToApp(r, 'review'));

                    const grRows = await psDb.getAll(
                      'SELECT * FROM grave WHERE user_id = ? ORDER BY created_at DESC',
                      [userId]
                    );
                    deltaTombstones = grRows.map((g: any) => mapPsRowToApp(g, 'grave'));
                  }

                  if (hasContent) {
                    // Query only changed tables (still snapshot for LWW delta; incremental per-row would need watch+diff)
                    if (changedTables.includes('deck')) {
                      const decks = await psDb.getAll('SELECT * FROM deck WHERE user_id = ?', [userId]);
                      deltaContent.push(...decks.map((d: any) => ({ id: d.id, kind: 'deck', data: mapPsRowToApp(d, 'deck') })));
                    }
                    if (changedTables.includes('note')) {
                      const notes = await psDb.getAll('SELECT * FROM note WHERE user_id = ?', [userId]);
                      deltaContent.push(...notes.map((n: any) => ({ id: n.id, kind: 'note', data: mapPsRowToApp(n, 'note') })));
                    }
                    if (changedTables.includes('card')) {
                      const cards = await psDb.getAll('SELECT * FROM card WHERE user_id = ?', [userId]);
                      deltaContent.push(...cards.map((c: any) => ({ id: c.id, kind: 'card', data: mapPsRowToApp(c, 'card') })));
                    }
                  }

                  if (hasFsrs) {
                    const fsRows = await psDb.getAll('SELECT * FROM fsrs_params WHERE user_id = ? LIMIT 1', [userId]);
                    if (fsRows.length > 0) {
                      const p = mapPsRowToApp(fsRows[0], 'fsrs_params');
                      applyFsrsParamsFromPs(parseFsrsParamsRow(p));
                      console.info('[powersync reactivity] fsrs_params change -> settings + learn highlight');
                    }
                  }

                  const delta = {
                    cursor: Date.now(),
                    events: deltaEvents,
                    content: deltaContent,
                    tombstones: deltaTombstones,
                  };

                  applyRemoteDelta(delta);
                  console.debug(`[powersync reactivity] applied delta: ${deltaEvents.length} events, ${deltaContent.length} content, ${deltaTombstones.length} tombs`);

                  // Explicit recompute + cache update after review deltas (self-healing; UPDATE to PS may re-trigger onChange for 'card' only - idempotent)
                  if (hasReviewOrGrave && deltaEvents.length > 0) {
                    const affectedCardIds = new Set(deltaEvents.map((e: any) => e.cardId));
                    console.debug(`[powersync reactivity] explicit recompute for ${affectedCardIds.size} cards`);
                    const currentEvents = getState().events;
                    for (const cid of affectedCardIds) {
                      const cardEvents = currentEvents.filter((e: any) => e.cardId === cid);
                      const fsrs = recomputeCard(cardEvents);
                      const fsrsAny: any = fsrs;
                      const dueRaw = fsrsAny.due;
                      const lastRaw = fsrsAny.lastReview ?? fsrsAny.last_review;
                      const dueIso = dueRaw ? (dueRaw instanceof Date ? dueRaw.toISOString() : String(dueRaw)) : null;
                      const lastIso = lastRaw ? (lastRaw instanceof Date ? lastRaw.toISOString() : String(lastRaw)) : null;
                      if (psDb && typeof psDb.execute === 'function') {
                        try {
                          await psDb.execute(
                            `UPDATE card SET state = ?, due = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?, last_review = ? WHERE id = ?`,
                            [
                              fsrsAny.state ?? fsrs.state,
                              dueIso,
                              fsrsAny.stability ?? fsrs.stability,
                              fsrsAny.difficulty ?? fsrs.difficulty,
                              fsrsAny.reps ?? fsrs.reps,
                              fsrsAny.lapses ?? fsrs.lapses,
                              lastIso,
                              cid,
                            ]
                          );
                        } catch (updateErr) {
                          console.warn('[powersync] failed to update card cache', updateErr);
                        }
                      }
                    }
                  }
                } catch (qErr) {
                  console.warn('[powersync] query/apply in listener failed', qErr);
                }
              }
            },
            onError: (err: Error) => console.warn('[powersync reactivity] onChange error', err),
          });
          console.info('[powersync] onChange listener attached for reactivity (correct API + dispose + getAll + mapper)');

          // Trigger initial bootstrap so existing PS data (local or remote) populates app state via mapper/apply
          await bootstrapFromPs();
        } catch (e) {
          console.warn('[powersync] failed to attach onChange listener', e);
        }
      }
    }

    // Graceful for dual mode
    console.info('[sync-runtime] powersync selected — push + sync sent, reactivity listener active; see plan for full delta feeding + recompute.')
    return { pulled: 0 }
  }
  await backend.push(exportPush(getState(), userId))
  const delta = await backend.pull(userId, cfg.cursor)
  applyRemoteDelta(delta)
  cfg = { ...cfg, cursor: delta.cursor }
  save()
  return { pulled: delta.events.length + delta.content.length + delta.tombstones.length }
}
