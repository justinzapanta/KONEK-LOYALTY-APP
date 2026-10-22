const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function harness(handler) {
  const storage = new Map()
  const requests = []
  const modules = {}
  const environment = { env: { EXPO_PUBLIC_API_URL: 'https://konek.test/' } }
  function load(file) {
    if (modules[file]) return modules[file]
    const exports = {}
    modules[file] = exports
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(source, {
      exports, process: environment, Date, setTimeout, clearTimeout, AbortController,
      fetch: async (url, options) => {
        const request = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined }
        requests.push(request)
        const result = await handler(request)
        return { ok: result.status < 400, status: result.status, json: async () => result.json }
      },
      require(name) {
        if (name === 'expo-secure-store') return { setItemAsync: async (key, value) => storage.set(key, value), getItemAsync: async key => storage.get(key), deleteItemAsync: async key => storage.delete(key) }
        if (name === 'react-native') return { Platform: { OS: 'android' } }
        if (name === 'expo-crypto') return { randomUUID: () => 'test-reference' }
        if (name === './client') return load('src/services/api/client.ts')
        throw Error('Unexpected dependency: ' + name)
      },
    })
    return exports
  }
  return { load, storage, requests, environment }
}
const session = (access = 'access-1', expiry = Date.now() / 1000 + 3600) => ({ access_token: access, refresh_token: 'refresh-1', expires_at: expiry })
const ok = data => ({ status: 200, json: { data } })

test('purchase preview preserves decimal points and cent-based earning rates', () => {
  const {estimatePurchasePoints} = harness(() => {}).load('src/types/loyalty.ts')
  assert.equal(estimatePurchasePoints(140, 80), 1.75)
  assert.equal(estimatePurchasePoints(120, 80), 1.5)
  assert.equal(estimatePurchasePoints(20, 80), 0.25)
  assert.equal(estimatePurchasePoints(1, 80), 0.01)
  assert.equal(estimatePurchasePoints(2.41, 0.8), 3.01)
  assert.equal(estimatePurchasePoints(0.01, 2), 0.01)
  assert.equal(estimatePurchasePoints(1000000000, 80), 12500000)
  assert.equal(estimatePurchasePoints(140, 0), 0)
})

test('existing-account registration uses the authenticated business API without resubmitting profile data', async () => {
  const h = harness(async req => req.url.endsWith('/login') ? ok({session: session()}) : ok({exists: true, alreadyMember: false}))
  const client = h.load('src/services/api/client.ts')
  await client.auth.login('staff@example.com', 'password')
  client.setWorkspaceBusinessId('business-one')
  const {registration} = h.load('src/services/api/loyalty.ts')
  await registration({action:'lookup',phone:'639175555555'})
  await registration({action:'join',phone:'639175555555',reference:'request-one'})
  const request = h.requests.at(-1)
  assert.equal(request.url,'https://konek.test/api/loyalty/registration')
  assert.equal(request.headers.Authorization,'Bearer access-1')
  assert.equal(request.headers['X-Konek-Business-Id'],'business-one')
  assert.equal(request.body.pin,undefined)
  assert.equal(request.body.proof,undefined)
  assert.equal(request.body.first_name,undefined)
  assert.equal(request.body.email,undefined)
  assert.equal(h.storage.size,1)
  assert(![...h.storage.values()][0].includes('4821'))
})

test('login stores only tokens, authenticated requests use bearer, logout clears native storage', async () => {
  const h = harness(async req => req.url.endsWith('/login') ? ok({ session: session(), user: { email: 'private@example.com' } }) : ok({ success: true }))
  const { auth, api } = h.load('src/services/api/client.ts')
  await assert.rejects(api('/private'), /Sign in/)
  await auth.login(' STAFF@EXAMPLE.COM ', 'password-secret')
  assert.equal(h.requests[0].body.email, 'staff@example.com')
  const stored = [...h.storage.values()][0]
  assert(!stored.includes('password-secret'))
  assert(!stored.includes('private@example.com'))
  await api('/private')
  assert.equal(h.requests[1].headers.Authorization, 'Bearer access-1')
  await auth.logout()
  assert.equal(h.storage.size, 0)
  assert.equal(h.requests[2].url, 'https://konek.test/api/auth/logout')
  await assert.rejects(api('/private'), /Sign in/)
})

test('concurrent expired-token requests share one refresh and retain the refreshed token', async () => {
  let refreshes = 0
  const h = harness(async req => {
    if (req.url.endsWith('/login')) return ok({ session: session('old', 1) })
    if (req.url.endsWith('/refresh')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 5)); return ok({ session: session('new') }) }
    return ok({ token: req.headers.Authorization })
  })
  const { auth, api } = h.load('src/services/api/client.ts')
  await auth.login('staff@example.com', 'password')
  const responses = await Promise.all([api('/one'), api('/two')])
  assert.equal(refreshes, 1)
  assert(responses.every(response => response.token === 'Bearer new'))
})

test('invalid refresh clears tokens and notifies the login gate', async () => {
  const h = harness(async req => req.url.endsWith('/login') ? ok({ session: session('old', 1) }) : ({ status: 401, json: { error: 'Expired refresh' } }))
  const { auth, api } = h.load('src/services/api/client.ts')
  let expired = 0
  auth.onExpired(() => expired++)
  await auth.login('staff@example.com', 'password')
  await assert.rejects(api('/private'), /Expired refresh/)
  assert.equal(expired, 1)
  assert.equal(h.storage.size, 0)
})

test('sign-out prevents an in-flight response from reaching a subsequent session', async () => {
  let release
  const h = harness(async req => {
    if (req.url.endsWith('/login')) return ok({ session: session() })
    if (req.url.endsWith('/slow')) return await new Promise(resolve => { release = () => resolve(ok({ private: true })) })
    return ok({})
  })
  const { auth, api } = h.load('src/services/api/client.ts')
  await auth.login('staff@example.com', 'password')
  const request = api('/slow')
  await auth.logout()
  release()
  await assert.rejects(request, /Session changed/)
})

test('workspace snapshot loads 201 customers and exact server totals in one request without downloading transactions', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ id: String(i), first_name: 'Customer', last_name: 'Test', total_points: 7.25, earned:10.25, redeemed:3, visits:1, created_at: '2026-10-11T00:00:00Z' }))
  const h = harness(async req => {
    if (req.url.endsWith('/login')) return ok({ session: session() })
    assert(req.url.includes('/api/loyalty/snapshot'))
    return ok({customers:rows,rewards:[{id:'reward',name:'Coffee',points_price:4,status:'active'}],amountPerPoint:80,businessId:'owned-business',businessName:'Owner Company',profile:{first_name:'Jane',last_name:'Reid'},user:{id:'user-one',name:'Staff',email:'staff@example.com'}})
  })
  const client=h.load('src/services/api/client.ts')
  await client.auth.login('staff@example.com', 'password')
  const service=h.load('src/services/api/loyalty.ts')
  const data = await service.loadWorkspace()
  assert.equal(data.customers.length,201);assert.equal(data.customers[0].availablePoints,7.25);assert.equal(data.customers[0].totalPoints,10.25)
  assert.equal(data.customers[0].timesEarned,1);assert.equal(data.amountPerPoint,80);assert.equal(data.accountName,'Jane Reid');assert.equal(data.staffInitials,'JR')
  assert.equal(h.requests.length,2)
  assert.equal(client.auth.cacheScope(),'https://konek.test:user-one')
  await service.loadWorkspace('customer/one')
  assert(h.requests.at(-1).url.endsWith('?customer_id=customer%2Fone'))
  assert.equal(h.requests.at(-1).headers['X-Konek-Business-Id'],'owned-business')
})

test('returning session restores locally while offline and refreshes only when requesting live data', async()=>{
  const h=harness(async()=>{throw Error('Offline')})
  h.storage.set('konek.mobile.session',JSON.stringify({...session('expired',1),user_id:'staff-id'}))
  const {auth,api}=h.load('src/services/api/client.ts')
  assert.equal(await auth.restore({deferRefresh:true}),true)
  assert.equal(h.requests.length,0)
  await assert.rejects(api('/private'),/Offline/)
  assert.equal(auth.cacheScope(),'https://konek.test:staff-id')
  assert(h.storage.has('konek.mobile.session'))
})

function nfcHarness(tag, autoDeliver = true) {
 const modules={};const listeners={};let enabled=true,supported=true;
 const appState={currentState:'active'};
 const metrics={registers:0,unregisters:0,cancels:0,settings:0,options:null};
 const manager={
  start:async()=>{},requestTechnology:async()=>{},getTag:async()=>tag,
  isSupported:async()=>supported,isEnabled:async()=>enabled,
  goToNfcSetting:async()=>{metrics.settings++;return true},
  cancelTechnologyRequest:async()=>{metrics.cancels++},
  setEventListener:(name,callback)=>{listeners[name]=callback},
  registerTagEvent:async(options)=>{metrics.registers++;metrics.options=options;if(autoDeliver&&tag)listeners.tag?.(tag)},
  unregisterTagEvent:async()=>{metrics.unregisters++},
 };
 const load=file=>{
  if(modules[file])return modules[file];
  const exports={};modules[file]=exports;
  const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,URL,require(name){
   if(name==='react-native')return {Platform:{OS:'android'},AppState:appState};
   if(name==='./cardKey')return load('src/services/nfc/cardKey.ts');
   if(name==='react-native-nfc-manager')return {__esModule:true,default:manager,NfcTech:{Ndef:'Ndef'},NfcEvents:{DiscoverTag:'tag',StateChanged:'state'},NfcAdapter:{FLAG_READER_NFC_A:1,FLAG_READER_NFC_B:2,FLAG_READER_NFC_F:4,FLAG_READER_NFC_V:8}};
   throw Error(name);
  }});
  return exports;
 };
 load.emit=next=>listeners.tag?.(next);load.metrics=metrics;load.appState=appState;
 load.setEnabled=next=>{enabled=next};load.setSupported=next=>{supported=next};
 load.emitState=state=>listeners.state?.({state});load.manager=manager;
 return load;
}
test('NFC extracts only a case-sensitive card_key from local and deployed customer URLs',()=>{
 const {extractCardKey}=nfcHarness(null)('src/services/nfc/cardKey.ts')
 const business='00000000-0000-4000-8000-000000000001'
 for(const origin of ['http://192.168.254.198:3000','https://mywebsite.example']){
  assert.equal(extractCardKey(origin+'/'+business+'/aBcD123?ref=scan#points'),'aBcD123')
  assert.equal(extractCardKey(origin+'/'+business+'/aBcD123/'),'aBcD123')
 }
 assert.equal(extractCardKey('aBcD123'),'aBcD123')
 for(const bad of ['https://example.com/key','https://example.com/not-uuid/key','https://example.com/'+business+'/a/b','https://example.com/'+business+'/a%2Fb','javascript:alert(1)','https://example.com/'+business+'/'])assert.throws(()=>extractCardKey(bad))
})
test('NDEF URI and text records use their card_key, never the hardware UID or full URL',async()=>{
 const business='00000000-0000-4000-8000-000000000001',url='192.168.254.198:3000/'+business+'/aBcD123'
 const payload=Array.from(url,c=>c.charCodeAt(0))
 const uri=await nfcHarness({id:'HARDWARE123',ndefMessage:[{tnf:1,type:[0x55],payload:[3,...payload]}]})('src/services/nfc/nfcService.ts').nfcService.readTag()
 assert.equal(uri.id,'aBcD123');assert.equal(uri.url,'http://'+url)
 const text=await nfcHarness({id:'HARDWARE123',ndefMessage:[{tnf:1,type:[0x54],payload:[2,101,110,...Array.from('https://'+url,c=>c.charCodeAt(0))]}]})('src/services/nfc/nfcService.ts').nfcService.readTag()
 assert.equal(text.id,'aBcD123')
 await assert.rejects(nfcHarness({id:'HARDWARE123',ndefMessage:[]})('src/services/nfc/nfcService.ts').nfcService.readTag(),/not registered with KONEK/)
})

test('random NFC payloads and empty non-NDEF tags use the unregistered KONEK wording',async()=>{
 const tags=[{id:'UIDONLY'}, {ndefMessage:[{tnf:2,type:[1],payload:[0,1,2]}]}, {ndefMessage:[{tnf:1,type:[0x54],payload:[2,101,110,...Array.from('random contact details',c=>c.charCodeAt(0))]}]}, {ndefMessage:[{tnf:1,type:[0x55],payload:[3,...Array.from('example.com',c=>c.charCodeAt(0))]}]}];
 for(const tag of tags){
  const load=nfcHarness(tag);const {UnregisteredNfcError}=load('src/services/nfc/cardKey.ts');
  await assert.rejects(load('src/services/nfc/nfcService.ts').nfcService.readTag(),error=>error.name==='UnregisteredNfcError'&&error.message.includes('Only registered KONEK NFC cards are allowed'));
 }
});
test('business binding clears between sessions and server NFC error codes reach the alert handler',async()=>{
 const h=harness(async req=>req.url.endsWith('/login')?ok({session:session()}):req.url.endsWith('/cards')?{status:400,json:{error:'Not registered',code:'NFC_NOT_REGISTERED'}}:ok({}));
 const client=h.load('src/services/api/client.ts');
 await client.auth.login('owner@example.com','password');client.setWorkspaceBusinessId('owned');
 await assert.rejects(client.api('/api/loyalty/cards',{action:'lookup',card_key:'Random123'}),error=>error.code==='NFC_NOT_REGISTERED');
 assert.equal(h.requests.at(-1).headers['X-Konek-Business-Id'],'owned');
 await client.auth.logout();await client.auth.login('next@example.com','password');await client.api('/private');
 assert.equal(h.requests.at(-1).headers['X-Konek-Business-Id'],undefined);
});

test('Android reader capture remains registered over cancellation, modal idle gaps and new scans',async()=>{
 const load=nfcHarness(null,false);const {nfcService}=load('src/services/nfc/nfcService.ts');
 const text=value=>({ndefMessage:[{tnf:1,type:[0x54],payload:[2,101,110,...Array.from(value,c=>c.charCodeAt(0))]}]});
 await nfcService.initializeForegroundCapture();
 assert.equal(load.metrics.registers,1);assert.equal(load.metrics.options.isReaderModeEnabled,true);assert.equal(load.metrics.options.readerModeFlags,15);
 let first=nfcService.readTag();const cancelled=assert.rejects(first,/cancelled/);await nfcService.stop();await cancelled;
 assert.equal(load.metrics.unregisters,0);assert.equal(load.metrics.cancels,0);
 load.emit(text('CardTappedDuringModal')); // ignored, never queued for another customer
 const second=nfcService.readTag();let settled=false;second.then(()=>{settled=true});await Promise.resolve();assert.equal(settled,false);
 load.emit(text('NewCard123'));assert.equal((await second).id,'NewCard123');
 assert.equal(load.metrics.registers,1);assert.equal(load.metrics.unregisters,0);
 await nfcService.stop();assert.equal(load.metrics.unregisters,0);
 await nfcService.dispose();assert.equal(load.metrics.unregisters,1);
});
test('background NFC events cannot process a customer; an active app can resume the pending scan',async()=>{
 const load=nfcHarness(null,false);const {nfcService}=load('src/services/nfc/nfcService.ts');await nfcService.initializeForegroundCapture();
 const tag={ndefMessage:[{tnf:1,type:[0x54],payload:[2,101,110,...Array.from('Card123',c=>c.charCodeAt(0))]}]};
 const read=nfcService.readTag();let settled=false;read.then(()=>{settled=true});
 load.appState.currentState='background';load.emit(tag);await Promise.resolve();assert.equal(settled,false);
 load.appState.currentState='active';load.emit(tag);assert.equal((await read).id,'Card123');await nfcService.dispose();
});

test('disabled NFC opens settings without pretending to enable hardware; rechecking enables a scan',async()=>{
 const load=nfcHarness(null,false);load.setEnabled(false);
 const {nfcService,NfcAvailabilityError}=load('src/services/nfc/nfcService.ts');
 assert.equal(await nfcService.checkAvailability(),'disabled');
 await assert.rejects(nfcService.readTag(),error=>error instanceof NfcAvailabilityError&&error.availability==='disabled');
 assert.equal(load.metrics.registers,0);
 await nfcService.openSettings();assert.equal(load.metrics.settings,1);
 assert.equal(await nfcService.checkAvailability(),'disabled');
 load.setEnabled(true);assert.equal(await nfcService.checkAvailability(),'enabled');
 await nfcService.initializeForegroundCapture();const read=nfcService.readTag();
 load.emit({ndefMessage:[{tnf:1,type:[0x54],payload:[2,101,110,...Array.from('Card123',c=>c.charCodeAt(0))]}]});
 assert.equal((await read).id,'Card123');await nfcService.dispose();
});

test('turning NFC off interrupts a pending read immediately and preserves Android capture on return',async()=>{
 const load=nfcHarness(null,false);const {nfcService}=load('src/services/nfc/nfcService.ts');
 const statuses=[];const unsubscribe=nfcService.watchAvailability(status=>statuses.push(status));
 await nfcService.initializeForegroundCapture();const read=nfcService.readTag();
 const rejected=assert.rejects(read,error=>error.availability==='disabled');
 load.setEnabled(false);load.emitState('turning_off');load.emitState('off');await rejected;
 assert.equal(statuses.at(-1),'disabled');assert.equal(load.metrics.unregisters,0);
 load.setEnabled(true);load.emitState('on');await nfcService.checkAvailability();
 const resumed=nfcService.readTag();
 load.emit({ndefMessage:[{tnf:1,type:[0x54],payload:[2,101,110,...Array.from('NewCard456',c=>c.charCodeAt(0))]}]});
 assert.equal((await resumed).id,'NewCard456');assert.equal(load.metrics.registers,1);
 unsubscribe();await nfcService.dispose();
});

test('unsupported hardware is distinct from an unregistered KONEK card',async()=>{
 const load=nfcHarness(null,false);load.setSupported(false);
 const {nfcService,NfcAvailabilityError}=load('src/services/nfc/nfcService.ts');
 await assert.rejects(nfcService.readTag(),error=>error instanceof NfcAvailabilityError&&error.availability==='unsupported'&&error.message.includes('phone number'));
 assert.equal(load.metrics.registers,0);assert.equal(load.metrics.settings,0);
});

test('a stale enabled check cannot override the native NFC-off event',async()=>{
 const load=nfcHarness(null,false);const {nfcService}=load('src/services/nfc/nfcService.ts');
 const unsubscribe=nfcService.watchAvailability(()=>{});await nfcService.checkAvailability();
 let resolveCheck;load.manager.isEnabled=()=>new Promise(resolve=>{resolveCheck=resolve});
 const checking=nfcService.checkAvailability();
 while(!resolveCheck)await Promise.resolve();
 load.emitState('off');resolveCheck(true);
 assert.equal(await checking,'disabled');unsubscribe();
});

test('branch requests send the selected branch and discard a late response after a branch switch',async()=>{
 let finish;const h=harness(async req=>req.url.endsWith('/login')?ok({session:session()}):new Promise(resolve=>{finish=()=>resolve(ok({balance:99}))}));
 const client=h.load('src/services/api/client.ts');await client.auth.login('owner@example.com','password');client.setWorkspaceBusinessId('business','owner');client.setWorkspaceBranchId('main');
 const request=client.api('/slow');assert.equal(h.requests.at(-1).headers['X-Konek-Branch-Id'],'main');client.setWorkspaceBranchId('uptown');finish();await assert.rejects(request,/branch changed/);
 assert(client.getWorkspaceStorageScope().endsWith(':uptown'))
})
test('owner selects a working branch before applying a startup snapshot',async()=>{
 const h=harness(async req=>{
  if(req.url.endsWith('/login'))return ok({session:session()});const selected=req.headers['X-Konek-Branch-Id']||null;
  return ok({customers:selected?[{id:'main-customer',first_name:'Jane',total_points:3,created_at:new Date().toISOString()}]:[],rewards:[],amountPerPoint:80,businessId:'business',businessName:'Coffee shop',profile:{first_name:'Owner'},user:{id:'owner'},branchAccess:{can_select:true,role:'Owner',branch_id:selected,legacy_branch_id:'main',branch_name:selected?'Main branch':null,branches:[{id:'main',name:'Main branch',status:'active'},{id:'uptown',name:'Uptown',status:'active'}]}})
 });const client=h.load('src/services/api/client.ts');await client.auth.login('owner@example.com','password');const workspace=await h.load('src/services/api/loyalty.ts').loadWorkspace();
 assert.equal(workspace.branchAccess.branch_id,'main');assert.equal(workspace.customers[0].id,'main-customer');assert.equal(h.requests.length,3);assert(client.getLegacyWorkspaceStorageScope().endsWith(':owner'))
})
