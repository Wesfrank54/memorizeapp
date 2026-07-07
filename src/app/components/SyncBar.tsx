import { useEffect, useRef, useState } from 'react'
import {
  getServerUrl,
  getUserId,
  runSync,
  setServerUrl,
  setUserId,
  getBackendKind,
  setBackendKind,
  getActiveBackendName,
  signInAnonymouslySim,
  signOutSim,
  getAuthSession,
  isProductionMode,
  setProductionMode,
  getPowerSyncDb,
  getEnvVar,
  getIsRealPsDb,
} from '../sync-runtime.ts'
import type { SyncBackendKind } from '../../core/sync-protocol.ts'

type Status = 'idle' | 'syncing' | 'ok' | 'error'

export function SyncBar() {
  const [url, setUrl] = useState(getServerUrl())
  const [uid, setUid] = useState(getUserId())
  const [backend, setBackend] = useState<SyncBackendKind>(getBackendKind())
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState('')
  const okOnce = useRef(false)

  // Phase 5-5 auth state (recomputed on demand; session drives uid in PS mode)
  const [authSignedIn, setAuthSignedIn] = useState(!!getAuthSession())
  const [authUserId, setAuthUserId] = useState<string | null>(getAuthSession()?.user.id ?? null)

  // Phase 5 status for real vs stub psDb (enhanced after prod)
  const [psStatus, setPsStatus] = useState<'real ps' | 'stub (no env)' | 'local'>('local')

  function refreshAuthState() {
    const s = getAuthSession()
    setAuthSignedIn(!!s)
    setAuthUserId(s ? s.user.id : null)
  }

  function refreshPsStatus() {
    const be = getBackendKind()
    if (be !== 'powersync') {
      setPsStatus('local')
      return
    }
    const ps = getPowerSyncDb()
    if (ps) {
      // use config.real or presence of psDb + query methods (simple flag for connected instance)
      const c = (ps as any)?.config || (ps as any)
      if (c?.real || getIsRealPsDb()) {
        setPsStatus('real ps')
        return
      }
      if (c?.stub) {
        setPsStatus('stub (no env)')
        return
      }
      // presence of psDb reporting a real connected instance (via execute/getAll or flag)
      if (typeof (ps as any).execute === 'function' || typeof (ps as any).getAll === 'function') {
        setPsStatus('real ps')
        return
      }
      setPsStatus('real ps')
      return
    }
    // no ps yet (pre-sync) or fallback: distinguish stub (no env) using getEnvVar
    const hasEnv = !!(getEnvVar('VITE_SUPABASE_URL') && getEnvVar('VITE_SUPABASE_ANON_KEY'))
    setPsStatus(hasEnv ? 'stub (no env)' : 'stub (no env)')
  }

  async function sync() {
    setServerUrl(url)
    // In PS mode, uid is forced from auth; manual uid only for local sim
    const effectiveUid = (backend === 'powersync' || getBackendKind() === 'powersync') ? (authUserId || getUserId()) : uid
    setUserId(effectiveUid)
    setBackendKind(backend)  // ensure persisted (3f dual mode switch)
    setStatus('syncing')
    setMsg('')
    try {
      const { pulled } = await runSync()
      okOnce.current = true
      setStatus('ok')
      const beName = await getActiveBackendName()
      // After runSync (PS auto signs in if needed), refresh
      refreshAuthState()
      refreshPsStatus()
      setMsg(pulled > 0 ? `synced · pulled ${pulled} (${beName})` : `synced · up to date (${beName})`)
    } catch (e) {
      setStatus('error')
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  function changeBackend(kind: SyncBackendKind) {
    setBackend(kind)
    setBackendKind(kind)
    setMsg(`backend → ${kind} (use sync now to test; local unaffected)`)
    // Note: switching does not auto-sync; powersync path uses stubs (see 3f comments)
    // 5-5: after backend change, uid will derive from auth if PS
    refreshAuthState()
    refreshPsStatus()  // ensure status accurate on backend switch
    const newUid = getUserId()
    setUid(newUid)
  }

  async function doSignIn() {
    const sess = await signInAnonymouslySim()
    refreshAuthState()
    refreshPsStatus()  // ensure status accurate after sign (may affect real auth path)
    setUid(sess.user.id)
    setMsg(`signed in as ${sess.user.id} — userId/JWT now derived for PS mode`)
    // If PS active, adopt
    if (backend === 'powersync') {
      setUserId(sess.user.id)
    }
  }

  function doSignOut() {
    signOutSim()
    refreshAuthState()
    refreshPsStatus()
    const fallback = 'local-user'
    setUid(fallback)
    setMsg('signed out — falling back to local-user (local mode)')
    if (backend !== 'powersync') {
      setUserId(fallback)
    }
  }

  // Auto-sync every 20s, but only once a manual sync has succeeded (avoids
  // hammering a server that isn't running yet).
  const syncRef = useRef(sync)
  syncRef.current = sync
  useEffect(() => {
    const t = window.setInterval(() => {
      if (okOnce.current && navigator.onLine) syncRef.current()
    }, 20000)
    return () => window.clearInterval(t)
  }, [])

  // Phase 5-5: initialize uid from effective (auth may set it on load for PS) + refresh auth
  useEffect(() => {
    const eff = getUserId()
    setUid(eff)
    refreshAuthState()
    refreshPsStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ensure ps status refreshes accurately when backend or auth changes (covers switch/sign without relying solely on handler)
  useEffect(() => {
    refreshPsStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, authSignedIn])

  // Phase 5-5: in powersync mode, userId is derived (from auth session); hide/disable manual edit.
  const isPsMode = backend === 'powersync'
  const displayUid = isPsMode ? (authUserId || uid) : uid
  const canEditUid = !isPsMode

  return (
    <div className="syncbar">
      <span className={`sync-dot ${status}`} aria-hidden />
      <input
        className="sync-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        spellCheck={false}
        aria-label="sync server url"
        title="Sync server URL (use http://localhost:8787 for local toy server)"
      />
      {/* Phase 5-5 auth: uid input hidden/disabled in PS mode (auth derives it). Show derived userId. */}
      <input
        className="sync-url"
        value={displayUid}
        onChange={(e) => { if (canEditUid) setUid(e.target.value) }}
        disabled={!canEditUid}
        style={{ maxWidth: 140, opacity: canEditUid ? 1 : 0.7 }}
        spellCheck={false}
        aria-label="user id"
        title={isPsMode ? "User ID derived from Supabase auth sim (real user.id from JWT in prod)" : "User ID (for multi-user simulation in local toy; auth in PS mode)"}
      />
      {/* Phase 5-5: Auth simulation controls. Sign-in provides userId + JWT token (for PS backend / future connector.fetchCredentials).
          In PS: auth required (auto on sync, but button for explicit). Local keeps manual + sim optional.
          Ref: spike/db/connector.ts getSession() + token. */}
      {isPsMode && (
        authSignedIn ? (
          <button className="link" onClick={doSignOut} title={`Signed in as ${authUserId}. Sign out (sim).`}>sign out</button>
        ) : (
          <button
            className="link"
            onClick={doSignIn}
            title="Anon sign-in (anon): derives userId + JWT for PS mode. For *real* Supabase (not sim): set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (and VITE_POWERSYNC_URL) in .env.local then reload. Provides real connected psDb."
            style={{ fontWeight: 600, textDecoration: 'underline' }}
          >
            sign in (anon)
          </button>
        )
      )}
      {/* Phase 5 3f: backend switcher using existing setBackendKind / getBackendKind.
          Dual mode: 'local' is full toy HTTP unchanged; 'powersync' uses stub (no crash).
          See sync-runtime.ts, sync.ts:createPowerSyncSyncBackend, store.ts powersyncWriteStub.
       */}
      <select
        value={backend}
        onChange={(e) => changeBackend(e.target.value as SyncBackendKind)}
        className="sync-backend"
        title="Sync backend (Phase 5 dual mode). Local = toy server (default). powersync = PowerSync (real init if VITE_* + deps, else stub). Use prod toggle for stricter."
        aria-label="sync backend"
      >
        <option value="local">local (toy)</option>
        <option value="powersync">powersync</option>
      </select>
      {/* Production mode toggle for dual UX polish (sets PS + stricter behaviors) */}
      <label style={{ fontSize: '0.75em', marginLeft: 4, opacity: 0.85 }} title="Production mode: forces powersync backend + auth reqs (no toy UI)">
        <input
          type="checkbox"
          checked={isProductionMode()}
          onChange={(e) => {
            setProductionMode(e.target.checked)
            // refresh local state + backend
            setBackend(e.target.checked ? 'powersync' : 'local')
            setMsg('prod mode ' + (e.target.checked ? 'on' : 'off') + ' — sync to apply')
            refreshPsStatus()
          }}
        /> prod
      </label>
      {/* Enhanced "Better status for real vs stub psDb" (after prod checkbox).
         Uses getPowerSyncDb() + config.real + presence + query fn flag + getEnvVar + getIsRealPsDb.
         Displays exactly: "real ps" / "stub (no env)" / "local" . Refreshes on switch/sign/sync. */}
      <span className="sync-psstatus" title="PowerSync status: real connected instance (if VITE_* envs + init success via connector) vs stub (no env) vs local. See .env for real Supabase+PowerSync." style={{ fontSize: '0.7em', marginLeft: 4 }}>
        {psStatus}
      </span>
      <button className="link" onClick={sync} disabled={status === 'syncing'}>
        {status === 'syncing' ? 'syncing…' : 'sync now'}
      </button>
      {msg && <span className={`sync-msg ${status}`}>{msg}</span>}
      {/* Auth status indicator (5-5) */}
      {authSignedIn && <span className="sync-auth" title={`Auth sim active: ${authUserId} (JWT ready for PS connector)`}>🔐 auth</span>}
    </div>
  )
}
