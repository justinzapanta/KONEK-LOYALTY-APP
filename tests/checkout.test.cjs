const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(api){
 const source=fs.readFileSync('src/components/CheckoutPanel.tsx','utf8'),tree=ts.createSourceFile('checkout.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions={};
 function visit(node){if(ts.isFunctionDeclaration(node)&&['review','confirm','load','checkoutRequest'].includes(node.name?.text))functions[node.name.text]=node.getText(tree);ts.forEachChild(node,visit)}visit(tree);
 class ApiError extends Error {constructor(status,message){super(message);this.status=status}}
 const events=[],scope={api,posCheckout:async()=>{throw Error('Unexpected POS request')},ApiError,Number,Error,customerId:'customer',reference:{current:'stable-reference'},readPendingCheckout:async()=>null,setContext:value=>scope.context=value,setVoucher:value=>scope.voucher=value,setRecoveryChecked:value=>scope.recoveryChecked=value,alive:{current:true},recoveryChecked:true,recovery:null,savePendingCheckout:async value=>{scope.durable=value},clearPendingCheckout:async()=>{scope.durable=null},setRecovery:value=>scope.recovery=value,locked:{current:false},completed:{current:false},order:{customer_id:'customer',reference:'stable-reference',amount:800,approvals:[],voucher:''},key:'order-key',reviewed:false,preview:null,voucher:'',pin:'',
 setPending:v=>scope.pending=v,setError:v=>scope.error=v,setPreview:v=>scope.preview=v,setPreviewKey:v=>scope.previewKey=v,setCommitting:v=>scope.committing=v,setPin:v=>scope.pin=v,onBusy:v=>events.push(['busy',v]),onComplete:v=>events.push(['complete',v])};
 vm.createContext(scope);vm.runInContext(ts.transpile(functions.checkoutRequest+'\n'+functions.review+'\n'+functions.confirm+'\n'+functions.load,{target:ts.ScriptTarget.ES2022}),scope);return{scope,events};
}
test('checkout reviews without committing and keeps one reference across a failed commit and retry',async()=>{
 const calls=[];let failures=1;const result={net:800,discount:0,points:10,newVouchers:[]};
 const {scope,events}=harness(async(path,body)=>{calls.push(body);if(body.action==='commit'&&failures--)throw Error('Connection interrupted');return result});
 await scope.review();assert.equal(calls[0].action,'preview');assert.equal(events.filter(e=>e[0]==='complete').length,0);
 scope.reviewed=true;await scope.confirm();assert.equal(scope.completed.current,false);assert.match(scope.error,/Retry/);
 await scope.confirm();assert.equal(scope.completed.current,true);assert.equal(calls[1].order.reference,calls[2].order.reference);
 await scope.confirm();assert.equal(calls.length,3);assert.equal(events.filter(e=>e[0]==='complete').length,1);
});
test('voucher confirmation requires customer PIN; preview stays credential-free and repeat taps cannot double-submit',async()=>{
 let finish;const calls=[];const {scope}=harness(async(path,body)=>{calls.push(body);return new Promise(resolve=>finish=resolve)});
 scope.reviewed=true;scope.preview={net:640,discount:160,points:0};scope.voucher='claim:voucher';scope.order.voucher=scope.voucher;
 await scope.confirm();assert.equal(calls.length,0);assert.match(scope.error,/four-digit PIN/);
 scope.pin='1234';const request=scope.confirm();await scope.confirm();assert.equal(calls.length,1);assert.equal(calls[0].order.pin,'1234');
 finish({net:640,discount:160,points:0});await request;assert.equal(scope.pin,'');
});
test('failed preview retains reward information without marking the order reviewed',async()=>{
 const {scope}=harness(async()=>{throw Error('Voucher not earned on discounted order')});scope.preview={newVouchers:[{selection:'challenge:one'}]};scope.previewKey='old';
 await scope.review();assert.equal(scope.previewKey,'');assert.equal(scope.preview.newVouchers.length,1);assert.match(scope.error,/not earned/);
});

test('checkout offers only saved vouchers and never makes preview-earned vouchers selectable',()=>{
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/challenges.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
 const source=fs.readFileSync('src/components/CheckoutPanel.tsx','utf8'),tree=ts.createSourceFile('checkout.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let initializer;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='vouchers')initializer=node.initializer.getText(tree);ts.forEachChild(node,visit)}visit(tree);
 const saved={selection:'claim:00000000-0000-4000-8000-000000000001',name:'Earlier voucher'};
 const fresh={selection:'claim:00000000-0000-4000-8000-000000000002',name:'Earned by this order'};
 const scope={isPos:false,availableVouchers:exports.availableVouchers,context:{vouchers:[saved,{selection:'challenge:00000000-0000-4000-8000-000000000003'}]},preview:{newVouchers:[fresh]}};
 vm.runInNewContext(`globalThis.choices=${initializer}`,scope);
 assert.equal(scope.choices.length,1);assert.equal(scope.choices[0],saved);
 scope.context={vouchers:[]};vm.runInNewContext(`globalThis.choices=${initializer}`,scope);
 assert.equal(scope.choices.length,0,'a new preview reward is never an available voucher');
});


test('a storage failure stops checkout before sending a purchase',async()=>{
 let calls=0;const {scope}=harness(async()=>{calls++;return {}});scope.reviewed=true;scope.preview={net:80,discount:0,points:1};scope.savePendingCheckout=async()=>{throw Error('Secure storage unavailable')};await scope.confirm();assert.equal(calls,0);assert.equal(scope.completed.current,false);
});
test('restart recovery checks the original order and reports saved without submitting it twice',async()=>{
 const calls=[];const result={net:80,discount:0,points:1,newVouchers:[]};const {scope,events}=harness(async(path,body)=>{calls.push(body);return body.action==='context'?{challenges:[],vouchers:[]}:{state:'saved',result}});
 scope.readPendingCheckout=async()=>({order:{customer_id:'customer',reference:'old-order',amount:80,approvals:[],voucher:''},expected:result});await scope.load();assert.deepEqual(calls.map(x=>x.action),['context','status']);assert.equal(calls[1].reference,'old-order');assert.equal(events.filter(x=>x[0]==='complete').length,1);
});
test('a pending order not found after restart retains its amount, voucher and reference',async()=>{
 const {scope}=harness(async(path,body)=>body.action==='context'?{challenges:[],vouchers:[]}:{state:'not_saved'});scope.readPendingCheckout=async()=>({order:{customer_id:'customer',reference:'old-order',amount:80,approvals:[],voucher:'claim:saved'},expected:{net:60,discount:20,points:0.75}});await scope.load();assert.equal(scope.recovery.order.reference,'old-order');assert.equal(scope.recovery.order.amount,80);assert.equal(scope.voucher,'claim:saved');assert.equal(scope.committing,true);assert.equal(scope.recoveryChecked,true);
});


test('POS checkout uses its saved receipt, removes internal routing fields and retries the same reference',async()=>{
 const calls=[],{scope}=harness(async()=>{throw Error('A POS purchase must not use the manual checkout endpoint')});
 scope.order.pos_payment_id='receipt-id';scope.order.reference='receipt-id';scope.posCheckout=async(id,input)=>{calls.push({id,input});return {net:800,discount:0,points:10,newVouchers:[]}};
 await scope.review();assert.equal(calls[0].id,'receipt-id');assert.equal(calls[0].input.order.reference,'receipt-id');assert.equal(calls[0].input.order.pos_payment_id,undefined);
 scope.reviewed=true;await scope.confirm();assert.equal(calls[1].id,'receipt-id');assert.equal(calls[1].input.order.reference,'receipt-id');assert.equal(scope.completed.current,true);
});
