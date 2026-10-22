const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { hardenManifest, hardenReleaseSigning, blockedPermissions } = require('../plugins/with-release-security.cjs')

test('release manifest removes storage and overlay requests while retaining NFC and network access', () => {
  const input = { 'uses-permission': [...blockedPermissions, 'android.permission.NFC', 'android.permission.INTERNET'].map(name => ({ $: { 'android:name': name } })), application: [{ $: { 'android:allowBackup': 'true' } }] }
  const result = hardenManifest(input)
  assert.equal(result.application[0].$['android:allowBackup'], 'false')
  for (const name of blockedPermissions) assert.equal(result['uses-permission'].find(item => item.$['android:name'] === name).$['tools:node'], 'remove')
  assert.equal(result['uses-permission'].find(item => item.$['android:name'] === 'android.permission.NFC').$['tools:node'], undefined)
  assert.deepEqual(hardenManifest(structuredClone(result)), result)
})

test('release signing uses a dedicated key, leaves debug builds alone, and survives prebuild regeneration', () => {
  const input = "android {\n signingConfigs {\n debug { keyAlias 'androiddebugkey' }\n }\n buildTypes {\n debug { signingConfig signingConfigs.debug }\n release { signingConfig signingConfigs.debug\n minifyEnabled false }\n }\n}"
  const result = hardenReleaseSigning(input)
  assert.match(result, /debug \{ signingConfig signingConfigs.debug/)
  assert.match(result, /release \{\s*debuggable false\s*signingConfig signingConfigs.release/)
  assert.ok(result.includes('KONEK_RELEASE_STORE_FILE'))
  assert.equal(hardenReleaseSigning(result), result)
  assert.throws(() => hardenReleaseSigning('unsupported source'))
})

test('public production APK is configured for HTTPS, release credentials and no development client', () => {
  const eas = JSON.parse(fs.readFileSync('eas.json', 'utf8'))
  assert.equal(eas.build.production.developmentClient, false)
  assert.equal(eas.build.production.credentialsSource, 'remote')
  assert.equal(eas.build.production.android.buildType, 'apk')
  assert.equal(eas.build.production.env.EXPO_PUBLIC_API_URL, 'https://konekdigital.vercel.app')
  const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo
  assert.equal(app.android.allowBackup, false)
  assert.ok(app.plugins.includes('./plugins/with-release-security.cjs'))
  for (const name of blockedPermissions) assert.ok(app.android.blockedPermissions.includes(name))
})
