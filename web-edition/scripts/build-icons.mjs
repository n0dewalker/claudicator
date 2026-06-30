import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'assets', 'icon.svg')
const svg = await readFile(svgPath)

const png256 = await sharp(svg, { density: 384 }).resize(256, 256).png().toBuffer()
await writeFile(join(root, 'assets', 'icon.png'), png256)

const sizes = [16, 24, 32, 48, 64, 128, 256]
const buffers = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
)
const ico = await pngToIco(buffers)
await writeFile(join(root, 'assets', 'icon.ico'), ico)

console.log(`Generated assets/icon.png (256) and assets/icon.ico (${sizes.join(', ')})`)
