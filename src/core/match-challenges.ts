import { resolveMediaUrl } from './media.ts'
import {
  allOrderSlotsFilled,
  correctOrderIds,
  gradeOrder,
  initOrderPlacement,
  placeOrderItem,
  returnOrderItemToPool,
  shuffleOrderIds,
  slotsToOrder,
  type OrderDragSource,
  type OrderGradeResult,
  type OrderItem,
  type OrderSlotState,
} from './order-challenges.ts'

export type { OrderDragSource, OrderGradeResult, OrderItem, OrderSlotState }
export {
  allOrderSlotsFilled,
  correctOrderIds,
  gradeOrder,
  initOrderPlacement,
  placeOrderItem,
  returnOrderItemToPool,
  shuffleOrderIds,
  slotsToOrder,
}

export interface MatchPair {
  id: string
  rankLabel: string
  rankCode: string
  /** Collar device or shoulder board image (when available). */
  imageUrl?: string
  /** Text description when no image is bundled yet. */
  insigniaHint?: string
}

export interface MatchChallenge {
  id: string
  title: string
  description: string
  category: 'collar' | 'shoulder'
  pairs: MatchPair[]
}

const RANK_CODES = [
  'W-2 CWO2',
  'W-3 CWO3',
  'W-4 CWO4',
  'W-5 CWO5',
  'O-1 ENS',
  'O-2 LTJG',
  'O-3 LT',
  'O-4 LCDR',
  'O-5 CDR',
  'O-6 CAPT',
  'O-7 RDML',
  'O-8 RADM',
  'O-9 VADM',
  'O-10 ADM',
  'O-11 FADM',
] as const

const RANK_LABELS: Record<(typeof RANK_CODES)[number], string> = {
  'W-2 CWO2': 'Chief Warrant Officer Two (CWO2)',
  'W-3 CWO3': 'Chief Warrant Officer Three (CWO3)',
  'W-4 CWO4': 'Chief Warrant Officer Four (CWO4)',
  'W-5 CWO5': 'Chief Warrant Officer Five (CWO5)',
  'O-1 ENS': 'Ensign (ENS)',
  'O-2 LTJG': 'Lieutenant Junior Grade (LTJG)',
  'O-3 LT': 'Lieutenant (LT)',
  'O-4 LCDR': 'Lieutenant Commander (LCDR)',
  'O-5 CDR': 'Commander (CDR)',
  'O-6 CAPT': 'Captain (CAPT)',
  'O-7 RDML': 'Rear Admiral Lower Half (RDML)',
  'O-8 RADM': 'Rear Admiral (RADM)',
  'O-9 VADM': 'Vice Admiral (VADM)',
  'O-10 ADM': 'Admiral (ADM)',
  'O-11 FADM': 'Fleet Admiral (FADM)',
}

const COLLAR_SLUGS: Record<(typeof RANK_CODES)[number], string> = {
  'W-2 CWO2': 'w2-cwo2',
  'W-3 CWO3': 'w3-cwo3',
  'W-4 CWO4': 'w4-cwo4',
  'W-5 CWO5': 'w5-cwo5',
  'O-1 ENS': 'o1-ens',
  'O-2 LTJG': 'o2-ltjg',
  'O-3 LT': 'o3-lt',
  'O-4 LCDR': 'o4-lcdr',
  'O-5 CDR': 'o5-cdr',
  'O-6 CAPT': 'o6-capt',
  'O-7 RDML': 'o7-rdml',
  'O-8 RADM': 'o8-radm',
  'O-9 VADM': 'o9-vadm',
  'O-10 ADM': 'o10-adm',
  'O-11 FADM': 'o11-fadm',
}

const COLLAR_HINTS: Record<(typeof RANK_CODES)[number], string> = {
  'W-2 CWO2': 'Gold bar with three blue breaks',
  'W-3 CWO3': 'Silver bar with two blue breaks',
  'W-4 CWO4': 'Silver bar with three blue breaks',
  'W-5 CWO5': 'Silver bar with one 1/8-inch horizontal blue line',
  'O-1 ENS': 'One gold bar',
  'O-2 LTJG': 'One silver bar',
  'O-3 LT': 'Two silver bars',
  'O-4 LCDR': 'Gold oak leaf',
  'O-5 CDR': 'Silver oak leaf',
  'O-6 CAPT': 'Silver eagle',
  'O-7 RDML': 'One silver five-pointed star',
  'O-8 RADM': 'Two silver five-pointed stars',
  'O-9 VADM': 'Three silver five-pointed stars',
  'O-10 ADM': 'Four silver five-pointed stars',
  'O-11 FADM': 'Five silver five-pointed stars',
}

const SHOULDER_HINTS: Record<(typeof RANK_CODES)[number], string> = {
  'W-2 CWO2': 'One gold 1/2-inch stripe with three blue breaks outboard a specialty insignia',
  'W-3 CWO3': 'One gold 1/2-inch stripe with two blue breaks outboard a specialty insignia',
  'W-4 CWO4': 'One gold 1/2-inch stripe with one blue break outboard a specialty insignia',
  'W-5 CWO5': 'Two thin gold stripes with one blue break outboard a specialty insignia',
  'O-1 ENS': 'One gold 1/2-inch stripe outboard a gold five-pointed star',
  'O-2 LTJG': 'One gold 1/2-inch stripe outboard one 1/4-inch gold stripe outboard a gold five-pointed star',
  'O-3 LT': 'Two gold 1/2-inch stripes outboard a gold five-pointed star',
  'O-4 LCDR':
    'One gold 1/2-inch stripe outboard one gold 1/4-inch stripe outboard one gold 1/2-inch stripe outboard a gold five-pointed star',
  'O-5 CDR': 'Three gold 1/2-inch stripes outboard a gold five-pointed star',
  'O-6 CAPT': 'Four gold 1/2-inch stripes outboard a gold five-pointed star',
  'O-7 RDML': 'Gold shoulder boards with one silver five-pointed star outboard a silver fouled anchor',
  'O-8 RADM': 'Gold shoulder boards with two silver five-pointed stars outboard a silver fouled anchor',
  'O-9 VADM': 'Gold shoulder boards with three silver five-pointed stars outboard a silver fouled anchor',
  'O-10 ADM': 'Gold shoulder boards with four silver five-pointed stars outboard a silver fouled anchor',
  'O-11 FADM': 'Gold shoulder boards with five silver five-pointed stars outboard a silver fouled anchor',
}

function pairId(kind: 'collar' | 'shoulder', code: (typeof RANK_CODES)[number]): string {
  return `navy-officer-${kind}-${code.toLowerCase().replace(/\s+/g, '-')}`
}

function buildNavyOfficerPairs(kind: 'collar' | 'shoulder'): MatchPair[] {
  const folder = kind === 'collar' ? 'navy-officer-collar' : 'navy-officer-shoulder'
  const hints = kind === 'collar' ? COLLAR_HINTS : SHOULDER_HINTS
  return RANK_CODES.map((code) => {
    const slug = COLLAR_SLUGS[code]
    const imagePath = `insignia/${folder}/${slug}.png`
    return {
      id: pairId(kind, code),
      rankLabel: RANK_LABELS[code],
      rankCode: code,
      imageUrl: kind === 'collar' ? resolveMediaUrl(imagePath) : undefined,
      insigniaHint: hints[code],
    }
  })
}

const NAVY_OFFICER_COLLAR = buildNavyOfficerPairs('collar')
const NAVY_OFFICER_SHOULDER = buildNavyOfficerPairs('shoulder')

export const MATCH_CHALLENGES: MatchChallenge[] = [
  {
    id: 'navy-officer-collar',
    title: 'Navy Officer Collar Devices',
    description: 'Match each collar device image to the correct officer rank (W-2 through O-11).',
    category: 'collar',
    pairs: NAVY_OFFICER_COLLAR,
  },
  {
    id: 'navy-officer-shoulder',
    title: 'Navy Officer Shoulder Boards',
    description: 'Match each shoulder board description to the correct officer rank (W-2 through O-11).',
    category: 'shoulder',
    pairs: NAVY_OFFICER_SHOULDER,
  },
]

export function matchChallengeById(id: string): MatchChallenge | undefined {
  return MATCH_CHALLENGES.find((c) => c.id === id)
}

/** Pool rows: draggable rank labels (one per pair). */
export function matchPoolItems(challenge: MatchChallenge): OrderItem[] {
  return challenge.pairs.map((p) => ({
    id: p.id,
    label: p.rankLabel,
    detail: p.rankCode,
  }))
}

export function correctMatchIds(challenge: MatchChallenge): string[] {
  return challenge.pairs.map((p) => p.id)
}