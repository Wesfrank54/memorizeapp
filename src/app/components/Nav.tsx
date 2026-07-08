import type { Dispatch, SetStateAction } from 'react'
import type { AppState } from '../../core/types.ts'
import type { Tab } from '../App.tsx'
import { isLearnHighlightActive } from '../../core/learn.ts'
import { dueQueue } from '../../core/schedule.ts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'learn', label: 'Learn' },
  { id: 'review', label: 'Review' },
  { id: 'add', label: 'Add' },
  { id: 'decks', label: 'Decks' },
  { id: 'import', label: 'Import' },
  { id: 'stats', label: 'Stats' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'order', label: 'Order' },
  { id: 'tune', label: 'Tune' },
  { id: 'commitments', label: 'Commitments' },
  { id: 'image-beta', label: 'Image Testing beta' },
]

export function Nav({ tab, setTab, state }: { tab: Tab; setTab: Dispatch<SetStateAction<Tab>>; state: AppState }) {
  const due = dueQueue(state, new Date()).length
  const highlightActive = isLearnHighlightActive(state.learnHighlight)
  const highlightCount = highlightActive ? state.learnHighlight!.cardIds.length : 0

  return (
    <nav className="nav">
      {TABS.map((t) => (
        <button key={t.id} className={`nav-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
          {t.label}
          {t.id === 'review' && due > 0 ? <span className="badge">{due}</span> : null}
          {t.id === 'review' && highlightCount > 0 ? (
            <span className="badge badge-learn" title="Recently graduated in Learn">
              {highlightCount}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  )
}
