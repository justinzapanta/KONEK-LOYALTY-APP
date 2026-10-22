const { test } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const codeExports = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/api/claimCode.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:codeExports,Error})
const code = 'KNK-12345678-ABCDEF12', claim = { id:'claim-1', name:'Coffee', customerName:'Jane', quantity:1, pointsSpent:10, validUntil:'2027-01-01', status:'ready' }
test('native preview layout fix survives reinstall and relays child layout requests',()=>{
 const {patchPreviewLayout}=require('../scripts/fix-camera-preview.cjs')
 const source='before\n  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {\n    oldLayout()\n  }\n\n  override fun onViewAdded(child: View?) {\n    keepThis()\n  }'
 for(const original of [source,source.replace(/\n/g,'\r\n')]){
  const patched=patchPreviewLayout(original)
  assert.equal(patchPreviewLayout(patched),patched)
  assert.match(patched,/override fun requestLayout\(\)/)
  assert.match(patched,/MeasureSpec.makeMeasureSpec\(width, MeasureSpec.EXACTLY\)/)
  assert.match(patched,/layoutPreview\(width, height\)\r?\n    if \(width != lastWidth/)
  assert.match(patched,/keepThis\(\)/)
  assert.doesNotMatch(patched,/oldLayout\(\)/)
 }
 assert.throws(()=>patchPreviewLayout('changed upstream'),/layout source changed/)
})
test('Android camera compatibility patch is persistent, idempotent and refuses unexpected source',()=>{
 const {patchCameraSource}=require('../scripts/fix-camera-preview.cjs')
 const source='private var previewView = PreviewView(context).apply {\r\n    elevation = 0f\r\n  }'
 const fixed=patchCameraSource(source);assert.match(fixed,/implementationMode = PreviewView\.ImplementationMode\.COMPATIBLE/);assert.equal(patchCameraSource(fixed),fixed);assert.match(fixed,/elevation = 0f/);assert.throws(()=>patchCameraSource('unknown SDK layout'),/source changed/)
 const config=JSON.parse(fs.readFileSync('package.json','utf8'));assert.equal(config.dependencies['expo-camera'],'57.0.6');assert.ok(config.expo.autolinking.android.buildFromSource.includes('expo-camera'));assert.equal(config.scripts.postinstall,'node scripts/fix-camera-preview.cjs')
 const native=fs.readFileSync('node_modules/expo-camera/android/src/main/java/expo/modules/camera/ExpoCameraView.kt','utf8');assert.match(native,/implementationMode = PreviewView\.ImplementationMode\.COMPATIBLE/)
})

test('NFC prompts stay suppressed during the QR modal and pending alerts cannot stack',async()=>{
 const source=fs.readFileSync('src/state/nfc/NfcStateMachine.tsx','utf8'),tree=ts.createSourceFile('nfc.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),callbacks={};
 function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&['promptForNfc','setPromptsSuppressed','isPromptOpen'].includes(node.name.text))callbacks[node.name.text]=node.initializer.getText(tree);ts.forEachChild(node,visit)}visit(tree)
 const alerts=[];let checks=0;const scope={useCallback:callback=>callback,promptsSuppressed:{current:true},promptVisible:{current:false},offPromptShown:{current:false},AppState:{currentState:'active'},Alert:{alert:(...args)=>alerts.push(args)},nfcService:{checkAvailability:async()=>{checks++},openSettings:async()=>{}}};vm.createContext(scope);
 vm.runInContext(ts.transpile(`globalThis.prompt=${callbacks.promptForNfc};globalThis.suppress=${callbacks.setPromptsSuppressed};globalThis.isOpen=${callbacks.isPromptOpen}`,{target:ts.ScriptTarget.ES2022}),scope)
 scope.prompt(true);assert.equal(alerts.length,0);assert.equal(scope.offPromptShown.current,false)
 scope.suppress(false);assert.equal(checks,1);scope.prompt();assert.equal(alerts.length,1);assert.equal(scope.isOpen(),true);scope.prompt(true);assert.equal(alerts.length,1)
 alerts[0][2][0].onPress();assert.equal(scope.isOpen(),false);scope.suppress(true);scope.prompt(true);assert.equal(alerts.length,1);scope.suppress(false);assert.equal(checks,2)
})
function deferred() { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject} }
function harness(preview = async () => claim, fulfill = async () => ({already_used:false})) {
 const source=fs.readFileSync('src/components/RewardClaimScanner.tsx','utf8'),tree=ts.createSourceFile('scanner.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions={};
 function visit(node){if(ts.isFunctionDeclaration(node)&&['lookup','confirm'].includes(node.name?.text))functions[node.name.text]=node.getText(tree);ts.forEachChild(node,visit)}visit(tree)
 const events=[],state={pending:'',error:'',scanning:true,previewCalls:0,fulfillCalls:0};
 const scope={lock:{current:false},alive:{current:true},completed:{current:false},Keyboard:{dismiss(){}},parseClaimCode:codeExports.parseClaimCode,Error,
  code:'',claim:null,setCode:value=>scope.code=value,setClaim:value=>scope.claim=value,setScanning:value=>state.scanning=value,setError:value=>state.error=value,setPending:value=>state.pending=value,
  previewRewardClaim:value=>{state.previewCalls++;return preview(value)},fulfillRewardClaim:value=>{state.fulfillCalls++;return fulfill(value)},onComplete:(...args)=>events.push(args)};
 vm.createContext(scope);vm.runInContext(ts.transpile(functions.lookup+'\n'+functions.confirm,{target:ts.ScriptTarget.ES2022}),scope);return {...scope,scope,state,events}
}
test('only KONEK claim QR formats are accepted; card links and random codes are rejected',()=>{
 assert.equal(codeExports.parseClaimCode(' '+code.toLowerCase()+' '),code)
 assert.equal(codeExports.parseClaimCode('KNK-'+'A'.repeat(32)),'KNK-'+'A'.repeat(32))
 for(const value of ['https://konekdigital.vercel.app/business/card','random','KNK-1234','KNK-'+'G'.repeat(32)])assert.throws(()=>codeExports.parseClaimCode(value),/not a KONEK/)
})
test('scan previews a saved claim and requires confirmation; repeat scans and clicks are blocked',async()=>{
 const checking=deferred(),collecting=deferred(),app=harness(()=>checking.promise,()=>collecting.promise)
 const scan=app.lookup(code);await app.lookup(code);assert.equal(app.state.previewCalls,1);assert.equal(app.state.fulfillCalls,0);assert.equal(app.state.pending,'Checking reward…');assert.equal(app.state.scanning,false)
 checking.resolve(claim);await scan;assert.equal(app.scope.claim.name,'Coffee');assert.equal(app.state.pending,'');assert.equal(app.events.length,0)
 const confirmation=app.confirm();await app.confirm();assert.equal(app.state.fulfillCalls,1);assert.equal(app.state.pending,'Confirming collection…');collecting.resolve({already_used:false});await confirmation;assert.equal(app.events.length,1);assert.equal(app.events[0][0],false)
 // Even if the modal has not unmounted yet, completed sessions cannot scan or collect again.
 await app.lookup(code);await app.confirm();assert.equal(app.state.previewCalls,1);assert.equal(app.state.fulfillCalls,1);assert.equal(app.events.length,1)
})
test('invalid, expired and other-business codes show an error without collection; retries remain available',async()=>{
 const app=harness(async()=>{throw new Error('Reward code has expired.')})
 await app.lookup('random');assert.equal(app.state.previewCalls,0);assert.match(app.state.error,/not a KONEK/)
 await app.lookup(code);assert.match(app.state.error,/expired/);assert.equal(app.state.pending,'');assert.equal(app.lock.current,false);await app.confirm();assert.equal(app.state.fulfillCalls,0)
})
test('confirmation failures keep the saved code for retry and report already-used races',async()=>{
 let count=0;const app=harness(undefined,async value=>{assert.equal(value,code);if(!count++)throw new Error('Connection lost');return {already_used:true}})
 await app.lookup(code);await app.confirm();assert.match(app.state.error,/Connection lost/);assert.equal(app.scope.claim.id,claim.id);await app.confirm();assert.equal(app.events[0][0],true);assert.equal(app.state.pending,'')
})
test('responses after closing or session expiration cannot reopen a claim or show collection success',async()=>{
 const response=deferred(),app=harness(()=>response.promise);const pending=app.lookup(code);app.alive.current=false;response.resolve(claim);await pending;assert.equal(app.scope.claim,null)
 const result=deferred(),second=harness(undefined,()=>result.promise);await second.lookup(code);const collection=second.confirm();second.alive.current=false;result.resolve({already_used:false});await collection;assert.equal(second.events.length,0)
})

test('camera startup watchdog stops after readiness and offers recovery when startup stalls',()=>{
 const source=fs.readFileSync('src/components/RewardClaimScanner.tsx','utf8'),tree=ts.createSourceFile('scanner.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]?.getText(tree).includes('if (!cameraVisible || cameraReady)'))effect=node.arguments[0].getText(tree);ts.forEachChild(node,visit)}visit(tree);assert(effect);
 for(const [cameraVisible,cameraReady,expected] of [[true,false,true],[true,true,false],[false,false,false]]){
  let timeout,cleared=false,failed=false,error='';const scope={cameraVisible,cameraReady,setTimeout:(callback,ms)=>{assert.equal(ms,12000);timeout=callback;return 1},clearTimeout:()=>cleared=true,setCameraFailed:value=>failed=value,setError:value=>error=value};vm.createContext(scope);const cleanup=vm.runInContext(ts.transpile('('+effect+')()',{target:ts.ScriptTarget.ES2022}),scope);assert.equal(Boolean(timeout),expected);if(expected){timeout();assert.equal(failed,true);assert.match(error,/Restart camera/);cleanup();assert.equal(cleared,true)}
 }
})

test('returning from settings refreshes permission and remounts the camera; late resume does not update a closed scanner',async()=>{
 const source=fs.readFileSync('src/components/RewardClaimScanner.tsx','utf8'),tree=ts.createSourceFile('scanner.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]?.getText(tree).includes("AppState.addEventListener"))effect=node.arguments[0].getText(tree);ts.forEachChild(node,visit)}visit(tree);
 const response=deferred();let listener,removed=false,refreshes=0;const events=[],scope={alive:{current:true},AppState:{addEventListener:(_name,callback)=>{listener=callback;return{remove:()=>removed=true}}},setActive:value=>events.push(['active',value]),setCameraReady:value=>events.push(['ready',value]),setTorch:value=>events.push(['torch',value]),refreshPermission:()=>{refreshes++;return response.promise},setCameraFailed:value=>events.push(['failed',value]),setCameraSession:callback=>events.push(['session',callback(1)]),setError:value=>events.push(['error',value])};vm.createContext(scope);const cleanup=vm.runInContext(ts.transpile('('+effect+')()',{target:ts.ScriptTarget.ES2022}),scope);
 listener('background');assert.equal(refreshes,0);listener('active');assert.equal(refreshes,1);response.resolve();await new Promise(resolve=>setImmediate(resolve));assert.ok(events.some(event=>event[0]==='session'&&event[1]===2));assert.ok(events.some(event=>event[0]==='ready'&&event[1]===false));cleanup();assert.equal(removed,true);
 const late=deferred();scope.refreshPermission=()=>late.promise;const cleanAgain=vm.runInContext(ts.transpile('('+effect+')()',{target:ts.ScriptTarget.ES2022}),scope);listener('active');cleanAgain();const before=events.length;late.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(events.length,before);
})


test('discount QR sends the customer to checkout without consuming the saved voucher',async()=>{
 const app=harness(async()=>({...claim,discountKind:'percent',customerId:'customer-1'}));let opened;
 app.scope.onVoucher=value=>opened=value;
 await app.lookup(code);await app.confirm();await app.confirm();
 assert.equal(opened.customerId,'customer-1');assert.equal(app.state.fulfillCalls,0);assert.equal(app.events.length,0);assert.equal(app.completed.current,true);
});
