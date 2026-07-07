import type { LearnTabMode, PersistedLearn } from './learn.ts'

const STORAGE_KEYS: Record<LearnTabMode, string> = {
  manual: 'memorize-learn-resume-manual-v1',
  adaptive: 'memorize-learn-resume-adaptive-v1',
}

/** Legacy single-key resume (pre split tabs). */
const LEGACY_STORAGE_KEY = 'memorize-learn-resume-v1'

function storageKey(mode: LearnTabMode): string {
  return STORAGE_KEYS[mode]
}

export function saveLearnResume(p: PersistedLearn, mode: LearnTabMode = p.session.tabMode ?? 'manual'): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey(mode), JSON.stringify(p))
}

export function loadLearnResume(mode: LearnTabMode): PersistedLearn | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(mode))
    if (raw) return JSON.parse(raw) as PersistedLearn
    if (mode === 'manual') {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacy) return JSON.parse(legacy) as PersistedLearn
    }
    return null
  } catch {
    return null
  }
}

export function clearLearnResume(mode: LearnTabMode): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(storageKey(mode))
  if (mode === 'manual') localStorage.removeItem(LEGACY_STORAGE_KEY)
}