import type { AppState, LearnHighlight, Settings } from './types.ts'
import { isLearnHighlightActive, mergeLearnHighlightRemote } from './learn.ts'

/** Learn-related settings synced via fsrs_params.learn_settings_json. */
export const LEARN_SETTING_KEYS = [
  'learnSpacingGap',
  'learnInterleave',
  'learnPretest',
  'learnAdaptiveLadder',
  'learnFsrsReviewRungs',
  'learnGraduateFsrs',
  'learnUnitSynthesis',
  'blankCoverage',
] as const satisfies readonly (keyof Settings)[]

export type LearnSettingKey = (typeof LEARN_SETTING_KEYS)[number]

/** Normalized fsrs_params row (camelCase, parsed JSON). */
export interface FsrsParamsRow {
  weights?: number[]
  desiredRetention?: number
  newPerDay?: number
  lastOptimizedAt?: string
  reviewsAtOptimize?: number
  learnHighlightCardIds?: string[] | null
  learnHighlightSetAt?: string | null
  learnSettingsJson?: string | null
}

export function serializeLearnSettings(settings: Settings): string {
  const o: Record<string, unknown> = {}
  for (const k of LEARN_SETTING_KEYS) {
    if (settings[k] !== undefined) o[k] = settings[k]
  }
  return JSON.stringify(o)
}

export function parseLearnSettings(json: string | null | undefined): Partial<Settings> {
  if (!json) return {}
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const out: Partial<Settings> = {}
    for (const k of LEARN_SETTING_KEYS) {
      if (raw[k] !== undefined) (out as Record<string, unknown>)[k] = raw[k]
    }
    return out
  } catch {
    return {}
  }
}

export function parseFsrsParamsRow(raw: Record<string, unknown>): FsrsParamsRow {
  const out: FsrsParamsRow = {}
  if (Array.isArray(raw.weights)) out.weights = raw.weights as number[]
  else if (typeof raw.weights === 'string') {
    try {
      const w = JSON.parse(raw.weights)
      if (Array.isArray(w)) out.weights = w
    } catch {
      /* ignore */
    }
  }
  if (typeof raw.desiredRetention === 'number') out.desiredRetention = raw.desiredRetention
  if (typeof raw.newPerDay === 'number') out.newPerDay = raw.newPerDay
  if (typeof raw.lastOptimizedAt === 'string') out.lastOptimizedAt = raw.lastOptimizedAt
  if (typeof raw.reviewsAtOptimize === 'number') out.reviewsAtOptimize = raw.reviewsAtOptimize

  if (Array.isArray(raw.learnHighlightCardIds)) out.learnHighlightCardIds = raw.learnHighlightCardIds as string[]
  else if (typeof raw.learnHighlightCardIds === 'string') {
    try {
      const ids = JSON.parse(raw.learnHighlightCardIds)
      if (Array.isArray(ids)) out.learnHighlightCardIds = ids
    } catch {
      /* ignore */
    }
  }
  if (typeof raw.learnHighlightSetAt === 'string') out.learnHighlightSetAt = raw.learnHighlightSetAt
  if (typeof raw.learnSettingsJson === 'string') out.learnSettingsJson = raw.learnSettingsJson
  return out
}

export function highlightFromRow(row: FsrsParamsRow): LearnHighlight | null {
  if (!row.learnHighlightCardIds?.length || !row.learnHighlightSetAt) return null
  const h = { cardIds: row.learnHighlightCardIds, setAt: row.learnHighlightSetAt }
  return isLearnHighlightActive(h) ? h : null
}

/** SQL bind values for fsrs_params INSERT OR REPLACE (settings + learn highlight + learn prefs). */
export function fsrsParamsSqlValues(userId: string, state: AppState): unknown[] {
  const s = state.settings
  const h = state.learnHighlight
  return [
    userId,
    JSON.stringify(s.fsrsWeights ?? []),
    typeof s.desiredRetention === 'number' ? s.desiredRetention : 0.9,
    typeof s.newPerDay === 'number' ? s.newPerDay : 20,
    s.lastOptimized ?? null,
    typeof s.optimizedReviewCount === 'number' ? s.optimizedReviewCount : 0,
    h?.cardIds?.length ? JSON.stringify(h.cardIds) : null,
    h?.setAt ?? null,
    serializeLearnSettings(s),
  ]
}

export const FSRS_PARAMS_INSERT_SQL = `INSERT OR REPLACE INTO fsrs_params (
  user_id, weights, desired_retention, new_per_day, last_optimized_at, reviews_at_optimize,
  learn_highlight_card_ids, learn_highlight_set_at, learn_settings_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

/** Patch settings + learnHighlight from a synced fsrs_params row (LWW on highlight setAt). */
export function patchStateFromFsrsParams(
  state: AppState,
  row: FsrsParamsRow,
  opts?: { configureWeights?: (w: number[]) => void },
): AppState {
  const settingsPatch: Partial<Settings> = {}
  if (row.weights && Array.isArray(row.weights)) {
    settingsPatch.fsrsWeights = row.weights
    opts?.configureWeights?.(row.weights)
  }
  if (typeof row.desiredRetention === 'number') settingsPatch.desiredRetention = row.desiredRetention
  if (typeof row.newPerDay === 'number') settingsPatch.newPerDay = row.newPerDay
  if (row.lastOptimizedAt) settingsPatch.lastOptimized = row.lastOptimizedAt
  if (typeof row.reviewsAtOptimize === 'number') settingsPatch.optimizedReviewCount = row.reviewsAtOptimize
  Object.assign(settingsPatch, parseLearnSettings(row.learnSettingsJson ?? undefined))

  const remote = highlightFromRow(row)
  const learnHighlight = mergeLearnHighlightRemote(state.learnHighlight ?? null, remote)

  return {
    ...state,
    settings: { ...state.settings, ...settingsPatch },
    learnHighlight,
  }
}