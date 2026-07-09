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

export type MatchBranch = 'navy' | 'marine'

export interface MatchChallenge {
  id: string
  title: string
  description: string
  branch: MatchBranch
  category: 'collar' | 'shoulder'
  pairs: MatchPair[]
}

interface RankRow {
  code: string
  label: string
  slug: string
  collarHint: string
}

function pairId(branch: MatchBranch, kind: 'collar' | 'shoulder', code: string): string {
  return `${branch}-officer-${kind}-${code.toLowerCase().replace(/\s+/g, '-')}`
}

function buildOfficerPairs(
  branch: MatchBranch,
  kind: 'collar' | 'shoulder',
  rows: RankRow[],
): MatchPair[] {
  const folder = `${branch}-officer-${kind}`
  return rows.map((row) => {
    const imagePath = `insignia/${folder}/${row.slug}.png`
    const insigniaHint =
      kind === 'collar'
        ? row.collarHint
        : `Shoulder board displaying ${row.collarHint.charAt(0).toLowerCase()}${row.collarHint.slice(1)}`
    const hasBundledCollarImages = branch === 'navy' && kind === 'collar'
    return {
      id: pairId(branch, kind, row.code),
      rankLabel: row.label,
      rankCode: row.code,
      imageUrl: hasBundledCollarImages ? resolveMediaUrl(imagePath) : undefined,
      insigniaHint,
    }
  })
}

const NAVY_OFFICER_ROWS: RankRow[] = [
  { code: 'W-2 CWO2', label: 'Chief Warrant Officer Two (CWO2)', slug: 'w2-cwo2', collarHint: 'Gold bar with three blue breaks' },
  { code: 'W-3 CWO3', label: 'Chief Warrant Officer Three (CWO3)', slug: 'w3-cwo3', collarHint: 'Silver bar with two blue breaks' },
  { code: 'W-4 CWO4', label: 'Chief Warrant Officer Four (CWO4)', slug: 'w4-cwo4', collarHint: 'Silver bar with three blue breaks' },
  { code: 'W-5 CWO5', label: 'Chief Warrant Officer Five (CWO5)', slug: 'w5-cwo5', collarHint: 'Silver bar with one 1/8-inch horizontal blue line' },
  { code: 'O-1 ENS', label: 'Ensign (ENS)', slug: 'o1-ens', collarHint: 'One gold bar' },
  { code: 'O-2 LTJG', label: 'Lieutenant Junior Grade (LTJG)', slug: 'o2-ltjg', collarHint: 'One silver bar' },
  { code: 'O-3 LT', label: 'Lieutenant (LT)', slug: 'o3-lt', collarHint: 'Two silver bars' },
  { code: 'O-4 LCDR', label: 'Lieutenant Commander (LCDR)', slug: 'o4-lcdr', collarHint: 'Gold oak leaf' },
  { code: 'O-5 CDR', label: 'Commander (CDR)', slug: 'o5-cdr', collarHint: 'Silver oak leaf' },
  { code: 'O-6 CAPT', label: 'Captain (CAPT)', slug: 'o6-capt', collarHint: 'Silver eagle' },
  { code: 'O-7 RDML', label: 'Rear Admiral Lower Half (RDML)', slug: 'o7-rdml', collarHint: 'One silver five-pointed star' },
  { code: 'O-8 RADM', label: 'Rear Admiral (RADM)', slug: 'o8-radm', collarHint: 'Two silver five-pointed stars' },
  { code: 'O-9 VADM', label: 'Vice Admiral (VADM)', slug: 'o9-vadm', collarHint: 'Three silver five-pointed stars' },
  { code: 'O-10 ADM', label: 'Admiral (ADM)', slug: 'o10-adm', collarHint: 'Four silver five-pointed stars' },
  { code: 'O-11 FADM', label: 'Fleet Admiral (FADM)', slug: 'o11-fadm', collarHint: 'Five silver five-pointed stars' },
]

const NAVY_SHOULDER_HINTS: Record<string, string> = {
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

const MARINE_OFFICER_ROWS: RankRow[] = [
  { code: 'W-1 WO', label: 'Warrant Officer (WO)', slug: 'w1-wo', collarHint: 'Single bar device with a red background and one gold break' },
  { code: 'W-2 CWO2', label: 'Chief Warrant Officer Two (CWO2)', slug: 'w2-cwo2', collarHint: 'Single bar device with a red background and two gold breaks' },
  { code: 'W-3 CWO3', label: 'Chief Warrant Officer Three (CWO3)', slug: 'w3-cwo3', collarHint: 'Single bar device with a red background and one silver break' },
  { code: 'W-4 CWO4', label: 'Chief Warrant Officer Four (CWO4)', slug: 'w4-cwo4', collarHint: 'Single bar device with a red background and two silver breaks' },
  { code: 'W-5 CWO5', label: 'Chief Warrant Officer Five (CWO5)', slug: 'w5-cwo5', collarHint: 'Single silver bar device with a thin red break in the center' },
  { code: 'O-1 2ndLt', label: 'Second Lieutenant (2ndLt)', slug: 'o1-2ndlt', collarHint: 'One gold bar' },
  { code: 'O-2 1stLt', label: 'First Lieutenant (1stLt)', slug: 'o2-1stlt', collarHint: 'One silver bar' },
  { code: 'O-3 Capt', label: 'Captain (Capt)', slug: 'o3-capt', collarHint: 'Two silver bars' },
  { code: 'O-4 Maj', label: 'Major (Maj)', slug: 'o4-maj', collarHint: 'Gold oak leaf' },
  { code: 'O-5 LtCol', label: 'Lieutenant Colonel (LtCol)', slug: 'o5-ltcol', collarHint: 'Silver oak leaf' },
  { code: 'O-6 Col', label: 'Colonel (Col)', slug: 'o6-col', collarHint: 'Silver eagle' },
  { code: 'O-7 BGen', label: 'Brigadier General (BGen)', slug: 'o7-bgen', collarHint: 'One silver five-pointed star' },
  { code: 'O-8 MajGen', label: 'Major General (MajGen)', slug: 'o8-majgen', collarHint: 'Two silver five-pointed stars' },
  { code: 'O-9 LtGen', label: 'Lieutenant General (LtGen)', slug: 'o9-ltgen', collarHint: 'Three silver five-pointed stars' },
  { code: 'O-10 Gen', label: 'General (Gen)', slug: 'o10-gen', collarHint: 'Four silver five-pointed stars' },
]

function buildNavyShoulderPairs(): MatchPair[] {
  return NAVY_OFFICER_ROWS.map((row) => ({
    id: pairId('navy', 'shoulder', row.code),
    rankLabel: row.label,
    rankCode: row.code,
    insigniaHint: NAVY_SHOULDER_HINTS[row.code],
  }))
}

export const MATCH_CHALLENGES: MatchChallenge[] = [
  {
    id: 'navy-officer-collar',
    title: 'Navy Officer Collar Devices',
    description: 'Match each collar device image to the correct officer rank (W-2 through O-11).',
    branch: 'navy',
    category: 'collar',
    pairs: buildOfficerPairs('navy', 'collar', NAVY_OFFICER_ROWS),
  },
  {
    id: 'navy-officer-shoulder',
    title: 'Navy Officer Shoulder Boards',
    description: 'Match each shoulder board description to the correct officer rank (W-2 through O-11).',
    branch: 'navy',
    category: 'shoulder',
    pairs: buildNavyShoulderPairs(),
  },
  {
    id: 'marine-officer-collar',
    title: 'Marine Officer Collar Devices',
    description: 'Match each collar device description to the correct officer rank (W-1 through O-10).',
    branch: 'marine',
    category: 'collar',
    pairs: buildOfficerPairs('marine', 'collar', MARINE_OFFICER_ROWS),
  },
  {
    id: 'marine-officer-shoulder',
    title: 'Marine Officer Shoulder Boards',
    description: 'Match each shoulder board description to the correct officer rank (W-1 through O-10).',
    branch: 'marine',
    category: 'shoulder',
    pairs: buildOfficerPairs('marine', 'shoulder', MARINE_OFFICER_ROWS),
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