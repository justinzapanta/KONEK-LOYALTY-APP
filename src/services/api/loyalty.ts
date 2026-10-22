import * as Crypto from 'expo-crypto'
import { Customer } from '../../types/loyalty'
import { Reward } from '../../types/rewards'
import { api, auth, setWorkspaceBusinessId, setWorkspaceBranchId } from './client'
export type BranchAccess={legacy_branch_id?:string;can_select:boolean;role:string;branch_id:string|null;branch_name:string|null;branches:{id:string;name:string;status:string}[]}

type Row = Record<string, any>
export function mapCustomer(row: Row): Customer {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name ?? '', email: row.email ?? '', phone: row.phone ?? '',
    nfcCardId: row.card_uuid ?? undefined, totalPoints: Number(row.earned ?? 0), availablePoints: Number(row.total_points),
    totalRedeemed: Number(row.redeemed ?? 0), timesEarned: Number(row.visits ?? 0), createdAt: new Date(row.created_at).toLocaleDateString(), color: '#B5EDC6' }
}
export type WorkspaceData={customers:Customer[];rewards:Reward[];amountPerPoint:number;staffName:string;staffInitials:string;accountName:string;accountEmail:string;businessName:string;businessId:string;userId:string;branchAccess?:BranchAccess}
export async function loadWorkspace(customerId?: string):Promise<WorkspaceData> {
  const data = await api<{ branchAccess?:BranchAccess; customers: Row[]; rewards: Row[]; amountPerPoint: number; businessId: string; businessName: string; profile?: Row; user: { id: string; name?: string; email?: string } }>(`/api/loyalty/snapshot${customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''}`)
  setWorkspaceBusinessId(data.businessId, data.user.id)
  if(data.branchAccess){
    const selected=data.branchAccess.branch_id??data.branchAccess.branches.find(branch=>branch.status==='active')?.id
    if(!selected)throw new Error('Ask an owner or Admin to set up your branch.')
    setWorkspaceBranchId(selected,selected===data.branchAccess.legacy_branch_id)
    if(data.branchAccess.can_select&&!data.branchAccess.branch_id)return loadWorkspace(customerId)
  }
  await auth.bindUser(data.user.id)
  const profileName = [data.profile?.first_name, data.profile?.last_name].filter(Boolean).join(' ').trim()
  const accountName = profileName || data.user.name?.trim() || 'Team member'
  const parts = accountName.split(/\s+/)
  return {
    customers: data.customers.map(mapCustomer),
    rewards: data.rewards.map((row): Reward => ({ id: row.id, name: row.name, description: row.description ?? '', pointsCost: Number(row.points_price), status: row.status, imageUrl: row.image_url ?? '' })),
    amountPerPoint: Number(data.amountPerPoint), staffName: data.profile?.first_name || parts[0],
    staffInitials: `${parts[0][0]}${parts.length > 1 ? parts[parts.length-1][0] : ''}`.toUpperCase(),
    branchAccess:data.branchAccess, accountName, accountEmail: data.user.email ?? '', businessName: data.businessName, businessId: data.businessId, userId: data.user.id,
  }
}
export const lookupMember=(phone:string)=>api<Row>('/api/loyalty/member',{phone})
export type Identity = { pin?: string; card_key?: string }
export const mobile = <T = any>(body: Record<string, unknown>) => api<T>('/api/loyalty/mobile', body)
export const card = (action: 'lookup' | 'link', card_key: string, customer_id?: string, pin?: string) =>
  api<{ card_id: string; linked: boolean; customer: { id: string } | null }>('/api/loyalty/cards', { action, card_key, ...(customer_id ? { customer_id } : {}), ...(action === 'link' && pin ? { pin } : {}) })
export const newReference = () => Crypto.randomUUID()

export const registration = <T = any>(body: Record<string, unknown>) => api<T>('/api/loyalty/registration', body)

export type RewardClaim = { customer?: Record<string, any>; customerId?: string; discountKind?: 'percent' | 'fixed' | null; minimumPurchase?: number; id: string; name: string; quantity: number; pointsSpent: number; customerName: string; validUntil: string; status: 'ready' }
export const previewRewardClaim = (code: string) => api<RewardClaim>('/api/loyalty/claims/fulfill', { action: 'preview', code })
export const fulfillRewardClaim = (code: string) => api<{ customer?: Record<string,any>; id: string; status: 'used'; already_used: boolean }>('/api/loyalty/claims/fulfill', { action: 'fulfill', code })
