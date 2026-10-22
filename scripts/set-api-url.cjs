const fs = require('node:fs')
const path = require('node:path')

const file = path.join(__dirname, '..', '.env.local')
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
const input = process.argv[2]

if (!input) {
  const current = source.match(/^EXPO_PUBLIC_API_URL=(.*)$/m)?.[1]?.trim()
  console.log('Current API URL: ' + (current || 'not configured'))
  console.log('Change it: npm run api:url -- https://your-website.com')
  process.exit(0)
}

let url
try {
  url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('Use the website origin only, such as https://your-website.com (without /api).')
  }
} catch (error) {
  console.error('Invalid API URL. ' + error.message)
  process.exit(1)
}

const lines = source.split(/\r?\n/)
const setting = 'EXPO_PUBLIC_API_URL=' + url.origin
let replaced = false
const result = lines.filter(line => {
  if (!/^EXPO_PUBLIC_API_URL=/.test(line)) return true
  if (replaced) return false
  replaced = true
  return true
}).map(line => /^EXPO_PUBLIC_API_URL=/.test(line) ? setting : line)
if (!replaced) result.push(setting)
fs.writeFileSync(file, result.join('\n').trimEnd() + '\n', 'utf8')
// EAS does not upload the ignored .env.local file. Keep build profiles in sync.
const root = path.dirname(file)
const easFile = path.join(root, 'eas.json')
const eas = JSON.parse(fs.readFileSync(easFile, 'utf8'))
for (const profile of Object.values(eas.build || {})) {
  profile.env = { ...profile.env, EXPO_PUBLIC_API_URL: url.origin }
}
fs.writeFileSync(easFile, JSON.stringify(eas, null, 2) + '\n')

// Keep both prebuilt and generated Android projects compatible with local HTTP.
const allowCleartext = url.protocol === 'http:'
const appFile = path.join(root, 'app.json')
const app = JSON.parse(fs.readFileSync(appFile, 'utf8'))
const pluginPath = './plugins/with-api-network.cjs'
const plugins = (app.expo.plugins || []).filter(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) !== pluginPath)
plugins.push([pluginPath, { allowCleartext }])
app.expo.plugins = plugins
fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n')
const manifestFile = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
if (fs.existsSync(manifestFile)) {
  let manifest = fs.readFileSync(manifestFile, 'utf8')
  manifest = manifest.replace(/<application\b[^>]*>/, tag => {
    const attribute = 'android:usesCleartextTraffic="' + allowCleartext + '"'
    return /android:usesCleartextTraffic="[^"]*"/.test(tag)
      ? tag.replace(/android:usesCleartextTraffic="[^"]*"/, attribute)
      : tag.replace(/>$/, ' ' + attribute + '>')
  })
  fs.writeFileSync(manifestFile, manifest, 'utf8')
}
console.log('API URL saved: ' + url.origin)
console.log('EAS build profiles and Android network settings updated.')
console.log('Development: restart Expo with npm start -- --clear.')
console.log('Deployed app: rebuild and distribute the app with the new URL.')
