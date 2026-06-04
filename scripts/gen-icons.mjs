// Generuje ikony aplikacji z dostarczonego pliku źródłowego do build/:
//   icon.png (1024), icon.ico (Windows), icon.icns (macOS).
// Źródło to wygenerowany kafel ikony na szarym tle — kadrujemy do wnętrza
// kafla (usuwając margines i znaczek), skalujemy i zaokrąglamy rogi do
// przezroczystości (czysty „squircle” dla macOS i przezroczyste rogi Win/Linux).
import sharp from 'sharp'
import png2icons from 'png2icons'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const buildDir = resolve(root, 'build')
mkdirSync(buildDir, { recursive: true })

const SRC = resolve(root, 'resources/icon-source.webp')
const CROP = { left: 234, top: 242, side: 716 } // dobrane do źródła 1172×1172
const SIZE = 1024
const RAD = Math.round(SIZE * 0.2)

const mask = await sharp(
  Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${RAD}" ry="${RAD}" fill="#fff"/></svg>`
  )
)
  .resize(SIZE, SIZE)
  .png()
  .toBuffer()

const png = await sharp(readFileSync(SRC))
  .extract({ left: CROP.left, top: CROP.top, width: CROP.side, height: CROP.side })
  .resize(SIZE, SIZE)
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer()

writeFileSync(resolve(buildDir, 'icon.png'), png)

const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false)
if (ico) writeFileSync(resolve(buildDir, 'icon.ico'), ico)

const icns = png2icons.createICNS(png, png2icons.BICUBIC, 0)
if (icns) writeFileSync(resolve(buildDir, 'icon.icns'), icns)

console.log('✓ Ikony z resources/icon-source.webp -> build/icon.{png,ico,icns}')
