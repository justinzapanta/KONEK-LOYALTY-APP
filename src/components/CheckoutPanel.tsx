import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, ApiError } from '../services/api/client'
import {readPendingCheckout,savePendingCheckout,clearPendingCheckout,type PendingCheckout} from '../services/pending-checkout'
import { newReference } from '../services/api/loyalty'
import {posCheckout,type PosPurchase} from '../services/pos-checkout'
import { pendingChallenges, availableVouchers } from '../services/challenges'

type Challenge = { id: string; title: string; description: string; metric: string; current: number; target: number; completed: boolean; approvedToday: boolean; reversed?: boolean }
type Voucher = { id: string; selection: string; name: string; minimumPurchase: number; excludePurchasePoints: boolean; excludeRedemptionPoints?: boolean }
type Context = { challenges: Challenge[]; vouchers: Voucher[] }
export type CheckoutResult = { customer?: Record<string, any>; gross: number; discount: number; net: number; points: number; purchasePointsExcluded: boolean; newVouchers: Voucher[]; context: Context }
export function CheckoutPanel({ posPurchase, customerId, amount, onComplete, onBusy }: { posPurchase?:PosPurchase|null;customerId: string; amount: string; onComplete: (result: CheckoutResult) => void; onBusy: (busy: boolean) => void }) {
  const [recovery,setRecovery]=useState<PendingCheckout|null>(null)
  const [recoveryChecked,setRecoveryChecked]=useState(false)
  const [context, setContext] = useState<Context | null>(null)
  const [quantities, setQuantities] = useState<Record<string,string>>({})
  const [voucher, setVoucher] = useState('')
  const [pin, setPin] = useState('')
  const [preview, setPreview] = useState<CheckoutResult | null>(null)
  const [previewKey, setPreviewKey] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [committing, setCommitting] = useState(false)
  const alive=useRef(true)
  const reference = useRef(posPurchase?.id??newReference()), locked = useRef(false), completed = useRef(false)
  const order = recovery?.order ?? { customer_id: customerId, reference: reference.current, ...(posPurchase?{pos_payment_id:posPurchase.id}:{}), amount: posPurchase?Number(posPurchase.total_paid):Number(amount), approvals: Object.entries(quantities).filter(([,v]) => Number(v)>0).map(([challenge_id,v]) => ({challenge_id,quantity:Number(v)})), voucher }
  async function checkoutRequest<T>(input:Record<string,any>,paymentId:string|null=order.pos_payment_id??null):Promise<T>{
    const clean=input.order?{...input,order:Object.fromEntries(Object.entries(input.order).filter(([name])=>name!=='pos_payment_id'))}:input
    return paymentId?posCheckout<T>(paymentId,clean):api<T>('/api/loyalty/checkout',clean)
  }
  const isPos=!!order.pos_payment_id
  const key = JSON.stringify(order)
  const reviewed = preview !== null && key === previewKey
  async function load() {
    setPending('Loading challenges and vouchers…'); setError('')
    try {
      const [current,stored]=await Promise.all([api<Context>('/api/loyalty/checkout',{ action:'context',customer_id:customerId }),readPendingCheckout(customerId)]);if(!alive.current)return;setContext(current)
      if(stored){
        const status=await checkoutRequest<{state:string;result?:CheckoutResult}>({action:'status',customer_id:customerId,reference:stored.order.reference},stored.order.pos_payment_id??null)
        if(!alive.current)return;
        if(status.state==='saved' && status.result){completed.current=true;await clearPendingCheckout(customerId);onComplete(status.result);return}
        setRecovery(stored);reference.current=stored.order.reference;setVoucher(stored.order.voucher);setCommitting(true)
        setPreview({...stored.expected,gross:stored.order.amount,purchasePointsExcluded:stored.expected.points===0,newVouchers:[],context:current});setPreviewKey(JSON.stringify(stored.order));setError('A previous purchase was not confirmed. Retry the saved purchase below; do not enter it as a new order.')
      }
      setRecoveryChecked(true)
    }
    catch (error) { setError((error as Error).message) }
    finally { setPending('') }
  }
  useEffect(() => { alive.current=true;void load();return()=>{alive.current=false} }, [customerId])
  async function review() {
    if (locked.current || completed.current || !recoveryChecked || recovery) return
    if (!Number.isFinite(order.amount) || order.amount <= 0) { setError('Enter the original order total before discounts.'); return }
    locked.current=true; setPending('Reviewing order…'); setError(''); onBusy(true)
    try {
      const result = await checkoutRequest<CheckoutResult>({action:'preview',order})
      setPreview(result); setPreviewKey(key)
    } catch (error) { setPreviewKey(''); setError((error as Error).message) }
    finally { locked.current=false; setPending(''); onBusy(false) }
  }
  async function confirm() {
    if (locked.current || completed.current || !reviewed || !preview) return
    if (voucher && !/^\d{4}$/.test(pin)) { setError('Please hand the phone to the customer to enter their four-digit PIN.'); return }
    locked.current=true; setCommitting(true); setPending('Saving order…'); setError(''); onBusy(true)
    let result: CheckoutResult | null = null
    try {
      const durable={order,expected:{net:preview.net,discount:preview.discount,points:preview.points}}
      await savePendingCheckout(durable);setRecovery(durable)
      result = await checkoutRequest<CheckoutResult>({action:'commit',order:{...order,...(voucher ? {pin} : {})},expected:{net:preview.net,discount:preview.discount,points:preview.points}})
      completed.current=true; setPin(''); await clearPendingCheckout(customerId).catch(()=>{}); setRecovery(null)
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401) { await clearPendingCheckout(customerId).catch(()=>{}); setRecovery(null); setCommitting(false); if (!/PIN/i.test(error.message)) setPreviewKey('') }
      setError(`${(error as Error).message} Could not confirm the save. Retry this same order safely; do not create another purchase.`)
    }
    finally { locked.current=false; setPending(''); onBusy(false) }
    if (result && alive.current) onComplete(result)
  }
  const money = (value:number) => `₱${Number(value).toFixed(2)}`
  const vouchers = isPos ? [] : availableVouchers(context?.vouchers)
  const challenges = pendingChallenges(context?.challenges)
  return <View style={s.wrap}>
    <Text style={s.title}>Challenges & vouchers</Text>
    {isPos&&<Text style={s.muted}>This order is already paid in your POS. Its amount is locked. New vouchers are saved for a later order; an existing voucher cannot reduce this completed payment.</Text>}
    {recovery && <Text style={s.muted}>Recovering the original purchase of {money(recovery.order.amount)}. The saved amount and reference will be reused.</Text>}
    {challenges.map(ch => <View key={ch.id} style={s.card}>
      <Text style={s.title}>{ch.title}</Text><Text style={s.muted}>{ch.description}</Text>
      <Text style={s.progress}>{Math.min(Number(ch.current),Number(ch.target))} / {ch.target}{ch.reversed ? ' · Reversed after refund' : ch.completed ? ' · Completed' : ''}</Text>
      {!ch.metric.startsWith('manual_') ? <Text style={s.muted}>Tracked automatically from recorded purchases. No manual confirmation needed.</Text>
      : ch.completed ? null : ch.metric==='manual_daily' ? <>
        <Text style={s.muted}>Once per customer per Philippine calendar day.</Text>
        <Pressable disabled={ch.approvedToday || !!pending || committing} onPress={()=>setQuantities({...quantities,[ch.id]:quantities[ch.id] ? '' : '1'})} style={[s.choice,quantities[ch.id] ? s.selected : null]}>
          <Text>{ch.approvedToday ? 'Already approved today' : quantities[ch.id] ? '✓ Confirm this qualifying visit' : 'Confirm this qualifying visit'}</Text>
        </Pressable>
      </> : <>
        <Text style={s.muted}>{ch.metric==='manual_order' ? `At least ${ch.target} qualifying items in THIS order. Separate orders do not combine.` : `${Math.max(0,Number(ch.target)-Number(ch.current))} remaining. Enter qualifying items in this order.`}</Text>
        <TextInput accessibilityLabel={`Qualifying quantity for ${ch.title}`} editable={!pending && !committing} keyboardType="number-pad" value={quantities[ch.id]||''} onChangeText={v=>setQuantities({...quantities,[ch.id]:v.replace(/[^0-9]/g,'')})} placeholder="Quantity (leave blank if not applicable)" style={s.input} maxLength={7}/>
      </>}
    </View>)}
    {context && challenges.length===0 && <Text style={s.muted}>No pending challenges for this customer.</Text>}
    {vouchers.length>0 && <View style={s.card}>
      <Text style={s.title}>Previously earned vouchers</Text>
      <Text style={s.muted}>Apply an existing voucher before payment. One voucher per order. Minimum purchase uses the original total. Review again after choosing a voucher.</Text>
      <Pressable disabled={!!pending || committing} onPress={()=>setVoucher('')} style={[s.choice,!voucher && s.selected]}><Text>{!voucher ? '✓ ' : ''}No voucher for this order</Text></Pressable>
      {vouchers.map(v=><Pressable key={v.selection} disabled={!!pending || committing || Number(order.amount)<v.minimumPurchase} onPress={()=>setVoucher(v.selection)} style={[s.choice,voucher===v.selection && s.selected,Number(order.amount)<v.minimumPurchase && {opacity:0.5}]}>
        <Text style={s.title}>{voucher===v.selection ? '✓ ' : ''}{v.name}</Text><Text style={s.muted}>Minimum order {money(v.minimumPurchase)}{v.excludeRedemptionPoints ? ' · No purchase points on this order' : ''}</Text>
      </Pressable>)}
    </View>}
    {reviewed && preview && <View style={s.summary}>
      <Text style={s.title}>Order review</Text>
      <Text>Original total: {money(preview.gross)}</Text><Text>Discount: −{money(preview.discount)}</Text>
      <Text style={s.total}>Amount to collect: {money(preview.net)}</Text>
      <Text>Purchase points: {preview.points}</Text>
      {preview.newVouchers.map(v => <Text key={v.id} style={s.muted}>{v.name} will be saved after this order is confirmed. Use it on the customer's next order; it cannot change this paid purchase.</Text>)}
      {preview.context?.challenges.filter(ch => quantities[ch.id]).map(ch => <Text key={ch.id} style={s.muted}>{ch.title}: {ch.current} / {ch.target} · {Math.max(0,Number(ch.target)-Number(ch.current))} remaining after this order</Text>)}
      {preview.purchasePointsExcluded && <Text style={s.muted}>The owner's voucher rule excludes purchase points for this order.</Text>}
      <Text style={s.muted}>Challenge progress and rewards are saved only when you confirm. Confirm only after collecting the amount shown.</Text>
    </View>}
    {reviewed && voucher !== '' && <View style={s.card}>
      <Text style={s.title}>Customer confirmation</Text>
      <Text style={s.muted}>Please hand the phone to the customer so they can enter their PIN privately to use this voucher.</Text>
      <TextInput accessibilityLabel="Customer PIN" secureTextEntry keyboardType="number-pad" maxLength={4} editable={!pending} value={pin} onChangeText={v=>setPin(v.replace(/[^0-9]/g,''))} placeholder="Four-digit PIN" style={s.input}/>
    </View>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!pending && <View style={s.row}><ActivityIndicator color="#16864a"/><Text>{pending}</Text></View>}
    {(!context || !recoveryChecked) && !pending && <Pressable onPress={()=>void load()} style={s.choice}><Text>Retry loading</Text></Pressable>}
    {context && recoveryChecked && <Pressable disabled={!!pending || completed.current} onPress={()=>void (reviewed ? confirm() : review())} style={[s.button,!!pending && {opacity:0.5}]}>
      <Text style={s.buttonText}>{reviewed ? committing ? 'Retry saving this order' : isPos ? 'Confirm loyalty & save order' : 'Confirm payment & save order' : 'Review order & rewards'}</Text>
    </Pressable>}
  </View>
}
const s=StyleSheet.create({wrap:{gap:12,marginTop:16},title:{fontSize:15,fontWeight:'700',color:'#081711'},muted:{fontSize:12,lineHeight:18,color:'#54665b'},progress:{fontSize:15,fontWeight:'600',color:'#16864a'},card:{padding:14,borderRadius:16,borderWidth:1,borderColor:'#dce5d9',gap:8,backgroundColor:'#fff'},input:{borderWidth:1,borderColor:'#b7c8bd',borderRadius:10,padding:12,color:'#081711'},choice:{padding:12,borderRadius:10,borderWidth:1,borderColor:'#dce5d9',gap:4},selected:{backgroundColor:'#e5f3e5',borderColor:'#16864a'},summary:{padding:16,borderRadius:16,backgroundColor:'#e5f3e5',gap:8},total:{fontSize:20,fontWeight:'700',color:'#081711'},button:{padding:16,borderRadius:14,backgroundColor:'#16864a',alignItems:'center'},buttonText:{color:'#fff',fontWeight:'700'},row:{flexDirection:'row',gap:8,alignItems:'center'},error:{color:'#b42318',fontSize:13,lineHeight:19}})
