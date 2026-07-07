# Phase 5: Production Backend Migration Plan (PowerSync + Postgres/Supabase)

**Status as of 2026-06-29 (end of this session):**  
Foundation + pluggable dual-mode complete. Local toy server + full local MVP (Phases 1-4 + commitments) remains fully functional. Steps 1 (deps/wiring), 2 (real writes via stub+execute), 3 (reactivity via listener/onChange + recompute cache), 4 (real+sim auth) largely done. Real PowerSync path is wired and functional (with graceful stub on missing envs). Next: e2e with real Supabase+PS instance + full commitment sync + prod polish. See details below.

This document exists so another model (Claude, Grok, etc.) can pick up exactly where we left off with full context.

## Current State (What Has Been Built)

### Core App (Pre-Phase 5, still fully working)
- Event-sourced FSRS with `recomputeCard()` as the single source of truth.
- Full local persistence (localStorage), review, cloze, import, stats, optimizer (Tune), commitments (Phase 4 UI + logic).
- Pluggable sync layer (added in this phase).

### Phase 5 Work Completed (in strict order via sub-agents)
1. **Editing UI** (DeckList now supports viewing/editing notes per deck + deck rename).
2. **Sync layer production-ready prep**:
   - `deviceId` (stable per-browser, attached to every ReviewEvent).
   - Configurable `userId` exposed in SyncBar.
   - `SyncBackend` interface + factory (`createLocalSyncBackend` + `createPowerSyncSyncBackend` stub).
   - Dual-mode in `sync-runtime.ts`, `store.ts` (powersyncWriteStub), SyncBar (backend selector).
3. **Type & data model alignment** (subtask 3d):
   - `deviceId` required on ReviewEvent.
   - `userId?` optional on Deck/Note/Card/ReviewEvent.
   - `updatedAt` required on content types.
   - Card now carries optional derived FSRS fields (state, due, stability...) for cache alignment (but logic still derives via recomputeCard).
   - Backfills + all creation/update paths updated.
4. **Client schema port** (subtask 3e):
   - `db/client-schema.ts` and `db/powersync-sync-rules.yaml` created (ported + extended from spike/db/ for full AppState).
   - Includes commitments + checkpoints tables (sync wire for them still local-only for now).
5. **PowerSync backend stub + dual-mode wiring** (subtask 3f):
   - `createPowerSyncSyncBackend` returns a proper `SyncBackend` (no-op + excellent comments pointing to spike connector).
   - Store mutations call `powersyncWriteStub` when in powersync mode.
   - Runtime and SyncBar support switching + production flag.
6. **updatedAt propagation + tombstone/grave** (phase5-4):
   - `exportPush` now guarantees `updatedAt` on all content.
   - `applyRemote` strengthened LWW (updatedAt || createdAt).
   - Tombstones normalized to/from grave shape (`target_id`).
   - Deletes create grave-shaped data; flows through dual-mode.
   - Comments + schema alignment for real PS `uploadData` + rules.
7. **Auth simulation** (phase5-5):
   - Supabase-style anon sign-in simulation (persistent user + fake JWT).
   - `fetchSimulatedCredentials()` exactly mirrors `spike/db/connector.ts`.
   - Effective userId derivation: auth in PS/prod mode, configurable string in local.
   - SyncBar shows auth controls (visible only in PS), hides manual uid edit in PS mode.
   - Flows into exportPush + PS backend config.

**Phase 5 core steps (largely complete as of latest fixes):**
- Step 1 (Real Dependencies & Basic Wiring): npm install done; package.json updated; .env.example added; dynamic import + real PowerSyncDatabase + SupabaseConnector + psDb.connect wired in createPowerSyncSyncBackend (src/core/sync.ts + src/powersync/supabase-connector.ts + runtime).
- Step 2 (Real Mutation Writes): powersyncWriteStub + execute() for review_log INSERT, content UPSERT (deck/note/card with user_id/updated_at/created_at), grave + delete for tombs (src/core/store.ts). Preserves prior attrs.
- Step 3 (Real Sync & Reactivity): runSync calls psDb.sync(); onChange listener (correct shape, dispose), queries use getAll(), mapPsRowToApp (snake->camel, json parse, type infer, grave norm), bootstrapFromPs + applyRemoteDelta + recomputeCard + fsrs config on deltas; cache/recompute preserved (src/app/sync-runtime.ts + core/sync.ts + store).
- Step 4 (Auth (real)): real+sim unified via getSupabaseClient (VITE_*), signInAnonymously (real/sim), onAuthStateChange, getEffectiveUserId, enforcement in writes/runtime, singleton client passed to connector (src/app/sync-runtime.ts, src/core/sync.ts, SyncBar). Sim fallback when no envs.

See recent CHANGELOG for per-fix details (reactivity, writes, auth unification, card/import fixes, mapper, etc.). Local toy always primary.

**Invariants preserved** (critical for handoff):
- `recomputeCard(events)` is still the only way schedules are computed.
- Events are append-only source of truth (CRDT union by id).
- Content uses LWW via updatedAt (or createdAt).
- Tombs/grave prune events + content.
- Pure `applyRemote` / `exportPush` are backend-agnostic.
- Local toy path (`npm run server` + local mode) is always a perfect fallback.

**Key files added/modified** (see CHANGELOG.md for full per-session details):
- `db/client-schema.ts`, `db/powersync-sync-rules.yaml`
- `src/core/sync.ts` (factories + stubs)
- `src/app/sync-runtime.ts` (dual mode + auth)
- `src/core/store.ts` (mutations + stubs + backfills)
- `src/core/types.ts`
- `src/app/components/SyncBar.tsx`
- `server/*` (comments only)
- `CHANGELOG.md`, `README.md`, `SYNC.md`

## Remaining Work (Prioritized Next Steps)

**Note (2026-06-29 updates):** Steps 1 (deps/wiring), 2 (real writes), 3 (reactivity), 4 (auth) are largely done (see Current State updates + CHANGELOG for implementation). Local toy instructions + dual-mode kept fully prominent and working. 

Follow this order for continuity (renumbered for remaining). Each step should update CHANGELOG.md with the same format (what, why, files, validation).

1. **E2E with Real Supabase + PowerSync Instance**
   - Provision real Supabase project + PowerSync (or self-host); apply schema from `../memorize-spike/db/` (postgres-schema.sql + rules).
   - Copy `.env.example` → `.env.local`; fill `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_POWERSYNC_URL`.
   - Test full cycle: sign-in (anon), switch to powersync (or prod toggle), create/review/edit/import/commitments, cross-device sync/convergence via real backend.
   - Validate uploads (via connector), reactivity (onChange), LWW, tombstones/grave, recompute.

2. **Full Commitment Sync + Other Tables**
   - Extend sync for commitments + checkpoints tables (currently local-only in dual-mode).
   - Handle fsrs_params watch + configureScheduler in real path if not fully.
   - Ensure user_id enforcement everywhere from real auth.

3. **Prod Polish & Hardening**
   - Backfill/migration for localStorage users.
   - Error handling, loading states, better UI indicators for real vs stub.
   - RLS policies on Supabase; secure prod config (no sim fallbacks in prod).
   - Remove/hide toy server elements in prod mode.
   - Expand tests (real mocks or e2e script); verify two-device convergence on live instance.
   - Update docs (SYNC.md / README if needed) once e2e passes.

4. **Schema & Data Alignment Polish** (carry forward from prior)
   - Ensure all writes include `user_id` (from auth).
   - Decide on card derived cache: keep client-side recompute as truth; optionally write cache columns to the card table after recompute.
   - Handle fsrs_params sync (watch table → `configureScheduler`).
   - Extend export/apply for commitments/checkpoints if we want them synced (currently local-only).
   - Backfill/migration path for users upgrading from pure localStorage.

5. **Testing & Dev Experience**
   - Keep toy server + 'local' mode as the default for `npm run dev` + tests. (Prominent in README/SYNC.)
   - Add a way to run with real PowerSync (env flag or UI toggle).
   - Update `test/sync.test.ts` to also exercise the powersync factory (with mocks).
   - Add a small e2e note or script for Supabase local / real instance.
   - Ensure two "devices" (different browser profiles or userIds) converge.

6. **Longer-term / Polish**
   - Move to real (non-demo) stakes if desired.
   - Cross-platform notes (the core + pluggable backend design is already portable).
   - Remove or hide toy server UI elements when in production mode.
   - Documentation: update SYNC.md "Swapping" section to "Completed" with exact steps taken.
   - Consider a small `src/powersync/` folder for the real connector + system init.

## How to Continue (for the next model)

1. Start by reading these files in order:
   - `PHASE5_MIGRATION_PLAN.md` (this file)
   - Latest entries in `CHANGELOG.md`
   - `README.md` (Phase 5 section)
   - `SYNC.md` (especially "Swapping in PowerSync")
   - `db/client-schema.ts` and `db/powersync-sync-rules.yaml`
   - `src/core/sync.ts` (the factories and comments)
   - `src/app/sync-runtime.ts`
   - `src/core/store.ts` (powersyncWriteStub and mutations)
   - `spike/db/connector.ts` (the reference to copy)

2. Key invariants to never break:
   - Every card schedule comes from `recomputeCard(events)` only.
   - Review events are append-only.
   - Content is LWW by updatedAt.
   - Deletes use tombstones/grave.
   - Local mode (`backend === 'local'`) must continue to work perfectly for development and tests.

3. Always:
   - Add a dated entry to the top of CHANGELOG.md (same format).
   - Run `npm run typecheck` and `npm test` after changes.
   - Keep dual-mode working.

4. Current stub locations (replace these):
   - `createPowerSyncSyncBackend` in `src/core/sync.ts`
   - `powersyncWriteStub` calls in `src/core/store.ts`
   - Auth simulation in `src/app/sync-runtime.ts` + SyncBar

5. When ready for real Supabase:
   - Use the exact pattern from `spike/db/connector.ts`.
   - Most of the hard thinking (shape of PushBody vs ps_crud, when to recompute, etc.) is already done.

Good luck — the foundation is solid. The app is already in a much better state for a real multi-device service than it was at the start of Phase 5.

## References
- spike/db/ (postgres-schema.sql, client-schema.ts, powersync-sync-rules.yaml, connector.ts)
- ARCHITECTURE.md (in spike)
- All Phase 5 entries in CHANGELOG.md
- Current code state as of 2026-06-29

## Status Update 2026-06-29 (continuation)

- npm install of @powersync/web + @supabase/supabase-js succeeded.
- .env.example (and prior .env.local.example) added for VITE_SUPABASE_* / VITE_POWERSYNC_URL.
- createPowerSyncSyncBackend + connector + runtime wiring done (dynamic import, real PS DB, sim/real auth).
- Real mutation writes via powersyncWriteStub + execute in store.
- Reactivity: listener/onChange + mapper + bootstrap + apply deltas + recompute.
- Unified auth (real client + sim fallback), exposed psDb, UI polish, tests.
- Typecheck + tests green. Dual-mode fully operational: local toy always primary + prominent; powersync = real path (stubs gracefully).

Next per plan (updated): 
- e2e testing with real Supabase+PS instance (copy .env.example and provide values).
- Full commitment sync.
- Prod polish (RLS, errors, etc.).
- Update docs as needed.

## Status Update — 2026-06-29 continuation

**Completed (core steps 1-4):**
- Real deps installed (package.json).
- Wiring (step1): dynamic import + real PowerSyncDatabase + adapted SupabaseConnector (src/powersync/supabase-connector.ts); .env.example; psDb.connect.
- Writes (step2): powersyncWriteStub implements review/upsert/grave via psDb.execute (store.ts); preserves created_at etc via pre-queries.
- Reactivity (step3): psDb.sync() in runSync; onChange (proper shape) + getAll + mapPsRowToApp (full snake/camel/json/grave handling) + bootstrapFromPs + applyRemoteDelta + recomputeCard + fsrs_params handling (runtime.ts + sync.ts + store).
- Auth (step4): real+sim via getSupabaseClient(VITE_*), signInAnonymously, onAuthStateChange full updates, effective userId, enforcement; passed consistently; sim for no-env/dev. SyncBar updated.
- Extras from fixes: getPowerSyncDb/getCurrentPsDb exposed; UI status/prod toggle; mapper/JSON/shape fixes; card/import/update/fsrs writes; test coverage for PS path; env centralization.
- All existing local behavior, toy server, invariants (recompute truth etc.), and tests untouched. Dual-mode rock solid.

**Phase 5 core migration complete.** Local toy instructions prominent and always the default for `npm run dev` / tests. Real path ready for e2e once real VITE_* provided + schema applied (see spike/db/ and .env.example).

Next: e2e with real Supabase+PS + full commitments + prod polish (see updated Remaining Work).

(End of plan document. Append new status sections here as work continues.)