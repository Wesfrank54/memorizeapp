// Ported and extended for memorize-app Phase 5 (subtask 3e: full AppState + phase5-4 updated_at + grave).
// Reference: ../memorize-spike/db/client-schema.ts (and postgres-schema.sql).
//
// Wire up against your real client once you add a PowerSync SDK.
// Install one of: @powersync/web | @powersync/react-native | @powersync/node
//
//   import { column, Schema, Table } from '@powersync/web'
//
// PowerSync always provides an implicit text `id` column on every table, so it
// is NOT declared here. The local SQLite schema mirrors the Postgres tables in
// ../memorize-spike/db/postgres-schema.sql (with app-specific extensions below).
//
// This file lives outside the main tsconfig "include" (db/ is not listed in
// tsconfig.json) so it is excluded from `npm run typecheck` / tsc until the
// PowerSync packages are installed. Same pattern as the spike.
//
// AppState (see src/core/types.ts) now maps fully:
// - deck/note/card/review_log/grave/fsrs_params from the Phase 0/5 core model.
// - commitments + checkpoints are app extensions (Phase 4 accountability).
// - settings (newPerDay + fsrs* + desiredRetention) live in fsrs_params.
//
// Current status (see context in subtask):
// - Sync (exportPush/applyRemote + pluggable SyncBackend) ignores commitments/
//   checkpoints today — they are local-only (see src/core/store.ts,
//   src/core/sync.ts, src/app/sync-runtime.ts).
// - Core tables (deck/note/card/events/tombstones) + settings (via fsrs_params)
//   are the synced portion.
// - Decision: we include commitment/checkpoint tables in the client schema
//   (and sync rules) to make the schema represent *full* AppState readiness.
//   Sync integration (extending PushBody/PullResponse, export/apply, server
//   storage, and LWW/append logic for them) will be a follow-on. Once wired,
//   they can participate in PowerSync buckets like other user data.
//   (They are small and change infrequently, so safe to sync when ready.)
//
// See also:
// - src/core/types.ts (AppState, Commitment, Checkpoint, Settings, Tombstone)
// - src/core/sync-protocol.ts, sync.ts (pluggable backend, export/apply)
// - src/core/store.ts (how commitments/checkpoints/settings are mutated)
// - ../memorize-spike/db/powersync-sync-rules.yaml
// - SYNC.md "Swapping in PowerSync (production)"
// - server/storage.ts (dev toy, which also omits commitments/checkpoints today)

import { column, Schema, Table } from '@powersync/web'

const deck = new Table({
  user_id: column.text,
  parent_id: column.text,
  name: column.text,
  created_at: column.text,
  updated_at: column.text,  // phase5-4: LWW via updatedAt in export/applyRemote; maps from Deck.updatedAt
})

const note = new Table({
  user_id: column.text,
  deck_id: column.text,
  fields: column.text, // JSON string on the client (e.g. { front, back } or { text })
  tags: column.text,   // serialized array (text on client; text[] in Postgres)
  created_at: column.text,
  updated_at: column.text,  // phase5-4: LWW via updatedAt (guaranteed in exportPush)
})

const card = new Table(
  {
    user_id: column.text,
    note_id: column.text,
    deck_id: column.text,
    ord: column.integer,
    // Derived FSRS cache — recomputed locally after sync (see ARCHITECTURE.md
    // in spike and fsrs.ts:recomputeCard in app). These are a cache; the
    // review_log is the source of truth. Matches columns in postgres-schema.sql.
    state: column.integer,
    due: column.text,
    stability: column.real,
    difficulty: column.real,
    reps: column.integer,
    lapses: column.integer,
    last_review: column.text,
    created_at: column.text,
    updated_at: column.text,  // phase5-4: LWW + updatedAt prop for PS (deck/note/card all)
  },
  { indexes: { by_due: ['user_id', 'due'] } },
)

const review_log = new Table(
  {
    user_id: column.text,
    card_id: column.text,
    rating: column.integer,
    reviewed_at: column.text,
    device_id: column.text,
    duration_ms: column.integer,
  },
  { indexes: { by_card: ['card_id'] } },
)

const grave = new Table({
  user_id: column.text,
  kind: column.text,
  target_id: column.text,   // maps from Tombstone.id (core uses id=target; see types.ts phase5-4)
  created_at: column.text,
  // No updated_at on grave (per postgres-schema.sql); tombstones are append-by-presence.
})

const fsrs_params = new Table({
  user_id: column.text,
  weights: column.text, // JSON-encoded number[] (FSRS-6 w array)
  desired_retention: column.real,
  // App extension (not in base spike postgres yet): new cards per day limit.
  new_per_day: column.integer,
  last_optimized_at: column.text,
  reviews_at_optimize: column.integer,
  // Learn mode: recently graduated cards prioritized in Review (synced across devices).
  learn_highlight_card_ids: column.text, // JSON string[] | null
  learn_highlight_set_at: column.text,   // ISO timestamp | null
  // Learn tab preferences (spacing, interleave, blank coverage, etc.) — JSON blob.
  learn_settings_json: column.text,
})

// ---- App-specific extensions for full AppState (commitments + checkpoints) ----
// These come from Phase 4 accountability feature (see types.ts and accountability.ts).
// Currently treated as local-only by the sync layer. Tables are defined here
// so the PowerSync client schema is complete for AppState. When sync rules
// and the export/apply logic are extended, these will flow like other tables.
// Use camelCase mapping in JS layer; columns here match expected Postgres snake_case.

const commitment = new Table({
  user_id: column.text,
  kind: column.text,           // 'daily-reviews' | 'retention-goal'
  title: column.text,
  created_at: column.text,
  start_date: column.text,
  deadline: column.text,
  // daily-reviews specific (nullable in practice)
  daily_target: column.integer,
  grace_days: column.integer,
  // retention-goal specific (nullable)
  deck_id: column.text,
  target_retention: column.real,
  min_cards: column.integer,
  // stakes (demo)
  stake_cents: column.integer,
  recipient: column.text,      // 'charity' | 'anti-charity'
  status: column.text,         // 'active' | 'met' | 'failed' | 'cancelled'
  resolved_at: column.text,
})

const checkpoint = new Table({
  user_id: column.text,
  deck_id: column.text,        // nullable in type (null = global?)
  taken_at: column.text,
  sampled_card_ids: column.text, // JSON string: string[] of sampled card ids
  correct: column.integer,
  total: column.integer,
  score: column.real,          // correct / total
})

export const AppSchema = new Schema({
  deck,
  note,
  card,
  review_log,
  grave,
  fsrs_params,
  // app extensions:
  commitment,
  checkpoint,
})
