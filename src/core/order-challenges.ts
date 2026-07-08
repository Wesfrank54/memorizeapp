/** Drag-and-place ordering exercise (General Orders, chain of command, ranks, …). */

export interface OrderItem {
  id: string
  /** Primary text shown on the draggable row. */
  label: string
  /** Optional subtitle (pay grade, position #, etc.). */
  detail?: string
}

export interface OrderChallenge {
  id: string
  title: string
  description: string
  category: 'general-orders' | 'chain-of-command' | 'ranks'
  /** Items in correct order (first → last). */
  items: OrderItem[]
}

export interface OrderGradeResult {
  perfect: boolean
  /** Fraction of slots in the correct position (0–1). */
  score: number
  correctPositions: boolean[]
  /** How many items are in the wrong slot. */
  wrongCount: number
}

function item(id: string, label: string, detail?: string): OrderItem {
  return { id, label, detail }
}

const GENERAL_ORDERS: OrderItem[] = [
  item('go-1', 'Take charge of this post and all government property in view.', '1'),
  item(
    'go-2',
    'Walk my post in a military manner, keeping always on the alert and observing everything that takes place within sight or hearing.',
    '2',
  ),
  item('go-3', 'Report all violations of orders I am instructed to enforce.', '3'),
  item('go-4', 'Repeat all calls from any post more distant from the guard house than my own.', '4'),
  item('go-5', 'Quit my post only when properly relieved.', '5'),
  item(
    'go-6',
    'Receive, obey, and pass on to the sentry who relieves me all orders from the CO, CDO, OOD, and officers and petty officers of the watch only.',
    '6',
  ),
  item('go-7', 'Talk to no one except in the line of duty.', '7'),
  item('go-8', 'Give the alarm in case of fire or disorder.', '8'),
  item('go-9', 'Call the OOD in any case not covered by instructions.', '9'),
  item('go-10', 'Salute all Officers and all colors and standards not cased.', '10'),
  item(
    'go-11',
    'Be especially watchful at night; during challenging, challenge all persons on or near my post, and allow no one to pass without proper authority.',
    '11',
  ),
]

const CHAIN_OF_COMMAND: OrderItem[] = [
  item('coc-1', 'Class Recruit Division Commander(s) (RDC)', '#1'),
  item('coc-2', 'Class Officer(s)', '#2'),
  item('coc-3', 'Leading Chief Petty Officer, ODS', '#3'),
  item('coc-4', 'Deputy Director, ODS', '#4'),
  item('coc-5', 'Director, ODS', '#5'),
  item('coc-6', 'Command Master Chief, Officer Training Command, Newport', '#6'),
  item('coc-7', 'Executive Officer, Officer Training Command Newport', '#7'),
  item('coc-8', 'Commanding Officer, Officer Training Command Newport', '#8'),
  item('coc-9', 'Commander, Naval Service Training Command', '#9'),
  item('coc-10', 'Commander, Naval Education and Training Command', '#10'),
  item('coc-11', 'Chief of Naval Personnel', '#11'),
  item('coc-12', 'Chief of Naval Operations', '#12'),
  item('coc-13', 'Secretary of the Navy', '#13'),
  item('coc-14', 'Secretary of Defense', '#14'),
  item('coc-15', 'President of the United States', '#15'),
]

const NAVY_OFFICER_RANKS: OrderItem[] = [
  item('navy-o-w2', 'Chief Warrant Officer Two (CWO2)', 'W-2'),
  item('navy-o-w3', 'Chief Warrant Officer Three (CWO3)', 'W-3'),
  item('navy-o-w4', 'Chief Warrant Officer Four (CWO4)', 'W-4'),
  item('navy-o-w5', 'Chief Warrant Officer Five (CWO5)', 'W-5'),
  item('navy-o-o1', 'Ensign (ENS)', 'O-1'),
  item('navy-o-o2', 'Lieutenant Junior Grade (LTJG)', 'O-2'),
  item('navy-o-o3', 'Lieutenant (LT)', 'O-3'),
  item('navy-o-o4', 'Lieutenant Commander (LCDR)', 'O-4'),
  item('navy-o-o5', 'Commander (CDR)', 'O-5'),
  item('navy-o-o6', 'Captain (CAPT)', 'O-6'),
  item('navy-o-o7', 'Rear Admiral Lower Half (RDML)', 'O-7'),
  item('navy-o-o8', 'Rear Admiral (RADM)', 'O-8'),
  item('navy-o-o9', 'Vice Admiral (VADM)', 'O-9'),
  item('navy-o-o10', 'Admiral (ADM)', 'O-10'),
  item('navy-o-o11', 'Fleet Admiral (FADM)', 'O-11'),
]

const NAVY_ENLISTED_RANKS: OrderItem[] = [
  item('navy-e-e1', 'Seaman Recruit (SR)', 'E-1'),
  item('navy-e-e2', 'Seaman Apprentice (SA)', 'E-2'),
  item('navy-e-e3', 'Seaman (SN)', 'E-3'),
  item('navy-e-e4', 'Petty Officer Third Class (PO3)', 'E-4'),
  item('navy-e-e5', 'Petty Officer Second Class (PO2)', 'E-5'),
  item('navy-e-e6', 'Petty Officer First Class (PO1)', 'E-6'),
  item('navy-e-e7', 'Chief Petty Officer (CPO)', 'E-7'),
  item('navy-e-e8', 'Senior Chief Petty Officer (SCPO)', 'E-8'),
  item('navy-e-e9', 'Master Chief Petty Officer (MCPO)', 'E-9'),
  item('navy-e-mcpon', 'Master Chief Petty Officer of the Navy (MCPON)', 'E-9 (top)'),
]

const MARINE_OFFICER_RANKS: OrderItem[] = [
  item('usmc-o-w1', 'Warrant Officer (WO)', 'W-1'),
  item('usmc-o-w2', 'Chief Warrant Officer Two (CWO2)', 'W-2'),
  item('usmc-o-w3', 'Chief Warrant Officer Three (CWO3)', 'W-3'),
  item('usmc-o-w4', 'Chief Warrant Officer Four (CWO4)', 'W-4'),
  item('usmc-o-w5', 'Chief Warrant Officer Five (CWO5)', 'W-5'),
  item('usmc-o-o1', 'Second Lieutenant (2ndLt)', 'O-1'),
  item('usmc-o-o2', 'First Lieutenant (1stLt)', 'O-2'),
  item('usmc-o-o3', 'Captain (Capt)', 'O-3'),
  item('usmc-o-o4', 'Major (Maj)', 'O-4'),
  item('usmc-o-o5', 'Lieutenant Colonel (LtCol)', 'O-5'),
  item('usmc-o-o6', 'Colonel (Col)', 'O-6'),
  item('usmc-o-o7', 'Brigadier General (BGen)', 'O-7'),
  item('usmc-o-o8', 'Major General (MajGen)', 'O-8'),
  item('usmc-o-o9', 'Lieutenant General (LtGen)', 'O-9'),
  item('usmc-o-o10', 'General (Gen)', 'O-10'),
]

export const ORDER_CHALLENGES: OrderChallenge[] = [
  {
    id: 'general-orders-sentry',
    title: 'General Orders of the Sentry',
    description: 'Place all 11 General Orders in order (1st → 11th).',
    category: 'general-orders',
    items: GENERAL_ORDERS,
  },
  {
    id: 'chain-of-command-ods',
    title: 'ODS Chain of Command',
    description: 'Order positions from closest (RDC) to highest (President).',
    category: 'chain-of-command',
    items: CHAIN_OF_COMMAND,
  },
  {
    id: 'navy-officer-ranks',
    title: 'Navy Officer Ranks',
    description: 'Lowest warrant officer (W-2) through Fleet Admiral (O-11).',
    category: 'ranks',
    items: NAVY_OFFICER_RANKS,
  },
  {
    id: 'navy-enlisted-ranks',
    title: 'Navy Enlisted Ranks',
    description: 'E-1 Seaman Recruit through MCPON.',
    category: 'ranks',
    items: NAVY_ENLISTED_RANKS,
  },
  {
    id: 'marine-officer-ranks',
    title: 'Marine Officer Ranks',
    description: 'W-1 Warrant Officer through General (O-10).',
    category: 'ranks',
    items: MARINE_OFFICER_RANKS,
  },
]

export function orderChallengeById(id: string): OrderChallenge | undefined {
  return ORDER_CHALLENGES.find((c) => c.id === id)
}

export function correctOrderIds(challenge: OrderChallenge): string[] {
  return challenge.items.map((i) => i.id)
}

/** Fisher–Yates shuffle; optional seed for tests. */
export function shuffleOrderIds(ids: string[], seed?: number): string[] {
  const a = [...ids]
  let s = seed != null ? seed >>> 0 : (Date.now() >>> 0)
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  if (a.every((id, i) => id === ids[i]) && a.length > 1) {
    ;[a[0], a[1]] = [a[1], a[0]]
  }
  return a
}

export function gradeOrder(userIds: string[], correctIds: string[]): OrderGradeResult {
  if (userIds.length !== correctIds.length) {
    throw new Error('Order grade: length mismatch')
  }
  const correctPositions = userIds.map((id, i) => id === correctIds[i])
  const wrongCount = correctPositions.filter((ok) => !ok).length
  const score = correctPositions.filter(Boolean).length / correctIds.length
  return { perfect: wrongCount === 0, score, correctPositions, wrongCount }
}

export function moveOrderId(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) {
    return ids
  }
  const next = [...ids]
  const [removed] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, removed!)
  return next
}