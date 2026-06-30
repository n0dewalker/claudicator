import { describe, it, expect, vi } from 'vitest'
import { inflateSync } from 'zlib'

// Mock electron before importing IconGenerator
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (buf: Buffer) => buf,
  },
}))

import { generateTrayIcon } from '../IconGenerator'

const THRESHOLDS = { medium: 50, high: 75 }

/** Decode our custom PNG (filter-type 0 only) → RGBA Buffer */
function decodePNG(buf: Buffer): { width: number; height: number; rgba: Buffer } {
  let pos = 8  // skip PNG signature
  let width = 0, height = 0
  const idatChunks: Buffer[] = []

  while (pos < buf.length) {
    const dataLen = buf.readUInt32BE(pos); pos += 4
    const chunkType = buf.subarray(pos, pos + 4).toString('ascii'); pos += 4
    const chunkData = buf.subarray(pos, pos + dataLen); pos += dataLen + 4  // +4 CRC
    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0)
      height = chunkData.readUInt32BE(4)
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData)
    } else if (chunkType === 'IEND') {
      break
    }
  }

  const raw = inflateSync(Buffer.concat(idatChunks))
  const stride = width * 4
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcBase = y * (1 + stride) + 1  // skip filter byte (0 = None)
    raw.copy(rgba, y * stride, srcBase, srcBase + stride)
  }
  return { width, height, rgba }
}

function getPixel(rgba: Buffer, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}

function isRed(pixel: [number, number, number, number]): boolean {
  const [r, g, b, a] = pixel
  return r >= 200 && g <= 60 && b <= 60 && a > 0
}

function isGray(pixel: [number, number, number, number]): boolean {
  const [r, g, b, a] = pixel
  if (a === 0) return false
  return Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && Math.abs(r - b) < 20
}

describe('generateTrayIcon – bar shape', () => {
  it('error mode: badge area (around 25,25) contains red pixels', () => {
    const img = generateTrayIcon([50, 30], THRESHOLDS, 'bar', { enabled: false, divisions: 4 }, true) as unknown as Buffer
    const { rgba, width } = decodePNG(img)

    // Sample the badge circle center area (22–28 x 22–28)
    const redFound = [22, 23, 24, 25, 26, 27, 28].some((x) =>
      [22, 23, 24, 25, 26, 27, 28].some((y) => isRed(getPixel(rgba, width, x, y)))
    )
    expect(redFound).toBe(true)
  })

  it('error mode: bar area is gray (not blue/yellow/red)', () => {
    const img = generateTrayIcon([50, 30], THRESHOLDS, 'bar', { enabled: false, divisions: 4 }, true) as unknown as Buffer
    const { rgba, width } = decodePNG(img)

    // Sample the filled portion of the first bar (y=4..13, x=5..15)
    const anyNonGray = [5, 8, 11, 14].some((x) =>
      [5, 7, 9, 11].some((y) => {
        const p = getPixel(rgba, width, x, y)
        return p[3] > 0 && !isGray(p)  // visible pixel that is not gray
      })
    )
    expect(anyNonGray).toBe(false)
  })

  it('normal mode: badge area has NO red pixels', () => {
    const img = generateTrayIcon([50, 30], THRESHOLDS, 'bar', { enabled: false, divisions: 4 }, false) as unknown as Buffer
    const { rgba, width } = decodePNG(img)

    const redFound = [22, 23, 24, 25, 26, 27, 28].some((x) =>
      [22, 23, 24, 25, 26, 27, 28].some((y) => isRed(getPixel(rgba, width, x, y)))
    )
    expect(redFound).toBe(false)
  })

  it('normal mode: bar area is NOT all gray (has color)', () => {
    // util=20 is below medium threshold (50) → blue color (#648FFF = R:100 G:143 B:255)
    const img = generateTrayIcon([20, 10], THRESHOLDS, 'bar', { enabled: false, divisions: 4 }, false) as unknown as Buffer
    const { rgba, width } = decodePNG(img)

    // Sample filled portion of first bar (y=4..13, x=3..8)
    const anyBlue = [3, 5, 7].some((x) =>
      [5, 7, 9].some((y) => {
        const [r, , b, a] = getPixel(rgba, width, x, y)
        return a > 0 && b > r  // blue: B > R
      })
    )
    expect(anyBlue).toBe(true)
  })
})

describe('generateTrayIcon – donut shape', () => {
  it('error mode: badge area contains red pixels', () => {
    const img = generateTrayIcon([60, 40], THRESHOLDS, 'donut', { enabled: false, divisions: 4 }, true) as unknown as Buffer
    const { rgba, width } = decodePNG(img)

    const redFound = [22, 24, 26].some((x) =>
      [22, 24, 26].some((y) => isRed(getPixel(rgba, width, x, y)))
    )
    expect(redFound).toBe(true)
  })

  it('normal mode: badge area has NO red pixels', () => {
    const img = generateTrayIcon([60, 40], THRESHOLDS, 'donut', { enabled: false, divisions: 4 }, false) as unknown as Buffer
    const { rgba, width } = decodePNG(img)

    const redFound = [22, 24, 26].some((x) =>
      [22, 24, 26].some((y) => isRed(getPixel(rgba, width, x, y)))
    )
    expect(redFound).toBe(false)
  })
})
