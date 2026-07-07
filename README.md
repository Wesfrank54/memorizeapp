# memorize-app — Phase 5 in progress (local MVP complete)

A single-platform spaced-repetition app (React + Vite) built on the event-sourced
FSRS core proven in [`../memorize-spike`](../memorize-spike). Reviews are stored
as an append-only event log; every card's schedule is derived by replaying that
log through FSRS — so the core is sync-ready (Phase 2) without rework.

## Features

- **Retrieval-first review loop** — answer stays hidden until you attempt it, then
  rate Again / Hard / Good / Easy. Each button previews its next interval
  (e.g. `10m`, `8d`). Keyboard: `space` reveals, `1`–`4` rate.
- **Manual authoring** — basic (front/back) and **cloze** (`{{c1::answer}}`) cards.
  One cloze note spawns one card per cloze number.
- **CSV import** — `front,back,deck,tags` (header or positional), quote-aware.
- **Stats dashboard** — due today, new available, reviews today, and **true
  retention** (pass rate over mature reviews, last 30 days), plus per-deck counts.
- **Commitments** — opt-in daily review or verified-retention goals with (demo)
  stakes. Retention goals use proctored checkpoints where you type answers from
  memory.
- **Local persistence** — state lives in `localStorage`; survives reloads. Ships
  with a small sample deck on first run.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run server     # sync server on http://localhost:8787 (Phase 2 — see SYNC.md)
npm test           # core + sync + optimizer (node:test) — 12 tests
npm run build      # tsc --noEmit + vite build
npm run typecheck
```

## Layout

```
src/
  core/            framework-agnostic engine (portable to mobile later)
    fsrs.ts        scheduler config, recomputeCard(), interval previews
    schedule.ts    due-queue + new-card pacing (interleaves decks by due)
    cloze.ts       cloze parse + render
    csv.ts         CSV parser + card mapper
    stats.ts       true retention + counts
    store.ts       observable state + localStorage persistence + seed
    types.ts       Deck / Note / Card / ReviewEvent
  app/             React UI (thin; all logic lives in core/)
    App.tsx, useStore.ts, components/*, styles.css
test/
  phase1.test.ts   cloze, csv, schedule, stats, fsrs
```

## Design notes

- **`core/` has zero React imports** — the same engine ports to React Native / Expo
  when cross-platform is needed.
- **`store.ts` is the only writer of review events** (`review()` appends an
  immutable event). Scheduling state is never edited directly — always derived via
  `recomputeCard()`. This is the Phase 0 thesis carried forward.
- **Determinism** comes from `enable_fuzz: false` (see `core/fsrs.ts`).

## Phase 2 — offline-first sync ✓

Multi-device sync is built and verified — see [SYNC.md](./SYNC.md). Run
`npm run server`, then hit **sync now** in the top bar from two browser profiles:
reviews made offline on one device converge on the other, with no lost reviews.
Maps 1:1 onto PowerSync + Postgres (the production swap, documented in SYNC.md).

## Phase 3 — per-user FSRS optimization ✓

The **Tune** tab fits the 21 FSRS weights to your own review history (Adam +
numerical gradients, early-stopped on a validation split), so intervals match how
you personally forget. See [OPTIMIZER.md](./OPTIMIZER.md). Re-optimizing just
changes a pure function — due dates recompute from the same review log, no
migration.

A detailed development log (for AI sessions and future contributors) lives in [CHANGELOG.md](./CHANGELOG.md).

## Phase 4 — accountability / stakes ✓ (local)

The **Commitments** tab is now integrated. Create daily-review or verified-retention
commitments with demo stakes. Retention goals are resolved against real proctored
checkpoints (you must type answers from memory). Progress is derived from the event
log and checkpoints — never self-reported. See `src/core/accountability.ts` and
`components/Commitments.tsx`.

## Phase 5 — Production backend & real service (in progress)

Turn the local prototype into a true multi-device service:

- Replace the toy HTTP sync server with real **PowerSync + Postgres** (Supabase).
- Add proper **authentication** (Supabase Auth / JWTs).
- Support **content updates** (not just create + delete) so editing is possible.
- Keep the pure `recomputeCard()` + CRDT-style merge intact.
- Long-term: background Rust FSRS optimizer, React Native / Expo target, data export.

See:
- [SYNC.md](./SYNC.md) → "Swapping in PowerSync (production)" section (updated: wiring/writes/reactivity/auth substantially complete + .env usage notes + caveats). Local toy server + `npm run server` + dual-mode always prominent and default for dev/tests.
- `.env.example` (project root) → copy to `.env.local` for VITE_SUPABASE_* + VITE_POWERSYNC_URL (real backend).
- `../memorize-spike/db/` → reference Postgres schema, PowerSync rules, client schema, connector
- `PHASE5_MIGRATION_PLAN.md` for status, steps, invariants (steps 1-4 largely complete; next e2e real + commitments + polish)
- Tests now include mocked coverage for powersync path (factory, writes via store, onChange listener deltas, auth effective userId); run `npm test`

## Next up (within / after Phase 5)

- Anki `.apkg` import (deferred to 1.5).
- Polish, full editing UI, data export/backup, mobile (Expo).
- Real (non-demo) stakes / accountability.
