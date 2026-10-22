const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
function setup({ available = true, launch } = {}) {
  let listener, removed = 0, launches = 0
  const exports = {}
  const CameraView = {
    isModernBarcodeScannerAvailable: available,
    onModernBarcodeScanned: callback => { listener = callback; return { remove: () => { removed++; listener = null } } },
    launchScanner: async options => { launches++; assert.deepEqual(Array.from(options.barcodeTypes), ['qr', 'code128', 'code39']); if (launch) await launch(data => listener({ data })) },
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/nativeRewardScanner.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: () => ({ CameraView }), Error })
  return { scan: exports.scanRewardCode, removed: () => removed, launches: () => launches }
}
test('native scanner returns only the first result and removes its event subscription', async () => {
  const app = setup({ launch: async emit => { emit('KNK-FIRST'); emit('KNK-SECOND') } })
  assert.equal(await app.scan(), 'KNK-FIRST'); assert.equal(app.removed(), 1)
  assert.equal(await app.scan(), 'KNK-FIRST'); assert.equal(app.removed(), 2)
})
test('native scanner cancellation is quiet and errors permit retry without stale listeners', async () => {
  let count = 0
  const app = setup({ launch: async () => { throw count++ ? new Error('service missing') : { code: 'ERR_BARCODE_SCANNING_CANCELLED' } } })
  assert.equal(await app.scan(), null)
  await assert.rejects(app.scan(), /Google Play services/)
  assert.equal(app.removed(), 2)
})
test('native scanner prevents overlapping launches and reports unsupported devices', async () => {
  let release
  const pending = new Promise(resolve => release = resolve)
  const app = setup({ launch: () => pending })
  const first = app.scan(); assert.equal(await app.scan(), null); assert.equal(app.launches(), 1)
  release(); await first; assert.equal(app.removed(), 1)
  await assert.rejects(setup({ available: false }).scan(), /unavailable/)
})
