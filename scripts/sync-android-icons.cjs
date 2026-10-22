const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const root = path.resolve(__dirname, '..')
const res = path.join(root, 'android', 'app', 'src', 'main', 'res')

async function main() {
  if (!fs.existsSync(res)) throw new Error('Generate the Android project before syncing native launcher icons.')
  const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8')
  const round = svg.replace(/(<svg\b[^>]*>)/, '$1<defs><clipPath id="launcher-round"><circle cx="512" cy="512" r="512"/></clipPath></defs><g clip-path="url(#launcher-round)">').replace('</svg>', '</g></svg>')
  const foreground = path.join(root, 'assets', 'adaptive-icon.png')
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const mipmap = path.join(res, 'mipmap-' + density)
    const drawable = path.join(res, 'drawable-' + density)
    fs.mkdirSync(mipmap, { recursive: true })
    fs.mkdirSync(drawable, { recursive: true })
    await sharp(Buffer.from(svg)).resize(48 * scale, 48 * scale).webp({ lossless: true }).toFile(path.join(mipmap, 'ic_launcher.webp'))
    await sharp(Buffer.from(round)).resize(48 * scale, 48 * scale).webp({ lossless: true }).toFile(path.join(mipmap, 'ic_launcher_round.webp'))
    await sharp(foreground).resize(108 * scale, 108 * scale).png().toFile(path.join(drawable, 'ic_launcher_foreground.png'))
  }
  const xml = '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@drawable/ic_launcher_background"/>\n  <foreground android:drawable="@drawable/ic_launcher_foreground"/>\n</adaptive-icon>\n'
  const adaptive = path.join(res, 'mipmap-anydpi-v26')
  fs.mkdirSync(adaptive, { recursive: true })
  fs.writeFileSync(path.join(adaptive, 'ic_launcher.xml'), xml)
  fs.writeFileSync(path.join(adaptive, 'ic_launcher_round.xml'), xml)
  fs.writeFileSync(path.join(res, 'drawable', 'ic_launcher_background.xml'), '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n  <solid android:color="#081711"/>\n</shape>\n')
  const strings = path.join(res, 'values', 'strings.xml')
  fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace(/(<string name="app_name">)[^<]*(<\/string>)/, '$1KONEK$2'))
  console.log('KONEK launcher icons and Android app label synced in all five densities.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
