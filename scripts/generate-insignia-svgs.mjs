import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const outDir = join(process.cwd(), 'public', 'insignia', 'navy-officer-collar')
mkdirSync(outDir, { recursive: true })

function svg(body, label) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" role="img" aria-label="${label}">
  <rect width="200" height="120" fill="#f4f6f8" rx="8"/>
  <rect x="20" y="48" width="160" height="24" fill="#d8dee6" rx="4"/>
  ${body}
  <text x="100" y="110" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="#6b7280">${label}</text>
</svg>`
}

const gold = '#c9a227'
const silver = '#9ca3af'
const blue = '#1e40af'

const devices = [
  ['o1-ens', 'O-1 ENS — one gold bar', `<rect x="88" y="52" width="24" height="16" fill="${gold}" rx="2"/>`],
  ['o2-ltjg', 'O-2 LTJG — one silver bar', `<rect x="88" y="52" width="24" height="16" fill="${silver}" rx="2"/>`],
  ['o3-lt', 'O-3 LT — two silver bars', `<rect x="76" y="52" width="20" height="16" fill="${silver}" rx="2"/><rect x="104" y="52" width="20" height="16" fill="${silver}" rx="2"/>`],
  ['o4-lcdr', 'O-4 LCDR — gold oak leaf', `<path d="M100 48c-8 6-14 10-14 16 0 6 6 10 14 10s14-4 14-10c0-6-6-10-14-16z" fill="${gold}"/><path d="M92 62c4 2 8 2 8 6h0c0-4 4-4 8-6" fill="none" stroke="${gold}" stroke-width="2"/>`],
  ['o5-cdr', 'O-5 CDR — silver oak leaf', `<path d="M100 48c-8 6-14 10-14 16 0 6 6 10 14 10s14-4 14-10c0-6-6-10-14-16z" fill="${silver}"/><path d="M92 62c4 2 8 2 8 6h0c0-4 4-4 8-6" fill="none" stroke="${silver}" stroke-width="2"/>`],
  ['o6-capt', 'O-6 CAPT — silver eagle', `<path d="M100 50l-18 14h8l-2 12 12-8 12 8-2-12h8z" fill="${silver}"/>`],
  ['o7-rdml', 'O-7 RDML — one star', `<polygon points="100,46 104,58 117,58 107,66 111,78 100,70 89,78 93,66 83,58 96,58" fill="${silver}"/>`],
  ['o8-radm', 'O-8 RADM — two stars', `<polygon points="82,50 85,58 94,58 87,63 90,71 82,66 74,71 77,63 70,58 79,58" fill="${silver}"/><polygon points="118,50 121,58 130,58 123,63 126,71 118,66 110,71 113,63 106,58 115,58" fill="${silver}"/>`],
  ['w2-cwo2', 'W-2 CWO2 — gold bar, three blue breaks', `<rect x="72" y="52" width="56" height="16" fill="${gold}" rx="2"/><rect x="82" y="52" width="3" height="16" fill="${blue}"/><rect x="98" y="52" width="3" height="16" fill="${blue}"/><rect x="114" y="52" width="3" height="16" fill="${blue}"/>`],
  ['w3-cwo3', 'W-3 CWO3 — silver bar, two blue breaks', `<rect x="72" y="52" width="56" height="16" fill="${silver}" rx="2"/><rect x="88" y="52" width="3" height="16" fill="${blue}"/><rect x="108" y="52" width="3" height="16" fill="${blue}"/>`],
  ['w4-cwo4', 'W-4 CWO4 — silver bar, three blue breaks', `<rect x="72" y="52" width="56" height="16" fill="${silver}" rx="2"/><rect x="84" y="52" width="3" height="16" fill="${blue}"/><rect x="98" y="52" width="3" height="16" fill="${blue}"/><rect x="112" y="52" width="3" height="16" fill="${blue}"/>`],
  ['w5-cwo5', 'W-5 CWO5 — silver bar, blue line', `<rect x="72" y="52" width="56" height="16" fill="${silver}" rx="2"/><rect x="96" y="58" width="8" height="4" fill="${blue}"/>`],
  ['o9-vadm', 'O-9 VADM — three stars', `<polygon points="70,50 73,58 82,58 75,63 78,71 70,66 62,71 65,63 58,58 67,58" fill="${silver}"/><polygon points="100,46 104,58 117,58 107,66 111,78 100,70 89,78 93,66 83,58 96,58" fill="${silver}"/><polygon points="130,50 133,58 142,58 135,63 138,71 130,66 122,71 125,63 118,58 127,58" fill="${silver}"/>`],
  ['o10-adm', 'O-10 ADM — four stars', `<polygon points="58,52 61,58 68,58 63,62 65,68 58,64 51,68 53,62 48,58 55,58" fill="${silver}"/><polygon points="82,48 85,56 94,56 87,61 90,69 82,64 74,69 77,61 70,56 79,56" fill="${silver}"/><polygon points="118,48 121,56 130,56 123,61 126,69 118,64 110,69 113,61 106,56 115,56" fill="${silver}"/><polygon points="142,52 145,58 152,58 147,62 149,68 142,64 135,68 137,62 132,58 139,58" fill="${silver}"/>`],
  ['o11-fadm', 'O-11 FADM — five stars', `<polygon points="52,52 54,58 60,58 56,62 58,67 52,64 46,67 48,62 44,58 50,58" fill="${silver}"/><polygon points="72,48 75,56 84,56 77,61 80,69 72,64 64,69 67,61 60,56 69,56" fill="${silver}"/><polygon points="100,44 104,56 117,56 107,64 111,76 100,68 89,76 93,64 83,56 96,56" fill="${silver}"/><polygon points="128,48 131,56 140,56 133,61 136,69 128,64 120,69 123,61 116,56 125,56" fill="${silver}"/><polygon points="148,52 150,58 156,58 152,62 154,67 148,64 142,67 144,62 140,58 146,58" fill="${silver}"/>`],
]

for (const [slug, label, body] of devices) {
  writeFileSync(join(outDir, `${slug}.svg`), svg(body, label), 'utf8')
}

console.log(`Wrote ${devices.length} insignia SVGs to ${outDir}`)