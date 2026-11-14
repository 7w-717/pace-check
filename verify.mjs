// 用 ffmpeg 抽帧，复算 PaceCheck 的判定逻辑，验证它对已知结果的两支片子判得对不对。
// 用法：node verify.mjs <video.mp4>
import { execFileSync } from 'node:child_process'

const W = 480, H = 270
const LOW = 0.6, SLIDE_MED = 1.2, SLIDE_LOW = 0.7, FREEZE = 1.2, DARK = 18

const file = process.argv[2]
if (!file) { console.error('用法: node verify.mjs <video.mp4>'); process.exit(1) }

// 抽成 raw gray（15fps）
const raw = execFileSync('ffmpeg', [
  '-v', 'error', '-i', file,
  '-vf', `fps=30,scale=${W}:${H},format=gray`,
  '-f', 'rawvideo', '-',
], { maxBuffer: 1 << 30 })

const frameSize = W * H
const n = Math.floor(raw.length / frameSize)
if (n < 3) { console.error('帧数太少', n); process.exit(1) }

const lum = []
const diffs = [0]
for (let i = 0; i < n; i++) {
  const off = i * frameSize
  let s = 0
  for (let k = 0; k < frameSize; k += 17) s += raw[off + k]
  lum.push(s / Math.ceil(frameSize / 17))
  if (i > 0) {
    let d = 0
    const po = (i - 1) * frameSize
    for (let k = 0; k < frameSize; k++) d += Math.abs(raw[off + k] - raw[po + k])
    diffs.push(d / frameSize)
  }
}

const d = diffs.slice(1)
const med = q(d, 0.5)
const lowRatio = d.filter(x => x < LOW).length / d.length

const freezes = []
let st = -1
d.forEach((x, i) => {
  if (x < LOW) { if (st < 0) st = i }
  else if (st >= 0) { freezes.push([st, i]); st = -1 }
})
if (st >= 0) freezes.push([st, d.length])
const step = 1 / 30
const longF = freezes.map(([a, b]) => ({ a: a * step, b: b * step, sec: (b - a) * step }))
  .filter(x => x.sec >= FREEZE).sort((x, y) => y.sec - x.sec)

const lumMed = q(lum, 0.5)
const darkLine = Math.min(DARK * 2.2, lumMed * 0.35)
const darks = lumMed < 8 ? 0 : lum.filter(l => l < darkLine).length

const cuts = []
const W2 = 15
for (let i = 2; i < d.length - 2; i++) {
  const around = []
  for (let k = Math.max(0, i - W2); k <= Math.min(d.length - 1, i + W2); k++) if (k !== i) around.push(d[k])
  around.sort((a, b) => a - b)
  const lm = around[around.length >> 1] || 0
  if (d[i] > Math.max(1.6, lm * 3) && d[i] >= d[i - 1] && d[i] >= d[i + 1]) {
    if (!cuts.length || i * step - cuts[cuts.length - 1] > 0.25) cuts.push(i * step)
  }
}
const slide = med < SLIDE_MED && lowRatio > SLIDE_LOW

console.log(JSON.stringify({
  file: file.split(/[\\/]/).pop(),
  frames: n,
  seconds: +(n / 30).toFixed(2),
  median: +med.toFixed(3),
  lowRatio: +lowRatio.toFixed(3),
  longestFreeze: longF.length ? +longF[0].sec.toFixed(2) : 0,
  darkFrames: darks,
  cuts: cuts.length,
  verdict: slide ? '像幻灯片' : med < SLIDE_MED ? '偏静' : '正常',
}, null, 1))

function q(arr, p) {
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(a.length * p))]
}
