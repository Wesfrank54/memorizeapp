// Adapted for memorize-app Phase 5 from spike/db/connector.ts
// This is the real SupabaseConnector implementation.
//
// Responsibilities:
// 1. fetchCredentials() — return {endpoint, token} using real (or simulated) Supabase session JWT.
// 2. uploadData() — drain ps_crud to Supabase tables (or local for sim).
//
// Design notes preserved:
// - review_log is append-only INSERT-only (id-keyed).
// - Content (deck/note/card) uses UPSERT with updated_at (phase5-4 LWW).
// - Deletes: use grave or direct DELETE; grave ensures tombstone propagation.
// - After new review_log, client should call recomputeCard() for affected cards (self-healing).
// - user_id comes from auth (JWT sub) for RLS and buckets.
//
// Usage: import and pass real SupabaseClient + your PowerSync URL.
// For dev without real Supabase: the auth sim in runtime provides token.

import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/web'
import type { SupabaseClient } from '@supabase/supabase-js'

export class SupabaseConnector implements PowerSyncBackendConnector {
  constructor(
    private supabase: SupabaseClient,
    private powersyncUrl: string,
  ) {}

  async fetchCredentials() {
    // Always prefer live session from the (singleton) Supabase client passed at construction.
    // This gets real JWT when VITE_SUPABASE_* present + signInAnonymouslySim / onAuthStateChange succeeded.
    // Falls back to sim token (set via runtime) for dev without real Supabase envs (placeholder client path).
    // Cross-ref: runtime.ts signIn/getAuthSession/onAuth + setSimulated + getSupabaseClient; sync.ts fetchSimulatedCredentials + createPower... passing client.
    const { data, error } = await this.supabase.auth.getSession()
    if (!error && data?.session) {
      return { endpoint: this.powersyncUrl, token: data.session.access_token }
    }

    // sim fallback (dynamic import to avoid any static cycle with core/sync); used when no real session on client (no-env sim flow)
    try {
      const { fetchSimulatedCredentials } = await import('../core/sync.ts')
      const sim = fetchSimulatedCredentials(this.powersyncUrl)
      if (sim) return sim
    } catch (e) {
      // ignore
    }

    throw new Error('Not authenticated (no Supabase session)')
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const tx = await database.getNextCrudTransaction()
    if (!tx) return

    try {
      for (const op of tx.crud) {
        const table = this.supabase.from(op.table)
        if (op.op === 'PUT') {
          // phase5-4: include updated_at from op.opData if present for LWW
          await table.upsert({ id: op.id, ...op.opData })
        } else if (op.op === 'PATCH') {
          await table.update(op.opData!).eq('id', op.id)
        } else if (op.op === 'DELETE') {
          // phase5-4: prefer grave for tombstone if the client created one.
          // But for PS direct: delete the row.
          await table.delete().eq('id', op.id)
        }
      }
      await tx.complete()
    } catch (e) {
      // Leave queued for retry
      throw e
    }
  }
}
