import { nativeImage } from 'electron'
import { deflateSync } from 'zlib'
import type { NativeImage } from 'electron'

// ─── PNG encoder (zero external deps) ────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length)
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePNG(rgba: Buffer, w: number, h: number): Buffer {
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const stride = w * 4
  const raw = Buffer.allocUnsafe(h * (1 + stride))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Pixel canvas ─────────────────────────────────────────────────────────────

class PixelCanvas {
  private buf: Buffer
  constructor(private w: number, private h: number) {
    this.buf = Buffer.alloc(w * h * 4)
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return
    const i = (y * this.w + x) * 4
    this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = a
  }

  getPixel(x: number, y: number): { r: number; g: number; b: number; a: number } {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return { r: 0, g: 0, b: 0, a: 0 }
    const i = (y * this.w + x) * 4
    return { r: this.buf[i], g: this.buf[i + 1], b: this.buf[i + 2], a: this.buf[i + 3] }
  }

  blendPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return
    const src = this.getPixel(x, y)
    const sa = a / 255
    const da = src.a / 255
    const oa = sa + da * (1 - sa)
    if (oa === 0) return
    const i = (y * this.w + x) * 4
    this.buf[i]     = Math.round((r * sa + src.r * da * (1 - sa)) / oa)
    this.buf[i + 1] = Math.round((g * sa + src.g * da * (1 - sa)) / oa)
    this.buf[i + 2] = Math.round((b * sa + src.b * da * (1 - sa)) / oa)
    this.buf[i + 3] = Math.round(oa * 255)
  }

  fill(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a = 255): void {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
        const i = (y * this.w + x) * 4
        this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = a
      }
    }
  }

  toNativeImage(): NativeImage {
    return nativeImage.createFromBuffer(encodePNG(this.buf, this.w, this.h))
  }
}

// ─── Color logic ──────────────────────────────────────────────────────────────

// Low: #648FFF, Medium: #F4E04D, High: #FF7C80, At limit: #CC0000
function barColor(util: number, thresholds: { medium: number; high: number }, errorMode: boolean, colorByUsage: boolean): [number, number, number] {
  if (errorMode) return [136, 136, 136]
  if (!colorByUsage) return [100, 143, 255]              // 常に青（使用量で色分けしない）
  if (util >= 100)               return [204,   0,   0]  // at limit #CC0000
  if (util >= thresholds.high)   return [255, 124, 128]  // high     #FF7C80
  if (util >= thresholds.medium) return [244, 224,  77]  // medium   #F4E04D
  return [100, 143, 255]                                  // low      #648FFF
}

// ─── Layout tables ───────────────────────────────────────────────────────────
// 32×32 canvas, axes ordered top→bottom (bar) / outer→inner (donut).

const BAR_LAYOUTS: Record<number, { top: number; barH: number; gap: number }> = {
  1: { top: 11, barH: 10, gap: 0 },
  2: { top: 4,  barH: 10, gap: 4 },
  3: { top: 3,  barH: 7,  gap: 3 },
  4: { top: 3,  barH: 5,  gap: 2 },
}

const DONUT_LAYOUTS: Record<number, Array<{ outer: number; inner: number }>> = {
  1: [{ outer: 14.5, inner: 7.5 }],
  2: [{ outer: 14.5, inner: 10.5 }, { outer: 9.5, inner: 5.5 }],
  3: [{ outer: 14.5, inner: 11.5 }, { outer: 10.5, inner: 7.5 }, { outer: 6.5, inner: 3.5 }],
  4: [{ outer: 14.5, inner: 12.0 }, { outer: 11.0, inner: 8.5 }, { outer: 7.5, inner: 5.0 }, { outer: 4.0, inner: 1.5 }],
}

// ─── Draw one bar row ─────────────────────────────────────────────────────────

function drawBar(
  c: PixelCanvas,
  util: number,
  thresholds: { medium: number; high: number },
  yStart: number,
  barH: number,
  errorMode: boolean,
  colorByUsage: boolean
): void {
  const M = 2
  const BW = 28  // 32 - 2*M

  const [r, g, b] = barColor(util, thresholds, errorMode, colorByUsage)
  // Bar shape adopts treatment "A": slate track (#4B5563) for the unused portion.
  const track: [number, number, number] = errorMode ? [80, 80, 80] : [75, 85, 99]

  c.fill(M, yStart, M + BW, yStart + barH, ...track)
  const w = Math.round(BW * util / 100)
  if (w > 0) c.fill(M, yStart, M + w, yStart + barH, r, g, b)
}

function drawBars(
  c: PixelCanvas,
  utilizations: number[],
  thresholds: { medium: number; high: number },
  errorMode: boolean,
  colorByUsage: boolean
): void {
  const layout = BAR_LAYOUTS[utilizations.length]
  if (!layout) return

  // Treatment "A": paint a 1px black frame + black inter-bar gaps first, then
  // draw each bar (slate track + colored fill) on top. This separates adjacent
  // bars and gives every meter a crisp black edge that survives any taskbar
  // background. Skipped in errorMode (the error badge owns that state).
  if (!errorMode) {
    const M = 2
    const BW = 28
    const n = utilizations.length
    const top0 = layout.top
    const lastBottom = layout.top + (n - 1) * (layout.barH + layout.gap) + layout.barH
    c.fill(M - 1, top0 - 1, M + BW + 1, lastBottom + 1, 0, 0, 0)
  }

  for (let i = 0; i < utilizations.length; i++) {
    const y = layout.top + i * (layout.barH + layout.gap)
    drawBar(c, utilizations[i], thresholds, y, layout.barH, errorMode, colorByUsage)
  }
}

function drawBarGrid(
  c: PixelCanvas,
  utilizations: number[],
  divisions: number
): void {
  const M = 2
  const BW = 28
  const layout = BAR_LAYOUTS[utilizations.length]
  if (!layout) return
  for (let i = 0; i < utilizations.length; i++) {
    const yStart = layout.top + i * (layout.barH + layout.gap)
    for (let d = 1; d < divisions; d++) {
      const x = M + Math.floor(BW * d / divisions)
      for (let y = yStart; y < yStart + layout.barH; y++) {
        c.blendPixel(x, y, 0, 0, 0, 160)
      }
    }
  }
}

// ─── Donut icon ───────────────────────────────────────────────────────────────

function drawDonut(
  c: PixelCanvas,
  utilizations: number[],
  thresholds: { medium: number; high: number },
  errorMode: boolean,
  colorByUsage: boolean
): void {
  const SIZE = 32, cx = 16, cy = 16
  const SS = 4  // 4×4 supersampling for anti-aliasing
  const R_OL = 15.5  // icon outer boundary

  const layout = DONUT_LAYOUTS[utilizations.length]
  if (!layout) return

  // Treatment "B": unused portion, inter-ring gap, and outer rim are all pure
  // black — the rings stay separated by their geometry (gaps) and the colored
  // arcs read clearly against the uniform black ground. (2026-05-31: 未使用トラックも
  // 黒に統一。旧仕様の near-black #1A1C21 に戻すなら TRACK を [26, 28, 33] に。)
  const TRACK: [number, number, number] = errorMode ? [80, 80, 80] : [0, 0, 0]
  const GAP:   [number, number, number] = errorMode ? [80, 80, 80] : [ 0,  0,  0]

  const ringColor = utilizations.map((u) => barColor(u, thresholds, errorMode, colorByUsage))
  const angles = utilizations.map((u) => (u / 100) * 2 * Math.PI)

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let rAcc = 0, gAcc = 0, bAcc = 0, count = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const spx = px + (sx + 0.5) / SS
          const spy = py + (sy + 0.5) / SS
          const dx = spx - cx
          const dy = spy - cy
          const d = Math.sqrt(dx * dx + dy * dy)

          if (d >= R_OL) continue  // outside icon → transparent

          let sr: number, sg: number, sb: number
          if (d >= R_OL - 1) {
            sr = 0; sg = 0; sb = 0  // black outline (14.5 ≤ d < 15.5)
          } else {
            let ringIdx = -1
            for (let i = 0; i < layout.length; i++) {
              if (d <= layout[i].outer && d >= layout[i].inner) { ringIdx = i; break }
            }

            if (ringIdx === -1) {
              ;[sr, sg, sb] = GAP  // inter-ring gap → black separator
            } else {
              let ang = Math.atan2(dx, -dy)
              if (ang < 0) ang += 2 * Math.PI
              ;[sr, sg, sb] = ang < angles[ringIdx] ? ringColor[ringIdx] : TRACK
            }
          }

          rAcc += sr; gAcc += sg; bAcc += sb; count++
        }
      }

      if (count > 0) {
        c.setPixel(px, py,
          Math.round(rAcc / count),
          Math.round(gAcc / count),
          Math.round(bAcc / count),
          Math.round(count / (SS * SS) * 255)
        )
      }
    }
  }
}

function drawDonutGrid(
  c: PixelCanvas,
  utilizations: number[],
  divisions: number
): void {
  const cx = 16, cy = 16
  const layout = DONUT_LAYOUTS[utilizations.length]
  if (!layout) return
  const rMax = layout[0].outer
  for (let d = 0; d < divisions; d++) {
    const theta = (2 * Math.PI * d) / divisions
    const dx = Math.sin(theta)
    const dy = -Math.cos(theta)
    let r = 0
    while (r <= rMax) {
      c.blendPixel(Math.round(cx + dx * r), Math.round(cy + dy * r), 0, 0, 0, 160)
      r += 0.5
    }
  }
}

// ─── Tray icon (32×32) ───────────────────────────────────────────────────────

function drawErrorBadge(c: PixelCanvas): void {
  // Red circle at bottom-right (center 25,25 radius 6)
  const bx = 25, by = 25, br = 6
  for (let py = by - br; py <= by + br; py++) {
    for (let px = bx - br; px <= bx + br; px++) {
      const d = Math.sqrt((px - bx) ** 2 + (py - by) ** 2)
      if (d <= br) c.setPixel(px, py, 220, 38, 38)  // #DC2626
    }
  }
  // White '!' bar: 2px wide, 4px tall at (24-25, 20-23)
  for (let py = 20; py <= 23; py++) {
    c.setPixel(24, py, 255, 255, 255)
    c.setPixel(25, py, 255, 255, 255)
  }
  // White '!' dot: 2px wide at (24-25, 25)
  c.setPixel(24, 25, 255, 255, 255)
  c.setPixel(25, 25, 255, 255, 255)
}

export function generateTrayIcon(
  utilizations: number[],
  thresholds: { medium: number; high: number },
  trayShape: 'bar' | 'donut' = 'bar',
  gridOpts: { enabled: boolean; divisions: number } = { enabled: false, divisions: 4 },
  errorMode: boolean = false,
  colorByUsage: boolean = true
): NativeImage {
  const utils = utilizations.length === 0 ? [0] : utilizations.slice(0, 4)
  const c = new PixelCanvas(32, 32)

  if (trayShape === 'donut') {
    drawDonut(c, utils, thresholds, errorMode, colorByUsage)
    if (gridOpts.enabled && !errorMode) drawDonutGrid(c, utils, gridOpts.divisions)
  } else {
    drawBars(c, utils, thresholds, errorMode, colorByUsage)
    if (gridOpts.enabled && !errorMode) drawBarGrid(c, utils, gridOpts.divisions)
  }

  if (errorMode) drawErrorBadge(c)

  return c.toNativeImage()
}
