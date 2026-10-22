const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins')

const blockedPermissions = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.RECORD_AUDIO',
]

function hardenManifest(manifest) {
  manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' }
  const permissions = manifest['uses-permission'] || []
  manifest['uses-permission'] = permissions.filter(item => !blockedPermissions.includes(item.$?.['android:name']))
  for (const permission of blockedPermissions) {
    manifest['uses-permission'].push({ $: { 'android:name': permission, 'tools:node': 'remove' } })
  }
  const application = manifest.application?.[0]
  if (!application) throw new Error('Android application manifest is missing.')
  application.$ = { ...application.$, 'android:allowBackup': 'false' }
  return manifest
}

function hardenReleaseSigning(source) {
  // EAS injects the actual release signing credentials during a cloud build.
  // Local builds can supply these four variables without committing a keystore.
  if (!source.includes('KONEK_RELEASE_STORE_FILE')) {
    source = source.replace(/signingConfigs\s*\{/, `signingConfigs {
        release {
            def releaseStore = System.getenv('KONEK_RELEASE_STORE_FILE')
            if (releaseStore) {
                storeFile file(releaseStore)
                storePassword System.getenv('KONEK_RELEASE_STORE_PASSWORD')
                keyAlias System.getenv('KONEK_RELEASE_KEY_ALIAS')
                keyPassword System.getenv('KONEK_RELEASE_KEY_PASSWORD')
            }
        }`)
  }
  source = source.replace(/(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release')
  if (!/buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?signingConfig signingConfigs\.release/.test(source)) {
    throw new Error('Release signing configuration could not be secured. Configure a release signing key before distributing the app.')
  }
  source = source.replace(/(buildTypes\s*\{[\s\S]*?\brelease\s*\{)\s*(?:debuggable false\s*)?/, '$1\n            debuggable false\n            ')
  return source
}

module.exports = function withReleaseSecurity(config) {
  config = withAndroidManifest(config, result => {
    result.modResults.manifest = hardenManifest(result.modResults.manifest)
    return result
  })
  return withAppBuildGradle(config, result => {
    if (result.modResults.language !== 'groovy') throw new Error('KONEK release security expects a Groovy build.gradle.')
    result.modResults.contents = hardenReleaseSigning(result.modResults.contents)
    return result
  })
}
module.exports.hardenManifest = hardenManifest
module.exports.hardenReleaseSigning = hardenReleaseSigning
module.exports.blockedPermissions = blockedPermissions
