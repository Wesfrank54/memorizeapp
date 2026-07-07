import type { Card, ContentKind, Deck, Note, ReviewEvent, Tombstone } from './types.ts'

/** A content entity in transit.
 * Phase 5: supports updates via updatedAt on data (LWW). Data objects carry userId? and
 * (for Card) optional derived FSRS cache fields per subtask 3d alignment with prod schema.
 * phase5-4: exportPush guarantees updatedAt on all (deck/note/card) for PS updated_at propagation.
 * See types.ts, spike/db/postgres-schema.sql.
 * In production with PowerSync this will be driven by ps_crud PUT/PATCH.
 */
export interface ContentRow {
  id: string
  kind: ContentKind
  data: Deck | Note | Card
}

/** POST /sync/push — a device uploads everything it knows. The server unions it in (idempotent). */
export interface PushBody {
  userId: string
  events: ReviewEvent[]
  content: ContentRow[]
  tombstones: Tombstone[]
}

/** GET /sync/pull?userId&cursor — the server returns rows newer than the client's checkpoint. */
export interface PullResponse {
  /** New checkpoint to send next time. */
  cursor: number
  events: ReviewEvent[]
  content: ContentRow[]
  /** Tombstones (phase5-4): may arrive as {id,kind} or grave-shaped {target_id, kind} from PS; applyRemote normalizes. */
  tombstones: Tombstone[]
}

// ---- Phase 5 pluggable backend abstraction ---------------------------------
// SyncBackend abstracts the transport for push/pull (and future config).
// The 'local' implementation uses the toy HTTP (server/sync-server.ts).
// A real 'powersync' implementation will use the SDK (no fetch to /sync/*).
// 3f: basic create wired + dual mode in store + SyncBar switcher; 'powersync' stub ready.
// phase5-4: full updatedAt propagation in content + tombstones (grave mapping) integrated.
//
// See:
//   ../memorize-spike/db/connector.ts (SupabaseConnector + uploadData for ps_crud; handle DELETE or grave INSERT)
//   ../memorize-spike/db/client-schema.ts (AppSchema mirroring the tables; updated_at + grave target_id)
//   ../memorize-spike/db/powersync-sync-rules.yaml
//   ../memorize-spike/db/postgres-schema.sql
//   SYNC.md section "Swapping in PowerSync (production)"
//   To finish: install deps, init PS w/ schema (3e), use connector in createPowerSync...
//
// exportPush() and applyRemote() in sync.ts remain backend-agnostic and
// should continue to be used (or adapted only for the delta shape PowerSync streams).
export type SyncBackendKind = 'local' | 'powersync'

export interface SyncBackend {
  /** Short name for logging / UI (e.g. 'local-http' or 'powersync'). */
  readonly name: string
  /** Upload the client's full known state (events + content + tombstones). */
  push(body: PushBody): Promise<void>
  /** Download rows since the last cursor for this user. */
  pull(userId: string, cursor: number): Promise<PullResponse>
  /** Future: backend-specific config, auth tokens, endpoint overrides, etc. */
  config?: Record<string, unknown>
}
