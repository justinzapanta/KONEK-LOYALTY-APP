import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'
import { auth } from './api/client'
import type { WorkspaceData } from './api/loyalty'
import type { Screen } from '../types/loyalty'

const ttl = 24 * 60 * 60 * 1000
let queue: Promise<unknown> = Promise.resolve()
let epoch = 0
let latestWrite = 0
let lastKey: string | null = null
async function prefix() {
  const scope = auth.cacheScope()
  if (Platform.OS === 'web' || !scope) return null
  lastKey = `konek.workspace.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope)}`
  return lastKey
}
async function manifest(key: string) {
  try {
    const value = JSON.parse(await SecureStore.getItemAsync(key) || 'null')
    return value && typeof value.revision === 'string' && /^[a-zA-Z0-9-]+$/.test(value.revision) && Number.isInteger(value.count) && value.count > 0 && value.count <= 4000 ? value : null
  } catch { return null }
}
async function removeChunks(key: string, value: {revision:string;count:number} | null) {
  if (value) for (let start=0;start<value.count;start+=16) await Promise.all(Array.from({length:Math.min(16,value.count-start)},(_,j)=>SecureStore.deleteItemAsync(`${key}.${value.revision}.${start+j}`).catch(()=>{})))
}
export async function readWorkspaceCache(): Promise<{data:WorkspaceData;savedAt:number;screen:Screen}|null> {
  const key = await prefix(); if (!key) return null
  const meta = await manifest(key); if (!meta) return null
  if (meta.schema!==2 || !Number.isFinite(meta.savedAt) || Date.now()-meta.savedAt > ttl || meta.savedAt > Date.now()+60000) { await SecureStore.deleteItemAsync(key); await removeChunks(key,meta); return null }
  try {
    const parts:string[]=[]
    for (let start=0;start<meta.count;start+=16) {
      const batch=await Promise.all(Array.from({length:Math.min(16,meta.count-start)},(_,j)=>SecureStore.getItemAsync(`${key}.${meta.revision}.${start+j}`)))
      if(batch.some(part=>part===null))return null
      parts.push(...batch as string[])
    }
    const data = JSON.parse(parts.join('')) as WorkspaceData
    if (!data.branchAccess?.branch_id || !data.businessId || !data.userId || !Array.isArray(data.customers) || !Array.isArray(data.rewards) || !Number.isFinite(data.amountPerPoint) || !auth.cacheScope()?.endsWith(`:${data.userId}`)) return null
    const screen = await SecureStore.getItemAsync(`${key}.screen`)
    return { data, savedAt:meta.savedAt, screen:screen==='customers'||screen==='rewards'?screen:'dashboard' }
  } catch { return null }
}
export function writeWorkspaceCache(data: WorkspaceData) {
  const version=epoch,scope=auth.cacheScope(),ticket=++latestWrite
  const work=queue.catch(()=>{}).then(async()=>{
    if(version!==epoch || ticket!==latestWrite || scope!==auth.cacheScope())return
    const key=await prefix();if(!key)return
    // Explicit whitelist: no passwords, PINs, claim codes, NFC keys, or session tokens.
    const json=JSON.stringify({branchAccess:data.branchAccess,businessId:data.businessId,userId:data.userId,businessName:data.businessName,accountName:data.accountName,accountEmail:data.accountEmail,staffName:data.staffName,staffInitials:data.staffInitials,amountPerPoint:data.amountPerPoint,rewards:data.rewards,customers:data.customers})
    const count=Math.ceil(json.length/500);if(count>4000)return
    const previous=await manifest(key),revision=Crypto.randomUUID()
    const written={revision,count}
    try {
      for(let start=0;start<count;start+=16)await Promise.all(Array.from({length:Math.min(16,count-start)},(_,j)=>{const i=start+j;return SecureStore.setItemAsync(`${key}.${revision}.${i}`,json.slice(i*500,(i+1)*500))}))
      if(version!==epoch || scope!==auth.cacheScope()){await removeChunks(key,written);return}
      await SecureStore.setItemAsync(key,JSON.stringify({...written,schema:2,savedAt:Date.now()}))
      await removeChunks(key,previous)
    } catch { await removeChunks(key,written) }
  })
  queue=work;return work
}
export async function rememberScreen(screen: Screen) { const key=await prefix();if(key)await SecureStore.setItemAsync(`${key}.screen`,screen) }
export async function clearWorkspaceCache() {
  epoch++
  const key=await prefix() ?? lastKey;await queue.catch(()=>{});if(!key)return
  const old=await manifest(key);await SecureStore.deleteItemAsync(key);await SecureStore.deleteItemAsync(`${key}.screen`);await removeChunks(key,old)
}
