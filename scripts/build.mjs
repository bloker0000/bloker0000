import { readFile, writeFile } from 'node:fs/promises'

const at = (p) => new URL(`../${p}`, import.meta.url)
const n = (v) => +v.toFixed(1)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, k) => a + (b - a) * k
const smooth = (k) => (1 - Math.cos(Math.PI * clamp(k, 0, 1))) / 2
const phase = (t, [a, b]) => clamp((t - a) / (b - a), 0, 1)

const W = 880, H = 260, CX = 440, CY = 126, S = 226
const PEACH = '#FFD18D', INK = '#131313'

// traced from the avatar, in units of its radius
const EYES = [[-0.4226, -0.2117, 0.1248], [0.4457, -0.2222, 0.1161]]
const MOUTH = [[-0.2696, 0.0478], [-0.2652, 0.2652], [0.2522, 0.3], [0.2587, 0.1152]]
const px = ([u, v]) => [n(CX + u * S), n(CY + v * S)]

const NOSE = [443, 112]
// [time, x, y] of the cursor tip, it eases in and out of every point like someone moving a mouse
const PATH = [[0.16, 920, 300], [0.25, 655, 186], [0.31, 598, 52], [0.38, 300, 42], [0.44, 228, 152], [0.51, ...NOSE], [0.66, ...NOSE], [0.76, -40, 214]]
const CLICKS = [0.545, 0.6]
const BLINKS = [0.04, 0.93]

const catmull = (p0, p1, p2, p3, k) =>
  [0, 1].map((a) => 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * k + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * k ** 2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * k ** 3))

function cursor(t) {
  const pts = PATH.map(([, x, y]) => [x, y])
  const i = PATH.findIndex(([time], j) => j > 0 && time > t)
  if (t <= PATH[0][0]) return pts[0]
  if (i === -1) return pts.at(-1)
  const [p1, p2] = [pts[i - 1], pts[i]]
  if (p1[0] === p2[0] && p1[1] === p2[1]) return p1
  return catmull(pts[Math.max(0, i - 2)], p1, p2, pts[Math.min(pts.length - 1, i + 1)], smooth(phase(t, [PATH[i - 1][0], PATH[i][0]])))
}

const toNose = (t) => Math.hypot(cursor(t)[0] - NOSE[0], cursor(t)[1] - NOSE[1])
// 1 when the cursor sits on the nose, this is what makes the eyes cross
const near = (t) => clamp(1 - toNose(t) / 80, 0, 1)

const lookAt = ([x, y]) => [clamp((x - CX) / 330, -1, 1), clamp((y - 100) / 110, -1, 1)]

// [time, x, y], straight lines between them, short gaps read as quick eye darts
const GLANCES = [[0, 0, 0], [0.07, 0, 0], [0.08, 0.85, -0.35], [0.12, 0.85, -0.35], [0.13, -0.6, 0.3], [0.155, -0.6, 0.3]]
const AFTER = [[0.785, -1, 0.55], [0.86, -1, 0.55], [0.875, 0, 0], [1, 0, 0]]

function keyed(points, t) {
  const i = points.findIndex(([time]) => time > t)
  if (i <= 0) return points.at(-1).slice(1)
  const [a, ax, ay] = points[i - 1], [b, bx, by] = points[i]
  const k = (t - a) / (b - a)
  return [lerp(ax, bx, k), lerp(ay, by, k)]
}

function gaze(t) {
  if (t < GLANCES.at(-1)[0]) return keyed(GLANCES, t)
  if (t < AFTER[0][0]) {
    // eyes trail the cursor a little instead of being glued to it
    const [gx, gy] = lookAt(cursor(Math.max(PATH[0][0], t - 0.008)))
    return [gx, gy + 0.5 * near(t)]
  }
  return keyed(AFTER, t)
}

const squeeze = (t) => Math.max(0, ...CLICKS.map((c) => Math.min(phase(t, [c, c + 0.004]), 1 - phase(t, [c + 0.018, c + 0.024]))))
const press = (t) => Math.max(0, ...CLICKS.map((c) => Math.min(phase(t, [c, c + 0.004]), 1 - phase(t, [c + 0.01, c + 0.016]))))

function blink(t) {
  const d = Math.min(...BLINKS.map((b) => Math.abs(t - b)))
  const open = d < 0.008 ? lerp(1, 0.08, 1 - d / 0.008) : 1
  return Math.min(open, 1 - 0.9 * squeeze(t))
}

const MAX_X = 0.085 * S, MAX_Y = 0.06 * S
// the whole face turns a bit with the eyes so it doesnt look like two sliding dots
const HEAD = 0.25

function keyframes(name, value) {
  const steps = 400
  const pts = Array.from({ length: steps + 1 }, (_, i) => [+((i / steps) * 100).toFixed(2), value(i / steps)])
  const kept = pts.filter(([, v], i) => i === 0 || i === steps || v !== pts[i - 1][1] || v !== pts[i + 1][1])
  return `@keyframes ${name}{${kept.map(([p, v]) => `${p}%{${v}}`).join('')}}`
}

const move = (x, y) => `transform:translate(${n(x)}px,${n(y)}px)`
const eye = (side) => (t) => {
  const [gx, gy] = gaze(t)
  return move(gx * MAX_X * (1 - HEAD) + side * near(t) * 0.95 * MAX_X, gy * MAX_Y * (1 - HEAD))
}

const css = [
  '.head,.el,.er,.bl,.mouth,.cur,.arrow,.hand,.down{animation-duration:16s;animation-timing-function:linear;animation-iteration-count:infinite}',
  '.head{animation-name:head}.el{animation-name:el}.er{animation-name:er}',
  '.bl{animation-name:blink;transform-box:fill-box;transform-origin:center}',
  '.mouth{animation-name:mouth;transform-box:fill-box;transform-origin:center}',
  '.cur{animation-name:cur;transform:translate(-60px,-60px)}',
  '.arrow{animation-name:arrow}.hand{animation-name:hand;opacity:0}.down{animation-name:down;opacity:0}',
  keyframes('head', (t) => { const [gx, gy] = gaze(t); return move(gx * MAX_X * HEAD, gy * MAX_Y * HEAD + 3 * squeeze(t)) }),
  keyframes('el', eye(1)),
  keyframes('er', eye(-1)),
  keyframes('blink', (t) => `transform:scaleY(${blink(t).toFixed(2)})`),
  keyframes('mouth', (t) => { const k = Math.max(0.6 * near(t), squeeze(t)); return `transform:scale(${(1 + 0.05 * k).toFixed(3)},${(1 - 0.18 * k).toFixed(3)})` }),
  keyframes('cur', (t) => move(...cursor(t))),
  // turns into the link hand over the nose, the face is clickable after all
  keyframes('arrow', (t) => `opacity:${toNose(t) < 70 ? 0 : 1}`),
  keyframes('hand', (t) => `opacity:${toNose(t) < 70 && press(t) < 0.5 ? 1 : 0}`),
  keyframes('down', (t) => `opacity:${press(t) >= 0.5 ? 1 : 0}`),
  '@media (prefers-reduced-motion:reduce){*{animation:none!important}}',
].join('')

const [[lx, ly], [rx, ry]] = EYES.map((e) => px(e))
// pixel maps of the default windows cursors, # is the outline and o the white fill
const ARROW = [
  '#...........',
  '##..........',
  '#o#.........',
  '#oo#........',
  '#ooo#.......',
  '#oooo#......',
  '#ooooo#.....',
  '#oooooo#....',
  '#ooooooo#...',
  '#oooooooo#..',
  '#ooooooooo#.',
  '#oooooo#####',
  '#ooo#oo#....',
  '#oo#.#oo#...',
  '#o#..#oo#...',
  '##....#oo#..',
  '......#oo#..',
  '.......##...',
]
const HAND = [
  '......##..........',
  '.....#oo#.........',
  '.....#oo#.........',
  '.....#oo#.........',
  '.....#oo#.........',
  '.....#oo#.........',
  '.....#oo###.......',
  '.....#oo#oo###....',
  '.....#oo#oo#oo###.',
  '.##..#oo#oo#oo#oo#',
  '#oo#.#oo#oo#oo#oo#',
  '#ooo##oo#oo#oo#oo#',
  '#oooooooooooooooo#',
  '.#ooooooooooooooo#',
  '..#oooooooooooooo#',
  '...#ooooooooooooo#',
  '....#oooooooooooo#',
  '.....#ooooooooooo#',
  '.....#ooooooooooo#',
  '.....#oooooooooo#.',
  '.....#oooooooooo#.',
  '.....############.',
]
// the click frame: same hand, index finger bent in by 4 pixels
const HAND_DOWN = HAND.filter((_, y) => y < 2 || y > 5)
// hx, hy is the hotspot, the pixel the click lands on
function sprite(map, hx, hy) {
  const runs = (re) => map.flatMap((row, y) => [...row.matchAll(re)].map((m) => `M${m.index - hx} ${y - hy}h${m[0].length}v1h-${m[0].length}z`)).join('')
  return `<path d="${runs(/[#o]+/g)}" fill="${INK}" fill-opacity=".25" transform="translate(1 1)"/><path d="${runs(/o+/g)}" fill="#FFFFFF"/><path d="${runs(/#+/g)}" fill="${INK}"/>`
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">
<title id="t">a smiley looking around until a cursor pokes it on the nose</title>
<style>${css}</style>
<rect width="${W}" height="${H}" rx="16" fill="${PEACH}"/>
<g class="head" fill="${INK}">
<g class="el"><circle class="bl" cx="${lx}" cy="${ly}" r="${n(EYES[0][2] * S)}"/></g>
<g class="er"><circle class="bl" cx="${rx}" cy="${ry}" r="${n(EYES[1][2] * S)}"/></g>
<g class="mouth"><path d="M${MOUTH.map(px).map((p) => p.join(' ')).join('L')}" fill="none" stroke="${INK}" stroke-width="${n(0.1174 * S)}" stroke-linecap="round" stroke-linejoin="round"/></g>
</g>
<g class="cur"><g transform="scale(1.12)" shape-rendering="crispEdges">
<g class="arrow">${sprite(ARROW, 0, 0)}</g>
<g class="hand">${sprite(HAND, 7, 0)}</g>
<g class="down">${sprite(HAND_DOWN, 7, -4)}</g>
</g></g>
</svg>
`

await writeFile(at('assets/face.svg'), svg)
console.log(`face.svg: ${(svg.length / 1024).toFixed(1)} KB`)

// icon paths come from simple-icons, see scripts/icons.json
const { rows } = JSON.parse(await readFile(at('scripts/icons.json'), 'utf8'))
const COL = 84, ICON = 30, ROW = 76, TOP = 26
const SH = TOP + rows.length * ROW + 4
let order = 0
const items = rows
  .flatMap((row, r) => {
    const left = (W - row.length * COL) / 2
    return row.map(({ label, d }, i) => {
      const x = left + COL * i + COL / 2
      const y = TOP + r * ROW
      return `<g class="ic" style="animation-delay:${(order++ * 0.025).toFixed(3)}s"><path d="${d}" transform="translate(${n(x - ICON / 2)} ${y}) scale(${ICON / 24})"/><text x="${n(x)}" y="${y + ICON + 18}" text-anchor="middle">${label}</text></g>`
    })
  })
  .join('\n')
const stack = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${SH}" viewBox="0 0 ${W} ${SH}" role="img" aria-labelledby="t">
<title id="t">stack: ${rows.flat().map((i) => i.label).join(', ')}</title>
<style>text{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.ic{animation:pop .5s cubic-bezier(.2,.8,.3,1.15) both;transform-box:fill-box;transform-origin:center}@keyframes pop{from{opacity:0;transform:translateY(6px) scale(.85)}}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
<rect width="${W}" height="${SH}" rx="16" fill="${PEACH}"/>
<g fill="${INK}">
${items}
</g>
</svg>
`
await writeFile(at('assets/stack.svg'), stack)
console.log(`stack.svg: ${(stack.length / 1024).toFixed(1)} KB`)
