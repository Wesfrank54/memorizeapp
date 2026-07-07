# memorize-app

Spaced-repetition app (React 19 + Vite + TypeScript) on an event-sourced FSRS
core. Local MVP complete; Phase 5 in progress — see `README.md`,
`PHASE5_MIGRATION_PLAN.md`, `SYNC.md`, `OPTIMIZER.md`.

This file is the shared agent-instructions source for both Claude Code (via
`CLAUDE.md` import) and Grok Build. Edit this file, not `CLAUDE.md`.

## Commands

```bash
npm run dev        # Vite dev server, http://localhost:5173
npm run server     # sync server, http://localhost:8787 (see SYNC.md)
npm test           # node:test — core + sync + optimizer
npm run build      # tsc --noEmit + vite build
npm run typecheck
```

Run `npm test` and `npm run typecheck` before considering a change done.

## Invariants — do not break

- `src/core/` is framework-agnostic: **zero React imports**. It must stay
  portable to React Native/Expo. All UI logic lives in `src/app/`.
- Reviews are an **append-only event log**. `store.ts` is the only writer of
  review events (`review()` appends an immutable event). Never edit scheduling
  state directly — it is always derived by replaying events through
  `recomputeCard()` in `core/fsrs.ts`.
- Scheduling is deterministic: `enable_fuzz: false` in `core/fsrs.ts`. Don't
  enable fuzz or introduce nondeterminism into the core.

## Layout

- `src/core/` — fsrs.ts, schedule.ts, cloze.ts, csv.ts, stats.ts, store.ts, types.ts
- `src/app/` — App.tsx, useStore.ts, components/, styles.css
- `server/` — sync server (Phase 2+)
- `test/` — node:test suites
