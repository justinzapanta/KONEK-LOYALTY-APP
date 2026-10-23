import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

type Session = { access_token: string; refresh_token: string; expires_at: number; user_id?: string }
function cleanSession(value: Session & { user?: { id?: string } }, previousId?: string): Session {
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: value.expires_at, user_id: value.user_id ?? value.user?.id ?? previousId }
}
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}
const storageKey = 'konek.mobile.session'
let businessId: string | null = null
let staffId: string | null = null
let branchId: string | null = null
let legacyBranch=false
let workspaceGeneration=0
export function setWorkspaceBusinessId(id: string, userId?: string) { if(businessId!==id){branchId=null;workspaceGeneration++} businessId = id; staffId = userId ?? null }
export function setWorkspaceBranchId(id:string|null,isLegacyBranch=false){legacyBranch=isLegacyBranch;if(branchId!==id){branchId=id;workspaceGeneration++}}
export function getLegacyWorkspaceStorageScope(){return legacyBranch&&businessId&&staffId?`${storageOrigin()}:${businessId}:${staffId}`:null}
export function getWorkspaceStorageScope() { if (!businessId || !staffId) throw new Error('Reload your workspace before recording a purchase.'); return `${storageOrigin()}:${businessId}:${staffId}:${branchId??'main'}` }
export function getCheckoutStorageScope() { if (!businessId || !staffId || !branchId) throw new Error('Load your working branch before pairing a checkout.'); return `${storageOrigin()}:${businessId}:${branchId}` }
let session: Session | null = null
let generation = 0
let refreshing: Promise<void> | null = null
let expired: (() => void) | undefined
const baseUrl = () => {
  const value = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '')
  if (!value || !/^https?:\/\//.test(value)) throw new Error('Set EXPO_PUBLIC_API_URL to your KONEK website URL and restart Expo.')
  return value
}
// Keep production's existing encrypted cache, pending checkout and counter binding keys.
// This legacy namespace is local storage only: every network request uses baseUrl().
const storageOrigin = () => {
  const origin = baseUrl()
  return origin === 'https://konekdigital.com' ? 'https://konekdigital.vercel.app' : origin
}
const save = async () => {
  // Web previews keep tokens in memory. Native builds use Keychain/Keystore.
  if (Platform.OS !== 'web') {
    if (session) await SecureStore.setItemAsync(storageKey, JSON.stringify(session))
    else await SecureStore.deleteItemAsync(storageKey)
  }
}
async function send<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}`, ...(businessId && path !== '/api/workspace' ? { 'X-Konek-Business-Id': businessId } : {}), ...(branchId && path !== '/api/workspace' ? {'X-Konek-Branch-Id':branchId}: {}) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) throw new ApiError(response.status, json?.error ?? `API request failed (${response.status}).`, json?.code)
    if (!json || !('data' in json)) throw new Error('The configured URL did not return a KONEK API response.')
    return json.data as T
  } finally { clearTimeout(timeout) }
}
async function refresh() {
  if (refreshing) return refreshing
  const current = session
  const version = generation
  if (!current) throw new ApiError(401, 'Sign in to continue.')
  refreshing = (async () => {
    try {
      const data = await send<{ session: Session }>('/api/auth/refresh', { refresh_token: current.refresh_token })
      if (version !== generation) throw new ApiError(401, 'Session changed. Sign in again.')
      session = cleanSession(data.session, current.user_id)
      await save()
    } catch (error) {
      if (version === generation && error instanceof ApiError && error.status === 401) {
        session = null; businessId = null; generation++; await save(); expired?.()
      }
      throw error
    }
  })().finally(() => { refreshing = null })
  return refreshing
}
export const auth = {
  async realtimeToken() { if (!session) throw new ApiError(401, 'Sign in to continue.'); if (session.expires_at * 1000 <= Date.now() + 60000) await refresh(); return session!.access_token },
  cacheScope() { return session?.user_id ? `${storageOrigin()}:${session.user_id}` : null },
  async bindUser(id: string) { if (session && session.user_id !== id) { session.user_id = id; await save() } },
  onExpired(callback: () => void) { expired = callback; return () => { expired = undefined } },
  async restore(options?: { deferRefresh?: boolean }) {
    if (Platform.OS !== 'web') {
      const stored = await SecureStore.getItemAsync(storageKey)
      if (stored) {
        try {
          const value = JSON.parse(stored)
          if (typeof value.access_token === 'string' && typeof value.refresh_token === 'string' && typeof value.expires_at === 'number') session = cleanSession(value)
        } catch { await SecureStore.deleteItemAsync(storageKey) }
      }
    }
    if (!session) return false
    if (!options?.deferRefresh && session.expires_at * 1000 <= Date.now() + 60000) await refresh()
    return true
  },
  async login(email: string, password: string) {
    const data = await send<{ session: Session }>('/api/auth/login', { email: email.trim().toLowerCase(), password })
    if (!data.session) throw new ApiError(401, 'Sign in failed.')
    generation++; businessId = null; staffId = null; branchId=null; workspaceGeneration++; session = cleanSession(data.session); await save()
  },
  async logout() {
    const token = session?.access_token
    generation++; businessId = null; branchId=null; workspaceGeneration++; session = null; await save()
    if (token) await send('/api/auth/logout', {}, token)
  },
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (!session) throw new ApiError(401, 'Sign in to continue.')
  const version = generation
  const workspaceVersion=workspaceGeneration
  if (session.expires_at * 1000 <= Date.now() + 60000) await refresh()
  try {
    const data = await send<T>(path, body, session!.access_token)
    if (version !== generation) throw new ApiError(401, 'Session changed. Sign in again.')
    if(workspaceVersion!==workspaceGeneration)throw new Error('Your branch changed. Refresh the current branch.')
    return data
  }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || version !== generation) throw error
    await refresh()
    try {
      const data = await send<T>(path, body, session!.access_token)
      if (version !== generation) throw new ApiError(401, 'Session changed. Sign in again.')
      if(workspaceVersion!==workspaceGeneration)throw new Error('Your branch changed. Refresh the current branch.')
      return data
    }
    catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401 && version === generation) {
        session = null; businessId = null; generation++; await save(); expired?.()
      }
      throw retryError
    }
  }
}
