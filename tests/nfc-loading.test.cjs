const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

// Exercise the actual app callbacks with delayed API responses, without NFC hardware.
function harness(lookup, reload = async () => ({ customers: [{ id: 'customer-1' }] })) {
  const source = fs.readFileSync('App.tsx', 'utf8')
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const callbacks = new Map()
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['perform', 'handleNfcTag', 'lookupPhoneForPoints', 'confirmCardLink'].includes(node.name.text)) callbacks.set(node.name.text, node.initializer.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const events = [], busy = { current: false }, sessionVersion = { current: 1 }
  const state = { status: '', cardCalls: 0 }
  class ApiError extends Error { constructor(code) { super('Card rejected'); this.code = code } }
  const scope = {
    useCallback: callback => callback, busy, sessionVersion, ApiError, Error,
    UNREGISTERED_NFC_MESSAGE: 'Only registered KONEK cards are allowed.',
    setRequestStatus: value => { state.status = value; events.push(['status', value]) },
    cancelNfc: () => events.push(['cancel']),
    card: (...args) => { state.cardCalls++; return lookup(...args) }, reload, loadWorkspace: reload, applyConfirmedCustomer: customer => customer, lookupMember: async phone=>{if(phone!=='639170000001')throw Error('No loyal customer uses this phone number.');return{id:'customer-1',phone}},
    reloadAfterSave: async () => true,
    selectedCustomer: { id: 'customer-1' }, cardId: 'Card1',
    customers: [{ id: 'customer-1', phone: '639170000001' }],
    normalizePhone: value => value.replace(/\D/g, '').replace(/^09/, '639'),
    pointsIdentity: { current: {} }, rewardIdentity: { current: {} },
    showAppAlert: (...args) => events.push(['alert', ...args]),
    setCardId: value => events.push(['card', value]),
    setSelectedCustomer: value => events.push(['selected', value]),
    setCustomerDetailStage: value => events.push(['details', value]),
    setRegistrationSource: value => events.push(['registration', value]),
    setPointsCustomer: value => events.push(['pointsCustomer', value]),
    setCustomerFlowStage: value => events.push(['flow', value]),
    setRedeemCustomer: value => events.push(['redeemCustomer', value]),
    setRedemptionStage: value => events.push(['redemption', value]),
  }
  const code = `const perform = ${callbacks.get('perform')}; const handleNfcTag = ${callbacks.get('handleNfcTag')}; globalThis.scan = handleNfcTag; globalThis.findPhone = ${callbacks.get('lookupPhoneForPoints')}; globalThis.confirm = ${callbacks.get('confirmCardLink')};`
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope)
  return { ...scope, state, events, busy, sessionVersion }
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('registered phone opens the points form without a PIN and unknown phones remain rejected', async () => {
  const app = harness(async () => ({}))
  app.pointsIdentity.current = { pin: '1234' }
  app.findPhone('09170000001');await tick()
  assert.ok(app.events.some(event => event[0] === 'flow' && event[1] === 'points'))
  assert.ok(!app.events.some(event => event[0] === 'flow' && event[1] === 'pin'))
  assert.equal(Object.keys(app.pointsIdentity.current).length, 0)
  app.findPhone('09170000002');await tick()
  assert.ok(app.events.some(event => event[0] === 'alert' && /No loyal customer/.test(event[2])))
})

test('registration lookup alerts for current members but offers phone-only enrollment for another business', async () => {
  const source = fs.readFileSync('App.tsx', 'utf8')
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RegisterView')
  let initializer
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'lookup') initializer = node.initializer.getText(tree); ts.forEachChild(node, visit) }
  visit(fn)
  for (const result of [{ exists: true, alreadyMember: true }, { exists: true, alreadyMember: false }, { exists: false, alreadyMember: false }]) {
    const events = [], scope = { phone: '09170000001', normalizePhone: () => '639170000001', alive: { current: true }, run: work => work(), registration: async () => result, setAlreadyMember: value => events.push(['member', value]), setStep: value => events.push(['step', value]), onAlert: (...args) => events.push(['alert', ...args]) }
    vm.runInNewContext(ts.transpileModule(`globalThis.lookup = ${initializer}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope)
    scope.lookup(); await tick()
    assert.ok(events.some(event => event[0] === 'step' && event[1] === (result.alreadyMember ? 'phone' : result.exists ? 'existing' : 'new')))
    assert.equal(events.some(event => event[0] === 'alert' && event[1] === 'Already registered'), result.alreadyMember)
  }
})

test('NFC loading starts immediately, persists through lookup and workspace refresh, and prevents duplicate work', async () => {
  const lookup = deferred(), refresh = deferred()
  const app = harness(() => lookup.promise, () => refresh.promise)
  app.scan('identify', { id: 'Card1' })
  assert.equal(app.state.status, 'Checking NFC card…')
  app.scan('identify', { id: 'Card1' })
  assert.equal(app.state.cardCalls, 1)
  lookup.resolve({ linked: true, customer: { id: 'customer-1' } })
  await tick()
  assert.equal(app.state.status, 'Checking NFC card…')
  assert.ok(!app.events.some(event => event[0] === 'flow'))
  refresh.resolve({ customers: [{ id: 'customer-1' }] })
  await tick()
  assert.ok(app.events.some(event => event[0] === 'flow' && event[1] === 'points'))
  assert.equal(app.state.status, '')
  assert.equal(app.busy.current, false)
})

test('unregistered-card errors dismiss loading and preserve the KONEK alert', async () => {
  const lookup = deferred(), app = harness(() => lookup.promise)
  app.scan('identify', { id: 'Unknown1' })
  lookup.reject(new app.ApiError('NFC_NOT_REGISTERED'))
  await tick()
  assert.equal(app.state.status, '')
  assert.ok(app.events.some(event => event[0] === 'alert' && event[1] === 'NFC card not registered'))
  assert.ok(!app.events.some(event => event[0] === 'flow'))
})

test('an unlinked business card opens registration; scanning for replacement only checks the card before asking for PIN', async () => {
  const app = harness(async () => ({ linked: false }))
  app.scan('identify', { id: 'Unlinked1' })
  await tick()
  assert.ok(app.events.some(event => event[0] === 'registration' && event[1] === 'nfc'))
  assert.equal(app.state.status, '')
  const linked = deferred(), calls = [], link = harness((...args) => { calls.push(args); return linked.promise })
  link.scan('link', { id: 'Card1' })
  assert.equal(link.state.status, 'Checking NFC card…')
  linked.resolve({ card_id: 'card-1' })
  await tick()
  assert.equal(link.state.status, '')
  assert.ok(link.events.some(event => event[0] === 'details' && event[1] === 'cardPin'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'lookup')
  assert.ok(!link.events.some(event => event[0] === 'alert' || event[0] === 'selected'))
})

test('PIN-confirmed card changes wait for the backend and failed verification leaves the existing card unchanged', async () => {
  const result = deferred(), calls = [], app = harness((...args) => {calls.push(args);return result.promise})
  await app.confirm('12')
  assert.equal(calls.length, 0)
  const saving = app.confirm('4821')
  assert.equal(app.state.status, 'Linking NFC card…')
  assert.deepEqual(Array.from(calls[0]), ['link', 'Card1', 'customer-1', '4821'])
  await app.confirm('4821')
  assert.equal(calls.length, 1)
  assert.ok(!app.events.some(event => event[0] === 'selected' || event[0] === 'details'))
  result.resolve({card_id: 'replacement'})
  await saving
  assert.ok(app.events.some(event => event[0] === 'selected' && event[1].nfcCardId === 'replacement'))
  assert.ok(app.events.some(event => event[0] === 'details' && event[1] === 'details'))
  const failed = harness(async () => {throw Error('Incorrect PIN.')})
  await failed.confirm('1111')
  assert.ok(failed.events.some(event => event[0] === 'alert' && /Incorrect PIN/.test(event[2])))
  assert.ok(!failed.events.some(event => event[0] === 'selected' || event[0] === 'details'))
})

test('a scan finishing after session expiry cannot open a customer modal', async () => {
  const lookup = deferred(), app = harness(() => lookup.promise)
  app.scan('identify', { id: 'Card1' })
  app.sessionVersion.current++
  lookup.resolve({ linked: true, customer: { id: 'customer-1' } })
  await tick()
  assert.equal(app.state.status, '')
  assert.ok(!app.events.some(event => ['flow', 'registration', 'pointsCustomer'].includes(event[0])))
})


test('existing-account enrollment submits only a phone number without a customer PIN prompt', async () => {
  const source = fs.readFileSync('App.tsx', 'utf8')
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RegisterView')
  let initializer
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'save') initializer = node.initializer.getText(tree); ts.forEachChild(node, visit) }
  visit(fn)
  const saves = [], alerts = []
  const scope = { step: 'existing', source: 'phone', pin: '', setPin: value => {scope.pin=value}, phone: '09170000001', run: work => work(), onSave: async data => saves.push(data), onAlert: (...args) => alerts.push(args) }
  vm.runInNewContext(ts.transpileModule(`globalThis.save = ${initializer}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope)
  scope.save(); await tick()
  assert.equal(saves.length, 1)
  assert.equal(saves[0].kind, 'existing')
  assert.equal(saves[0].phone, '09170000001')
  assert.equal(saves[0].pin, undefined)
  assert.equal(saves[0].proof, undefined)
  assert.equal(alerts.length, 0)
  scope.source = 'nfc'
  scope.save(); await tick()
  assert.equal(saves.length, 1)
  assert.equal(alerts.length, 1)
  scope.pin = '4821'
  scope.save(); await tick()
  assert.equal(saves.length, 2)
  assert.equal(saves[1].pin, '4821')
  assert.equal(scope.pin, '')
})

test('completed challenges leave the actionable list while pending challenges and their data remain intact', () => {
  const module = {exports:{}}
  const code = ts.transpileModule(fs.readFileSync('src/services/challenges.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
  vm.runInNewContext(code, {exports:module.exports})
  const entries = [{id:'earned-points',completed:true},{id:'issued-voucher',completed:true},{id:'still-working',completed:false,progress:2}]
  const pending = module.exports.pendingChallenges(entries)
  assert.equal(pending.length, 1)
  assert.equal(pending[0], entries[2])
  assert.equal(entries.length, 3)
  assert.equal(module.exports.pendingChallenges().length, 0)
})
