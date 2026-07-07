import type { Card as FsrsCard, Grade } from 'ts-fsrs'

export type { Grade }

// Phase 5 subtask 3d: Type and data model alignment with production schema.
// See Claude/memorize-spike/db/postgres-schema.sql (user_id, device_id NOT NULL, updated_at NOT NULL, card DERIVED CACHE),
// client-schema.ts (PowerSync tables), powersync-sync-rules.yaml, connector.ts.
// Current local model keeps event sourcing (recomputeCard is truth for Card schedule).
// userId optional on entities (for incremental); top-level userId in PushBody (and writes) now derives
// from auth simulation (Phase 5-5) or cfg. In PS mode: real userId from Supabase auth (JWT sub = auth.users.id = app_user.id).

export type NoteType = 'basic' | 'cloze'

/** How a card was answered. 'self' = self-graded; 'passage' = recite-trainer reconstruction; the rest are auto-graded. */
export type AnswerMode = 'self' | 'typed' | 'blank' | 'mcq' | 'passage' | 'passage-full'

export interface Deck {
  id: string
  /** Optional for future multi-user / PowerSync alignment (prod: required user_id on every row). */
  userId?: string
  name: string
  createdAt: string
  /** ISO timestamp for LWW on content sync (Phase 5 / PowerSync). Required (prod default now()).
   * See applyRemote + ../memorize-spike/db/postgres-schema.sql.
   * 3f dual mode: always set by store mutations; wired for powersync path.
   */
  updatedAt: string
}

export interface Note {
  id: string
  /** Optional for future multi-user / PowerSync alignment (prod: required user_id on every row).
   * See ../memorize-spike/db/postgres-schema.sql + client-schema.ts. */
  userId?: string
  deckId: string
  type: NoteType
  /** basic: { front, back } · cloze: { text } */
  fields: Record<string, string>
  tags: string[]
  createdAt: string
  /** ISO timestamp for LWW on content sync (Phase 5 / PowerSync). Required (prod default now()).
   * 3f: set in store + powersyncWriteStub for dual mode.
   */
  updatedAt: string
}

/** A reviewable instance generated from a note's template.
 *
 * Phase 5 data model alignment (subtask 3d):
 * - userId for prod schema
 * - updatedAt required
 * - DERIVED FSRS scheduling cache fields (optional here): the local source of truth
 *   remains the ReviewEvent log + recomputeCard(). These are populated as a cache
 *   (e.g. for due queries after sync or perf), and self-heal on replay.
 *   Matches columns in spike/db/postgres-schema.sql (state, due, stability, ...)
 *   and client-schema.ts PowerSync Table. See ARCHITECTURE.md "derived cache".
 */
export interface Card {
  id: string
  /** Optional for future multi-user / PowerSync alignment (prod: required user_id). */
  userId?: string
  noteId: string
  deckId: string
  /** template index. cloze: 0-based cloze number (c1 -> ord 0). */
  ord: number

  // ---- DERIVED FSRS scheduling cache (recomputed from review_log via recomputeCard) ----
  // Optional because derived; may be present when syncing from prod backend or after local recompute.
  // Clients should (re)compute after merging remote review events.
  state?: number      // 0 New, 1 Learning, 2 Review, 3 Relearning
  due?: string
  stability?: number
  difficulty?: number
  reps?: number
  lapses?: number
  lastReview?: string // last_review in prod
  // --------------------------------------------------------------------------------------

  createdAt: string
  /** ISO timestamp for LWW on content sync (Phase 5 / PowerSync). Required (prod default now()).
   * 3f: set in store + powersyncWriteStub for dual mode.
   */
  updatedAt: string
}

/**
 * Immutable review event — the source of truth for scheduling (Phase 0 thesis).
 * A card's FSRS state is always derived by replaying its events.
 *
 * Phase 5 alignment: deviceId is now required (matches prod review_log.device_id NOT NULL).
 * userId optional on entity (prod required); effective user_id for write now comes from auth/JWT (see sync.ts getCurrentUserId, runtime auth sim).
 */
export interface ReviewEvent {
  id: string
  /** Optional for future multi-user / PowerSync alignment (prod: required user_id on review_log). */
  userId?: string
  cardId: string
  /** 1=Again, 2=Hard, 3=Good, 4=Easy */
  rating: Grade
  reviewedAt: string
  durationMs?: number
  /** Stable client device identifier (used for production sync rules and debugging).
   * Required. Propagated by exportPush; used in spike/db/postgres-schema.sql review_log and sync rules.
   * 3f: set via getDeviceId() in review(); dual mode ready.
   */
  deviceId: string
  /** Set when answered via a graded mode (typed/blank/mcq). Optional; ignored by recomputeCard/FSRS. */
  mode?: AnswerMode
  correct?: boolean
}

/**
 * An objectively-graded answer attempt — the signal for weak-concept scoring.
 * Kept separate from ReviewEvent so Quiz attempts can score without affecting
 * FSRS scheduling. Graded reviews append BOTH a ReviewEvent (drives SRS) and a
 * GradedAttempt (source 'review'); Quiz attempts append only a GradedAttempt.
 */
export interface GradedAttempt {
  id: string
  cardId: string
  mode: AnswerMode
  correct: boolean
  answeredAt: string
  source: 'review' | 'quiz' | 'learn' | 'practice'
  durationMs?: number
}

/** Cards recently graduated from learn mode — prioritized at the front of Review. */
export interface LearnHighlight {
  cardIds: string[]
  setAt: string
}

export interface Settings {
  /** Max brand-new cards introduced per day. */
  newPerDay: number
  /** FSRS target retention (0.70–0.97). */
  desiredRetention: number
  /** Personalized FSRS-6 weights from the optimizer (Phase 3). Absent = defaults. */
  fsrsWeights?: number[]
  /** ISO timestamp of the last optimization run. */
  lastOptimized?: string
  /** How many review predictions the last optimization was trained on. */
  optimizedReviewCount?: number
  /** Preferred answer mode in the Review tab (graded modes feature). Default 'self'. */
  answerMode?: AnswerMode
  /** Fraction of words the fill-in-the-blank trainer blanks out (0..1). Default 0.6. */
  blankCoverage?: number
  /** Learn: cards between re-queued repeats (expanded retrieval). Default 2. */
  learnSpacingGap?: number
  /** Learn: shuffle cumulative-review cards across units. Default true. */
  learnInterleave?: boolean
  /** Learn: typed attempt before the ladder for brand-new cards. Default false. */
  learnPretest?: boolean
  /** Learn: skip easy rungs when prior attempts show mastery. Default true. */
  learnAdaptiveLadder?: boolean
  /** Learn: set review-phase rung from FSRS retrievability. Default true. */
  learnFsrsReviewRungs?: boolean
  /** Learn: emit FSRS review when a card masters in learn/catch-up. Default true. */
  learnGraduateFsrs?: boolean
  /** Learn: full-topic recall test after each multi-card unit, with remediation. Default true. */
  learnUnitSynthesis?: boolean
  /** Study now: total cards per one-click session. Default 15. */
  studyNowCards?: number
}

/** Self-reported familiarity for adaptive learn sessions (per session, not synced). */
export type FamiliarityLevel = 'new' | 'some' | 'comfortable' | 'know'

export type ContentKind = 'deck' | 'note' | 'card'

/** Records a deletion so it propagates on sync (decks/notes/cards have no edits, only create + delete).
 *
 * Phase 5 phase5-4 tombstone improvement (full PS integration):
 * - In local + export/apply: { id, kind } where id === target entity's id.
 * - Maps to 'grave' table in postgres-schema.sql + client-schema.ts: grave has its own id (PK),
 *   target_id (== this.id), kind, user_id, created_at.
 * - In PS/connector: deletes lead to INSERT grave (target_id) or DELETE on content tables.
 * - applyRemote normalizes grave {target_id, kind} -> Tombstone for prune.
 * - Grave rows flow via sync rules and are unioned (presence = deleted).
 */
export interface Tombstone {
  id: string
  kind: ContentKind
}

export type CommitmentKind = 'daily-reviews' | 'retention-goal'
export type Recipient = 'charity' | 'anti-charity'
export type CommitmentStatus = 'active' | 'met' | 'failed' | 'cancelled'

/**
 * A commitment device. Progress is measured from the event log / verified-recall
 * checkpoints — never self-reported — and a (demo) stake is forfeited to charity
 * on failure. See accountability.ts.
 */
export interface Commitment {
  id: string
  kind: CommitmentKind
  title: string
  createdAt: string
  startDate: string
  deadline: string
  // daily-reviews
  dailyTarget?: number
  graceDays?: number
  // retention-goal (verified by checkpoint)
  deckId?: string | null
  targetRetention?: number
  minCards?: number
  // stakes (demo — no real money moves)
  stakeCents: number
  recipient: Recipient
  status: CommitmentStatus
  resolvedAt?: string
}

/** A proctored recall test result — the verification a retention-goal resolves against. */
export interface Checkpoint {
  id: string
  deckId: string | null
  takenAt: string
  sampledCardIds: string[]
  correct: number
  total: number
  /** correct / total */
  score: number
}

export interface AppState {
  decks: Deck[]
  notes: Note[]
  cards: Card[]
  events: ReviewEvent[]
  tombstones: Tombstone[]
  commitments: Commitment[]
  checkpoints: Checkpoint[]
  attempts: GradedAttempt[]
  settings: Settings
  /** Recently FSRS-graduated cards — surfaced first in Review. */
  learnHighlight?: LearnHighlight | null
}

/** A card resolved to renderable content + derived schedule, ready to review. */
export interface ReviewItem {
  card: Card
  note: Note
  deckName: string
  question: string
  answer: string
  fsrs: FsrsCard
  isNew: boolean
}
