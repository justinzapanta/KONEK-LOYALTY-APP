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
