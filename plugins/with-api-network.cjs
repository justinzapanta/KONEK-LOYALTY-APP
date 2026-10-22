const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withApiNetwork(config, { allowCleartext = false } = {}) {
  return withAndroidManifest(config, result => {
    const application = result.modResults.manifest.application?.[0]
    if (!application) throw new Error('Android application manifest is missing.')
    application.$ = application.$ || {}
    application.$['android:usesCleartextTraffic'] = String(allowCleartext)
    return result
  })
}
