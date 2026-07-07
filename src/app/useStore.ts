import { useSyncExternalStore } from 'react'
import { getState, subscribe } from '../core/store.ts'
import type { AppState } from '../core/types.ts'

/** Subscribe a component to the global store. Re-renders on every mutation. */
export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getState)
}
