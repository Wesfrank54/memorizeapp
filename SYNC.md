# Phase 2 — offline-first sync

Multi-device sync built on the Phase 0 thesis: **the review log is an append-only
event store (source of truth); each card's schedule is derived by replaying it
through FSRS.** That makes the merge a conflict-free union and the schedule a
deterministic recomputation — so two devices that review offline always converge.

> This is a real, runnable sync over HTTP that proves the architecture. It maps
> 1:1 onto PowerSync + Postgres, which is the production swap (see below). It is
> **not** itself PowerSync — standing up self-hosted PowerSync needs its service
> image + Postgres logical replication, out of scope for a local spike.

## Run a two-device demo

```bash
# terminal 1 — the sync server (source of truth)
npm run server                 # http://localhost:8787  (persists to ./data)

# terminal 2 — device A
npm run dev                    # http://localhost:5173

# device B — open the same URL in a second browser profile / incognito window
# (separate localStorage = a separate "device" pointed at the same server)
```

In each window: review some cards, then click **sync now** in the top bar.
Reviews made offline on either device appear on the other after both sync, and
the card schedules match. The dot turns green on success; auto-sync runs every
20s once a manual sync succeeds.

## Protocol

Two endpoints (`server/sync-server.ts`), deliberately the same shape as
PowerSync's upload queue + bucket streaming:

| Endpoint | Direction | Behavior |
|---|---|---|
| `POST /sync/push` | client → server | Union the client's events + content + tombstones into the DB. Append-only by id, so re-pushing is a no-op. |
| `GET /sync/pull?userId&cursor` | server → client | Return every row with `seq > cursor`, plus the new high-water cursor. |

Each stored row carries a monotonic `seq`; the client persists the last `cursor`
it saw and only pulls what's newer — the hand-rolled equivalent of a PowerSync
write checkpoint.

## Conflict model (why it just works)

| Data | Strategy | Why it's safe |
|---|---|---|
| review events | union by id | immutable + unique id = grow-only set (CRDT). Order-independent, idempotent. |
| decks / notes / cards | upsert by id (create-only) | no edit UI yet; creation is idempotent. |
| deletions | tombstones | a delete records `{id, kind}`; on merge the id (and any orphaned events) are dropped everywhere. |

`applyRemote()` in `src/core/sync.ts` is the pure merge — unit-tested for
order-independence, convergence, and tombstone propagation in `test/sync.test.ts`
(runs a real server on an ephemeral port and drives two clients to convergence).

## Files

```
server/
  storage.ts       DB + push/pull (seq cursor) + JSON file persistence
  sync-server.ts   HTTP endpoints (CORS, push, pull, health)
  index.ts         entry point — npm run server
src/core/
  sync-protocol.ts wire types (PushBody, PullResponse, ContentRow)
  sync.ts          exportPush(), applyRemote() [pure], pushSync()/pullSync() [HTTP]
src/app/
  sync-runtime.ts  config + cursor persistence + one push/pull cycle
  components/SyncBar.tsx   server URL + sync button + status + auto-sync
test/sync.test.ts  server-in-process, two-client convergence + tombstone
```

## Swapping in PowerSync (production)

The client already speaks the right protocol shape, so the swap is mostly
configuration:

1. Provision Postgres (Supabase/Neon) + PowerSync; apply the schema and sync
   rules scaffolded in [`../memorize-spike/db`](../memorize-spike/db)
   (`postgres-schema.sql`, `powersync-sync-rules.yaml`, `client-schema.ts`,
   `connector.ts`).
2. Replace `pushSync`/`pullSync` with the PowerSync SDK's upload queue + bucket
   stream. `applyRemote()` / `recomputeCard()` stay unchanged — PowerSync streams
   id-keyed rows, and the append-only `review_log` unions naturally.
3. Add auth (Supabase) so `userId` comes from a verified JWT instead of config.

**Phase 5 status (current):** Core migration complete with pluggable dual-mode (local toy + PowerSync). Real wiring (dynamic import of @powersync/web + @supabase/supabase-js + src/powersync/supabase-connector.ts), writes via powersyncWriteStub + psDb.execute (review_log inserts, deck/note/card UPSERTs with user_id/updated_at, grave for deletes), listener/onChange reactivity + mapper + recompute cache (bootstrap + deltas feed applyRemoteDelta + fsrs re-compute) + real+sim auth (VITE_* client, signIn, onAuthStateChange, effective userId) are substantially complete.

See PHASE5_MIGRATION_PLAN.md (status updates) for remaining (e2e with real Supabase+PS instance, full commitment sync, prod polish, RLS etc.). Dual mode: local unaffected always. 

**Using .env for real backend:**
- Copy `.env.example` (at project root) to `.env.local` (or `.env` per your Vite setup) and fill real values:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_POWERSYNC_URL`
- Optional: `VITE_SYNC_BACKEND=powersync` (or use UI prod toggle / selector).
- Then in UI: sign in (anon) via SyncBar (visible in PS), switch backend to "powersync". Local toy server instructions below remain the default/fallback and are always kept fully working.
- Without envs (or on import fail): gracefully falls back to stub (no crash).

Caveats: 
- Without envs or on import fail: gracefully stubs (no crash, logs warn).
- UI shows "powersync" (with real/stub/init indicator); prod mode toggle enforces PS.
- Tests cover PS via mocks for factory, writes, listener deltas, auth userId (local tests untouched).
- Reactivity via listener + apply (not full watch buckets yet).
- Some tables (commitments) still local-only.

## Known limitations (out of scope here)

- **Single user, no auth** — `userId` is a config value, not a verified identity.
- **Full-state push** — each sync uploads everything the device knows (the server
  dedupes). Fine for MVP scale; add an outbox of unsynced ids to optimize.
- **Clock skew** — event ordering uses each device's clock (documented in the
  Phase 0 spike); it doesn't break convergence, only the exact interleaving.

(Phase 5 updates: updatedAt + LWW on content + tombstone/grave mapping (phase5-4) are now
supported in the pluggable layer + export/apply + dual-mode. The "create-only" note above
is historical; editing propagates via updatedAt. Grave table in spike/db/ aligns deletes.)
