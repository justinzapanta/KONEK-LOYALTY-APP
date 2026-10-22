const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto')
function harness(){
 const storage=new Map();let scope='https://api.test:user-one',clock=Date.now(),fail=false
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/workspace-cache.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Date:class extends Date{static now(){return clock}},require(name){
   if(name==='expo-secure-store')return {getItemAsync:async key=>storage.get(key)??null,setItemAsync:async(key,value)=>{if(fail&&key.endsWith('.1'))throw Error('Disk full');assert(Buffer.byteLength(value)<=2048);storage.set(key,value)},deleteItemAsync:async key=>storage.delete(key)}
   if(name==='expo-crypto')return{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,value)=>crypto.createHash('sha256').update(value).digest('hex'),randomUUID:crypto.randomUUID}
   if(name==='react-native')return{Platform:{OS:'android'}}
   if(name==='./api/client')return{auth:{cacheScope:()=>scope}}
   throw Error(name)
  }
 });return{cache:exports,storage,setScope:value=>scope=value,advance:value=>clock+=value,setFail:value=>fail=value}
}
const data=()=>({branchAccess:{can_select:false,branch_id:'main-branch',branch_name:'Main branch',branches:[{id:'main-branch',name:'Main branch',status:'active'}]},businessId:'business',userId:'user-one',businessName:'Coffee shop',accountName:'Jane Reid',accountEmail:'staff@example.com',staffName:'Jane',staffInitials:'JR',amountPerPoint:80,rewards:[],customers:Array.from({length:9},(_,i)=>({id:String(i),firstName:'Customer',lastName:'Member',phone:'639170000001',email:'member@example.com',availablePoints:1.75,totalPoints:3,totalRedeemed:1.25,timesEarned:2,createdAt:'10/17/2026',color:'#fff'}))})
test('encrypted workspace cache restores exact balances and last tab, expires and isolates accounts and API servers',async()=>{
 const h=harness();await h.cache.writeWorkspaceCache(data());await h.cache.rememberScreen('rewards')
 let saved=await h.cache.readWorkspaceCache();assert.equal(saved.screen,'rewards');assert.equal(saved.data.customers[0].availablePoints,1.75)
 h.setScope('https://api.test:user-two');assert.equal(await h.cache.readWorkspaceCache(),null)
 h.setScope('https://other.test:user-one');assert.equal(await h.cache.readWorkspaceCache(),null)
 h.setScope('https://api.test:user-one');h.advance(25*60*60*1000);assert.equal(await h.cache.readWorkspaceCache(),null)
})
test('an interrupted cache write preserves the previous complete snapshot and logout erases the active cache',async()=>{
 const h=harness();await h.cache.writeWorkspaceCache(data());h.setFail(true)
 await h.cache.writeWorkspaceCache({...data(),businessName:'Incomplete new snapshot'})
 assert.equal((await h.cache.readWorkspaceCache()).data.businessName,'Coffee shop')
 h.setScope(null);await h.cache.clearWorkspaceCache();assert.equal(h.storage.size,0)
})
