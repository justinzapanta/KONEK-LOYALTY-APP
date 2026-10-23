const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function callback(name,scope){
 const source=fs.readFileSync('App.tsx','utf8'),tree=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let code
 function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name)code=node.initializer.getText(tree);ts.forEachChild(node,visit)}visit(tree)
 const exports={};vm.runInNewContext(ts.transpileModule(`exports.run=${code}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,useCallback:fn=>fn,Date,...scope});return exports.run
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
test('concurrent refreshes share one request and a late snapshot cannot replace a newer confirmed customer balance',async()=>{
 const pending=deferred(),applied=[],statuses=[];let requests=0
 const state={sessionVersion:{current:1},dataVersion:{current:0},syncInFlight:{current:null},lastSynced:{current:0},setSyncState:v=>statuses.push(v),loadWorkspace:()=>{requests++;return pending.promise},applyWorkspace:v=>applied.push(v),writeWorkspaceCache:async()=>{}}
 const reload=callback('reload',state),first=reload(),second=reload();assert.equal(first,second);assert.equal(requests,1)
 state.dataVersion.current++;pending.resolve({customers:[{availablePoints:1}]});await first
 assert.equal(applied.length,0);assert.equal(statuses.at(-1),'saved');assert.equal(state.syncInFlight.current,null)
})
test('reward modal closes only after the server returns the updated balance, and errors leave it open',async()=>{
 const events=[],pending=deferred();let running
 const state={selectedReward:{id:'coffee',name:'Coffee'},redeemCustomer:{id:'member',firstName:'Jane'},rewardQuantity:1,rewardIdentity:{current:{pin:'1234'}},submit:()=>pending.promise,perform:work=>{running=work()},applyConfirmedCustomer:row=>events.push(['balance',row.total_points]),applyWorkspace:()=>{},closeRewardFlow:()=>events.push(['close']),showAppAlert:title=>events.push(['alert',title])}
 callback('finishRedemption',state)();assert.equal(events.length,0)
 pending.resolve({customer:{id:'member',total_points:2.5}});await running
 assert.deepEqual(events,[['balance',2.5],['close'],['alert','Reward redeemed']])
 events.length=0;state.submit=async()=>{throw Error('Backend unavailable')};callback('finishRedemption',state)();await assert.rejects(running,/Backend unavailable/);assert.equal(events.length,0)
})
test('confirmed purchase balance is applied before closing the points modal without a full workspace reload',async()=>{
 const events=[];let running
 const state={pointsCustomer:{id:'member'},perform:work=>{running=work()},applyConfirmedCustomer:row=>events.push(['balance',row.total_points]),applyWorkspace:()=>{throw Error('Full reload should not run')},closeCustomerFlow:()=>events.push(['close']),pointsIdentity:{current:{}},showAppAlert:title=>events.push(['alert',title])}
 callback('finishPoints',state)({customer:{id:'member',total_points:12.5},net:200,points:2.5,newVouchers:[]});await running
 assert.deepEqual(events,[['balance',12.5],['close'],['alert','Order saved']])
})


// Run the shared modal through React Native's installed keyboard component,
// without pretending that a simulator validates a physical Android keyboard.
function keyboardModalHarness(os) {
 const React=require('react'),babel=require('@babel/core')
 const source=fs.readFileSync('App.tsx','utf8'),tree=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let container,styleObject
 function visit(n){
  if(ts.isFunctionDeclaration(n)&&n.name?.text==='KeyboardModalContainer')container=n.getText(tree)
  if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.name.text==='styles')styleObject=n.initializer.arguments[0]
  ts.forEachChild(n,visit)
 }
 visit(tree)
 const properties=styleObject.properties.filter(p=>p.name&&['keyboardModalBackdrop','keyboardModalViewport','keyboardModalCard','keyboardModalScroll','keyboardModalScrollContent'].includes(p.name.getText(tree)))
 const platform={OS:os},sheet={compose:(a,b)=>[a,b]},module={exports:{}}
 const code=babel.transformFileSync('node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js',{babelrc:false,configFile:false,presets:[require.resolve('@react-native/babel-preset')]}).code
 vm.runInNewContext(code,{module,exports:module.exports,process,require:name=>{
  if(name.endsWith('/Platform'))return platform
  if(name.endsWith('/StyleSheet'))return sheet
  if(name.endsWith('/LayoutAnimation'))return{configureNext(){}}
  if(name.endsWith('/AccessibilityInfo'))return{prefersCrossFadeTransitions:async()=>false}
  if(name.endsWith('/View'))return 'NativeView'
  if(name==='./Keyboard')return{}
  return require(name)
 }})
 const KeyboardAvoidingView=module.exports.default,exports={}
 const appCode=`const styles={${properties.map(p=>p.getText(tree)).join(',')}};${container};exports.modal=KeyboardModalContainer({children:'form',onClose:()=>{}})`
 vm.runInNewContext(ts.transpileModule(appCode,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{exports,React,Platform:platform,KeyboardAvoidingView,View:'View',ScrollView:'ScrollView',ModalHeader:'Header',colors:{cream:'#f8f6eb'}})
 return{modal:exports.modal,KeyboardAvoidingView}
}
function flattenStyle(style){return Object.assign({},...([style].flat(Infinity).filter(Boolean)))}
test('Android modal stays above an overlapping keyboard, keeps its backdrop, and recovers its full viewport after dismissal',async()=>{
 const{modal,KeyboardAvoidingView}=keyboardModalHarness('android'),element=modal.props.children
 assert.equal(modal.props.style.flex,1)
 for(const [windowHeight,keyboardTop]of[[844,500],[640,300],[500,260]]){
  const keyboard=new KeyboardAvoidingView(element.props)
  keyboard._initialFrameHeight=windowHeight
  keyboard._frame={x:0,y:0,width:390,height:windowHeight}
  keyboard.state={bottom:await keyboard._relativeKeyboardHeight({screenY:keyboardTop,height:windowHeight-keyboardTop})}
  const style=flattenStyle(keyboard.render().props.style)
  const viewportHeight=style.height??windowHeight
  const viewportTop=modal.props.style.justifyContent==='flex-end'?windowHeight-viewportHeight:0
  assert.equal(viewportTop+viewportHeight,keyboardTop,'the bottom-aligned form must stop at the keyboard, not behind it')
  assert.notEqual(element.props.enabled,false)
  assert.equal(modal.props.style.backgroundColor,'rgba(6,27,22,.50)')
  keyboard.state={bottom:0}
  const restored=flattenStyle(keyboard.render().props.style)
  assert.equal(restored.flex,1)
  assert.equal(restored.height,undefined)
 }
})
test('already-resized Android modal does not subtract keyboard height twice; iOS retains padding avoidance and form scrolling',async()=>{
 for(const os of ['android','ios']){
  const{modal,KeyboardAvoidingView}=keyboardModalHarness(os),element=modal.props.children
  const keyboard=new KeyboardAvoidingView(element.props)
  keyboard._initialFrameHeight=os==='android'?500:844
  keyboard._frame={x:0,y:0,width:390,height:keyboard._initialFrameHeight}
  keyboard.state={bottom:await keyboard._relativeKeyboardHeight({screenY:500,height:344})}
  const style=flattenStyle(keyboard.render().props.style)
  if(os==='android'){assert.equal(keyboard.state.bottom,0);assert.equal(style.height,undefined)}
  else assert.equal(style.paddingBottom,344)
  const scroll=element.props.children.props.children[1]
  assert.equal(scroll.type,'ScrollView')
  assert.equal(scroll.props.keyboardShouldPersistTaps,'handled')
  assert.equal(scroll.props.showsVerticalScrollIndicator,true)
 }
})
