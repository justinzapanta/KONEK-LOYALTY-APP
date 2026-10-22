import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'
import {getWorkspaceStorageScope,getLegacyWorkspaceStorageScope} from './api/client'
export type PendingCheckout = {order:{customer_id:string;reference:string;pos_payment_id?:string;amount:number;approvals:{challenge_id:string;quantity:number}[];voucher:string};expected:{net:number;discount:number;points:number}}
const memory = new Map<string,string>()
async function key(customerId:string){return 'konek.checkout.'+await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,getWorkspaceStorageScope()+':'+customerId)}
export async function readPendingCheckout(customerId:string):Promise<PendingCheckout|null>{
 const k=await key(customerId);let raw=Platform.OS==='web'?memory.get(k):await SecureStore.getItemAsync(k)
 if(!raw && Platform.OS!=='web'){
  const legacy=getLegacyWorkspaceStorageScope?.()
  if(legacy){const previous='konek.checkout.'+await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,legacy+':'+customerId);raw=await SecureStore.getItemAsync(previous);if(raw){await SecureStore.setItemAsync(k,raw);await SecureStore.deleteItemAsync(previous)}}
 }
 if(!raw)return null
 const value=JSON.parse(raw);if(value.order?.customer_id!==customerId||typeof value.order.reference!=='string'||!Number.isFinite(value.order.amount)||!Array.isArray(value.order.approvals)||!value.expected)throw new Error('The pending purchase could not be restored. Ask the owner to check transaction history before recording it again.');return value
}
export async function savePendingCheckout(value:PendingCheckout){const {customer_id,reference,amount,approvals,voucher,pos_payment_id}=value.order;const {net,discount,points}=value.expected;const raw=JSON.stringify({order:{customer_id,reference,amount,approvals,voucher,...(pos_payment_id?{pos_payment_id}:{})},expected:{net,discount,points}});const k=await key(customer_id);if(Platform.OS==='web')memory.set(k,raw);else await SecureStore.setItemAsync(k,raw)}
export async function clearPendingCheckout(customerId:string){const k=await key(customerId);if(Platform.OS==='web')memory.delete(k);else await SecureStore.deleteItemAsync(k)}
