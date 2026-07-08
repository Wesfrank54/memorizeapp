import { useState } from 'react'
import { useStore } from './useStore.ts'
import { Nav } from './components/Nav.tsx'
import { ReviewSession } from './components/ReviewSession.tsx'
import { AddCard } from './components/AddCard.tsx'
import { DeckList } from './components/DeckList.tsx'
import { ImportCsv } from './components/ImportCsv.tsx'
import { Stats } from './components/Stats.tsx'
import { Optimize } from './components/Optimize.tsx'
import { SyncBar } from './components/SyncBar.tsx'
import { Commitments } from './components/Commitments.tsx'
import { Quiz } from './components/Quiz.tsx'
import { Learn } from './components/Learn.tsx'
import { ImageTestingBeta } from './components/ImageTestingBeta.tsx'
import { OrderPractice } from './components/OrderPractice.tsx'

export type Tab =
  | 'learn'
  | 'review'
  | 'add'
  | 'decks'
  | 'import'
  | 'stats'
  | 'quiz'
  | 'order'
  | 'tune'
  | 'commitments'
  | 'image-beta'

export function App() {
  const state = useStore()
  const [tab, setTab] = useState<Tab>('learn')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          memorize <span className="tag">MVP</span>
        </div>
        <Nav tab={tab} setTab={setTab} state={state} />
      </header>
      <SyncBar />
      <main className="content">
        {tab === 'learn' && <Learn state={state} onGoToReview={() => setTab('review')} />}
        {tab === 'review' && <ReviewSession state={state} />}
        {tab === 'add' && <AddCard state={state} />}
        {tab === 'decks' && <DeckList state={state} />}
        {tab === 'import' && <ImportCsv />}
        {tab === 'stats' && <Stats state={state} />}
        {tab === 'quiz' && <Quiz state={state} />}
        {tab === 'order' && <OrderPractice />}
        {tab === 'tune' && <Optimize state={state} />}
        {tab === 'commitments' && <Commitments state={state} />}
        {tab === 'image-beta' && <ImageTestingBeta state={state} />}
      </main>
    </div>
  )
}
