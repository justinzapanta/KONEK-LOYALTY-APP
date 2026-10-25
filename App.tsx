import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react'

import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context'

import { StatusBar } from 'expo-status-bar'
import Ionicons from '@expo/vector-icons/Ionicons'

import { Logo } from './src/components/Brand'
import { CheckoutPanel, CheckoutResult } from './src/components/CheckoutPanel'
import { AccountMenu } from './src/components/AccountMenu'
import { PosCheckoutConnection } from './src/components/PosCheckoutConnection'
import type {PosPurchase} from './src/services/pos-checkout'
import { phonePairCodeFromLink } from './src/services/pos-checkout'
import { NfcProcessingOverlay } from './src/components/NfcProcessingOverlay'
import { ClaimScannerButton, RewardClaimScanner } from './src/components/RewardClaimScanner'

import {
  Button,
  Field,
} from './src/components/FormControls'

import {
  Customer,
  NFCMode,
  Screen,
  getAvailablePoints,
  estimatePurchasePoints,
  normalizePhone,
} from './src/types/loyalty'

import {
  Reward,
} from './src/types/rewards'

import {
  NfcStateMachineProvider,
  useNfcStateMachine,
} from './src/state/nfc/NfcStateMachine'


import { readWorkspaceCache, writeWorkspaceCache, rememberScreen, clearWorkspaceCache } from './src/services/workspace-cache'
import { auth, ApiError, setWorkspaceBusinessId, setWorkspaceBranchId } from './src/services/api/client'
import { UnregisteredNfcError, UNREGISTERED_NFC_MESSAGE } from './src/services/nfc/cardKey'
import { card, loadWorkspace, mobile, registration, newReference, Identity, mapCustomer, WorkspaceData, BranchAccess, lookupMember } from './src/services/api/loyalty'
import { RequestStatusProvider, useRequestStatus } from './src/state/RequestStatus'

type RegistrationSource =
  | 'nfc'
  | 'phone'
  | null

type CustomerAction =
  | 'points'
  | 'redeem'

type CustomerFlowStage =
  | 'phoneLookup'
  | 'pin'
  | 'points'
  | null

type RedemptionStage =
  | 'setup'
  | 'scanning'
  | 'phoneLookup'
  | 'pin'
  | 'confirm'
  | null

type CustomerDetailStage =
  | 'details'
  | 'replaceConfirm'
  | 'linking'
  | 'cardPin'

type AlertType =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'


/* =========================================================
   APP ROOT
   ========================================================= */

export default function App() {
  return (
    <NfcStateMachineProvider>
      <AppContent />
    </NfcStateMachineProvider>
  )
}


/* =========================================================
   MAIN APP
   ========================================================= */

function AppContent() {
  const [loggedIn, setLoggedIn] =
    useState(false)

  const [screen, setScreen] =
    useState<Screen>('dashboard')

  const [customers, setCustomers] =
    useState<Customer[]>([])

  const [rewards, setRewards] =
    useState<Reward[]>([])


  const [amountPerPoint, setAmountPerPoint] = useState(80)
  const [staffName, setStaffName] = useState('Team')
  const [staffInitials, setStaffInitials] = useState('K')
  const [accountName, setAccountName] = useState('Team member')
  const [accountEmail, setAccountEmail] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [branchAccess,setBranchAccess]=useState<BranchAccess|undefined>(undefined)
  const [posPurchase,setPosPurchase]=useState<PosPurchase|null>(null)
  const [posPairOpen,setPosPairOpen]=useState(false)
  const [posPairRequest,setPosPairRequest]=useState<{code:string;id:number}|null>(null)
  const posPairRequestId = useRef(0)
  useEffect(() => {
    let active=true, receivedLiveLink=false
    function receive(url:string) {
      const code=phonePairCodeFromLink(url)
      if(active&&code)setPosPairRequest({code,id:++posPairRequestId.current})
    }
    const subscription=Linking.addEventListener('url',({url})=>{receivedLiveLink=true;receive(url)})
    void Linking.getInitialURL().then(url=>{if(url&&!receivedLiveLink)receive(url)}).catch(()=>{})
    return()=>{active=false;subscription.remove()}
  },[])
  const [accountOpen, setAccountOpen] = useState(false)
  const [counterSetupRequested, setCounterSetupRequested] = useState(false)
  const [claimScannerOpen, setClaimScannerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signOutBusy = useRef(false)
  const busy = useRef(false)
  const [requestStatus, setRequestStatus] = useState('')
  const [restoringSession, setRestoringSession] = useState(true)
  const sessionVersion = useRef(0)
  const pointsIdentity = useRef<Identity>({})
  const rewardIdentity = useRef<Identity>({})
  const pendingRequests = useRef(new Map<string, string>())
  const restoring = useRef<Promise<void> | null>(null)

  const [syncState, setSyncState] = useState<'syncing' | 'saved' | 'current'>('syncing')
  const workspaceData = useRef<WorkspaceData | null>(null)
  const syncInFlight = useRef<Promise<WorkspaceData> | null>(null)
  const dataVersion = useRef(0)
  const lastSynced = useRef(0)
  const applyWorkspace = useCallback((data: WorkspaceData) => {
    workspaceData.current = data
    setBranchAccess(data.branchAccess)
    setCustomers(data.customers); setRewards(data.rewards); setAmountPerPoint(data.amountPerPoint)
    setStaffName(data.staffName); setStaffInitials(data.staffInitials); setAccountName(data.accountName)
    setAccountEmail(data.accountEmail); setBusinessName(data.businessName)
  }, [])
  const reload = useCallback(() => {
    if (syncInFlight.current) return syncInFlight.current
    const version = sessionVersion.current, revision = dataVersion.current
    setSyncState('syncing')
    const request = loadWorkspace().then(data => {
      if (version === sessionVersion.current && revision === dataVersion.current) {
        applyWorkspace(data); lastSynced.current = Date.now(); setSyncState('current')
        void writeWorkspaceCache(data).catch(() => {})
      } else if (version === sessionVersion.current) setSyncState('saved')
      return data
    }).catch(error => {
      if (version === sessionVersion.current) setSyncState('saved')
      throw error
    }).finally(() => { if (syncInFlight.current === request) syncInFlight.current = null })
    syncInFlight.current = request
    return request
  }, [applyWorkspace])
  const applyConfirmedCustomer = useCallback((row: Record<string, any>) => {
    const customer = typeof row.firstName === 'string' ? row as Customer : mapCustomer(row)
    dataVersion.current++
    setCustomers(current => current.some(item => item.id === customer.id) ? current.map(item => item.id === customer.id ? customer : item) : [customer, ...current])
    setSelectedCustomer(current => current?.id === customer.id ? customer : current)
    if (workspaceData.current) {
      const data = workspaceData.current
      workspaceData.current = {...data, customers: data.customers.some(item => item.id === customer.id) ? data.customers.map(item => item.id === customer.id ? customer : item) : [customer,...data.customers]}
      void writeWorkspaceCache(workspaceData.current).catch(() => {})
    }
    return customer
  }, [])

  /* =======================================================
     REGISTRATION
     ======================================================= */

  const [
    registrationSource,
    setRegistrationSource,
  ] =
    useState<RegistrationSource>(
      null
    )

  const [cardId, setCardId] =
    useState('')


  /* =======================================================
     POINTS FLOW
     ======================================================= */

  const [
    customerFlowStage,
    setCustomerFlowStage,
  ] =
    useState<CustomerFlowStage>(
      null
    )

  const [
    pointsCustomer,
    setPointsCustomer,
  ] =
    useState<Customer | null>(
      null
    )

  const [purchase, setPurchase] =
    useState('')


  /* =======================================================
     CUSTOMER DETAILS / LINK NFC
     ======================================================= */

  const [
    selectedCustomer,
    setSelectedCustomer,
  ] =
    useState<Customer | null>(
      null
    )

  const [
    customerDetailStage,
    setCustomerDetailStage,
  ] =
    useState<CustomerDetailStage>(
      'details'
    )


  /* =======================================================
     REWARDS
     ======================================================= */

  const [
    selectedReward,
    setSelectedReward,
  ] =
    useState<Reward | null>(
      null
    )

  const [
    rewardQuantity,
    setRewardQuantity,
  ] =
    useState(1)

  const [
    redeemCustomer,
    setRedeemCustomer,
  ] =
    useState<Customer | null>(
      null
    )

  const [
    redemptionStage,
    setRedemptionStage,
  ] =
    useState<RedemptionStage>(
      null
    )


  /* =======================================================
     ALERT
     ======================================================= */

  const [
    appAlert,
    setAppAlert,
  ] =
    useState<{
      visible: boolean
      title: string
      message: string
      type: AlertType
    }>({
      visible: false,
      title: '',
      message: '',
      type: 'info',
    })


  /* =======================================================
     NFC
     ======================================================= */

  const {
    mode: nfcMode,
    state: nfcState,
    availability: nfcAvailability,
    error: nfcError,
    tag: nfcTag,

    start: beginNfc,
    cancel: cancelNfc,
    retry: retryNfc,
    consumeTag,
    setPromptsSuppressed: setNfcPromptsSuppressed,
    isPromptOpen: nfcPromptIsOpen,
  } = useNfcStateMachine()


  /* =======================================================
     ALERT
     ======================================================= */

  const showAppAlert =
    useCallback(
      (
        title: string,
        message: string,
        type: AlertType = 'info'
      ) => {
        setAppAlert({
          visible: true,
          title,
          message,
          type,
        })
      },
      []
    )


  const closeAppAlert =
    useCallback(() => {
      setAppAlert(
        (current) => ({
          ...current,
          visible: false,
        })
      )
    }, [])


  const clearSession = useCallback(() => {
    sessionVersion.current++
    dataVersion.current++
    syncInFlight.current = null
    workspaceData.current = null
    void clearWorkspaceCache().catch(() => {})
    cancelNfc()
    setLoggedIn(false)
    setCustomers([])
    setRewards([])
    setRegistrationSource(null)
    setCustomerFlowStage(null)
    setPointsCustomer(null)
    setSelectedCustomer(null)
    setSelectedReward(null)
    setRedeemCustomer(null)
    setRedemptionStage(null)
    setPurchase('')
    setPosPurchase(null);setPosPairOpen(false)
    setCardId('')
    setScreen('dashboard')
    setStaffName('Team')
    setStaffInitials('K')
    setAccountName('Team member')
    setAccountEmail('')
    setBusinessName('')
    setBranchAccess(undefined)
    setWorkspaceBranchId(null)
    setAccountOpen(false)
    setClaimScannerOpen(false)
    setAppAlert(current => ({ ...current, visible: false }))
    pointsIdentity.current = {}
    rewardIdentity.current = {}
    pendingRequests.current.clear()
  }, [cancelNfc])

  const signOut = useCallback(async () => {
    if (signOutBusy.current || busy.current) return
    signOutBusy.current = true
    setSigningOut(true)
    cancelNfc()
    let failed = false
    try { await clearWorkspaceCache().catch(() => {}); await auth.logout() } catch { failed = true }
    finally {
      clearSession()
      signOutBusy.current = false
      setSigningOut(false)
    }
    if (failed) Alert.alert('Signed out on this device', 'Server sign-out could not complete. Please check your connection.')
  }, [cancelNfc, clearSession])

  const perform = useCallback(async (work: () => Promise<void>, message = 'Processing request…') => {
    if (busy.current) return
    busy.current = true
    setRequestStatus(message)
    const version = sessionVersion.current
    try { await work() }
    catch (error) {
      if (version === sessionVersion.current) {
        const unregistered = error instanceof ApiError && error.code === 'NFC_NOT_REGISTERED'
        showAppAlert(unregistered ? 'NFC card not registered' : 'Request failed', unregistered ? UNREGISTERED_NFC_MESSAGE : error instanceof Error ? error.message : 'Please try again.', 'error')
      }
    }
    finally { busy.current = false; setRequestStatus('') }
  }, [showAppAlert])

  const submit = useCallback(async (body: Record<string, unknown>) => {
    const key = JSON.stringify({ ...body, pin: undefined })
    const reference = pendingRequests.current.get(key) ?? newReference()
    pendingRequests.current.set(key, reference)
    const result = await mobile({ ...body, reference })
    pendingRequests.current.delete(key)
    return result
  }, [])

  const reloadAfterSave = useCallback(async () => {
    const version = sessionVersion.current
    try { await reload(); return version === sessionVersion.current }
    catch {
      if (version === sessionVersion.current) showAppAlert('Saved', 'Your change was saved. Reopen the app to refresh the latest data.', 'info')
      return false
    }
  }, [reload, showAppAlert])

  useEffect(() => {
    const unsubscribe = auth.onExpired(clearSession)
    restoring.current = (async () => {
      try {
        if (await auth.restore({ deferRefresh: true })) {
          const cached = await readWorkspaceCache().catch(() => null)
          if (cached) { setWorkspaceBusinessId(cached.data.businessId, cached.data.userId); setWorkspaceBranchId(cached.data.branchAccess?.branch_id??null,cached.data.branchAccess?.branch_id===cached.data.branchAccess?.legacy_branch_id); applyWorkspace(cached.data); setScreen(cached.screen); setSyncState('saved') }
          setLoggedIn(true)
          setRestoringSession(false)
          void reload().catch(error => {
            if (error instanceof ApiError && [401,403,409].includes(error.status)) clearSession()
          })
        }
      } catch { clearSession() }
      finally { setRestoringSession(false) }
    })()
    return unsubscribe
  }, [clearSession, reload, applyWorkspace])

  useEffect(() => {
    if (loggedIn) void rememberScreen(screen).catch(() => {})
  }, [screen, loggedIn])
  useEffect(() => {
    if (!loggedIn) return
    const refresh = () => {
      if (!busy.current && !signOutBusy.current && Date.now()-lastSynced.current > 15000) void reload().catch(error => {
        if (error instanceof ApiError && [401,403,409].includes(error.status)) clearSession()
      })
    }
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh() })
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh() }, 60000)
    return () => { subscription.remove(); clearInterval(timer) }
  }, [loggedIn, reload, clearSession])

  /* =======================================================
     ANY MODAL OPEN?
     ======================================================= */

  const modalIsOpen =
    posPairOpen ||
    claimScannerOpen ||
    accountOpen ||
    registrationSource !== null ||
    customerFlowStage !== null ||
    selectedCustomer !== null ||
    redemptionStage !== null ||
    appAlert.visible

  useEffect(() => {
    if(posPairRequest&&loggedIn&&!modalIsOpen&&!requestStatus)setScreen('dashboard')
  },[posPairRequest,loggedIn,modalIsOpen,requestStatus])

  useEffect(() => {
    setNfcPromptsSuppressed(modalIsOpen)
  }, [modalIsOpen, setNfcPromptsSuppressed])


  /* =======================================================
     AUTOMATIC BACKGROUND NFC
     ======================================================= */

  useEffect(() => {
    if (!loggedIn || !businessName || nfcAvailability !== 'enabled') {
      return
    }

    /*
     * Do NOT let NFC trigger while
     * any modal/flow is currently open.
     */
    if (modalIsOpen || requestStatus) {
      return
    }

    if (nfcMode !== 'idle') {
      return
    }

    beginNfc('identify')
  }, [
    loggedIn,
    modalIsOpen,
    requestStatus,
    nfcMode,
    nfcAvailability,
    businessName,
    beginNfc,
  ])


  /* =======================================================
     HANDLE NFC
     ======================================================= */

  useEffect(() => {
    if (!loggedIn || nfcState !== 'error' || !nfcError) return
    const unregistered = nfcError instanceof UnregisteredNfcError
    // Close the native scan before using the existing app alert modal.
    if (unregistered) cancelNfc()
    showAppAlert(unregistered ? 'NFC card not registered' : 'Unable to read NFC',
      unregistered ? UNREGISTERED_NFC_MESSAGE : 'Unable to read the NFC card. Hold it near the back of your phone and try again.', 'error')
  }, [loggedIn, nfcState, nfcError, cancelNfc, showAppAlert])

  const handleNfcTag = useCallback((mode: Exclude<NFCMode, 'idle'>, tag: { id: string }) => {
    if (busy.current) return
    const version = sessionVersion.current
    cancelNfc()
    void perform(async () => {
      setCardId(tag.id)
      if (mode === 'link') {
        if (!selectedCustomer) return
        const result = await card('lookup', tag.id)
        if (version !== sessionVersion.current) return
        if (result.linked && result.customer?.id !== selectedCustomer.id) throw new Error('This KONEK card is already linked to another customer.')
        setCustomerDetailStage('cardPin')
        return
      }
      const result = await card('lookup', tag.id)
      if (version !== sessionVersion.current) return
      if (!result.linked || !result.customer) {
        if (mode === 'identify') setRegistrationSource('nfc')
        else showAppAlert('Customer not linked', 'This KONEK card is registered for this business but is not linked to a loyal customer yet.', 'error')
        return
      }
      const data = await loadWorkspace(result.customer.id)
      if (version !== sessionVersion.current) return
      const customer = data.customers.find(item => item.id === result.customer!.id)
      if (!customer) throw new Error('Customer not found. Please scan again.')
      applyConfirmedCustomer(customer)
      if (mode === 'identify') {
        pointsIdentity.current = { card_key: tag.id }
        setPointsCustomer(customer); setCustomerFlowStage('points')
      } else {
        rewardIdentity.current = { card_key: tag.id }
        setRedeemCustomer(customer); setRedemptionStage('confirm')
      }
    }, 'Checking NFC card…')
  }, [selectedCustomer, cancelNfc, perform, reloadAfterSave, showAppAlert, applyConfirmedCustomer])

  /* =======================================================
     PROCESS NFC TAG
     ======================================================= */

  useEffect(() => {
    if (
      nfcState !==
      'detected'
    ) {
      return
    }

    if (
      nfcMode ===
      'idle'
    ) {
      return
    }

    if (!nfcTag) {
      return
    }


    const tag =
      consumeTag()


    if (!tag) {
      return
    }


    handleNfcTag(
      nfcMode,
      tag
    )
  }, [
    nfcState,
    nfcMode,
    nfcTag,
    consumeTag,
    handleNfcTag,
  ])


  /* =======================================================
     REGISTER BY PHONE
     ======================================================= */

  const openPhoneRegistration =
    useCallback(() => {
      cancelNfc()

      setCardId('')

      setRegistrationSource(
        'phone'
      )
    }, [cancelNfc])


  const closeRegistration =
    useCallback(() => {
      cancelNfc()

      setRegistrationSource(
        null
      )

      setCardId('')
    }, [cancelNfc])


  const saveCustomer = useCallback(async (data: RegistrationData) => {
    await perform(async () => {
      let alreadyRegistered = false
      if (data.kind === 'new') {
        await submit({ action: 'register', first_name: data.firstName.trim(), last_name: data.lastName.trim(),
          email: data.email.trim().toLowerCase(), phone: normalizePhone(data.phone), pin: data.pin,
          ...(registrationSource === 'nfc' ? { card_key: cardId } : {}) })
      } else {
        const body = { action: 'join', phone: normalizePhone(data.phone),
          ...(data.pin ? { pin: data.pin } : {}),
          ...(registrationSource === 'nfc' ? { card_key: cardId } : {}) }
        const key = JSON.stringify({ ...body, pin: undefined })
        const reference = pendingRequests.current.get(key) ?? newReference()
        pendingRequests.current.set(key, reference)
        const result = await registration<{ already_member?: boolean }>({ ...body, reference })
        alreadyRegistered = result.already_member === true
        pendingRequests.current.delete(key)
      }
      closeRegistration()
      if (!await reloadAfterSave()) return
      showAppAlert(alreadyRegistered ? 'Already registered' : 'Customer registered',
        alreadyRegistered ? 'This customer is already registered with this business. You can award points using their phone number or registered KONEK card.' : 'The loyal customer was registered successfully.',
        alreadyRegistered ? 'info' : 'success')
    })
  }, [registrationSource, cardId, closeRegistration, perform, submit, reloadAfterSave, showAppAlert])

  /* =======================================================
     GIVE POINTS BY PHONE
     ======================================================= */

  const openPointsByPhone =
    useCallback(() => {
      pointsIdentity.current = {}
      cancelNfc()

      setPointsCustomer(
        null
      )

      setCustomerFlowStage(
        'phoneLookup'
      )
    }, [cancelNfc])


  const closeCustomerFlow =
    useCallback(() => {
      cancelNfc()

      setCustomerFlowStage(
        null
      )

      setPointsCustomer(
        null
      )

      pointsIdentity.current = {}
      setPurchase('');setPosPurchase(null)
    }, [cancelNfc])


  const lookupPhoneForPoints = useCallback((phone:string) => {
    const normalized=normalizePhone(phone)
    if(!normalized){showAppAlert('Phone required','Enter the customer’s phone number.','warning');return}
    void perform(async()=>{
      const row=await lookupMember(normalized)
      const customer=applyConfirmedCustomer(row)
      pointsIdentity.current={}
      setPointsCustomer(customer);setCustomerFlowStage('points')
    },'Finding customer…')
  },[perform,applyConfirmedCustomer,showAppAlert])

  const verifyPointsPin = useCallback((pin: string) => {
    if (!pointsCustomer) return
    void perform(async () => {
      await mobile({ action: 'verify', customer_id: pointsCustomer.id, pin })
      pointsIdentity.current = { pin }
      setCustomerFlowStage('points')
    })
  }, [pointsCustomer, perform])

  /* =======================================================
     AWARD POINTS
     ======================================================= */

  const finishPoints = useCallback((result: CheckoutResult) => {
    void perform(async () => {
      if (result.customer) applyConfirmedCustomer(result.customer)
      else {
        const data = await loadWorkspace(pointsCustomer?.id)
        if (pointsCustomer) {
          const confirmed = data.customers.find(item => item.id === pointsCustomer.id)
          if (!confirmed) throw new Error('Order saved. Sync the customer balance before continuing.')
          applyConfirmedCustomer(confirmed)
        } else applyWorkspace(data)
      }
      closeCustomerFlow()
      pointsIdentity.current = {}
      showAppAlert('Order saved', `Paid: ₱${result.net.toFixed(2)}. Purchase points: ${result.points}.${result.newVouchers.length ? " New challenge vouchers are saved for the customer's next order. They cannot be applied to this paid purchase." : ''}`, 'success')
    }, 'Updating confirmed balance…')
  }, [perform, closeCustomerFlow, applyConfirmedCustomer, applyWorkspace, pointsCustomer, showAppAlert])

  /* =======================================================
     CUSTOMER DETAILS
     ======================================================= */

  const openCustomerDetails =
    useCallback(
      (
        customer: Customer
      ) => {
        cancelNfc()

        setSelectedCustomer(
          customer
        )

        setCustomerDetailStage(
          'details'
        )
      },
      [cancelNfc]
    )


  const closeCustomerDetails =
    useCallback(() => {
      cancelNfc()
      setCardId('')

      setSelectedCustomer(
        null
      )

      setCustomerDetailStage(
        'details'
      )
    }, [cancelNfc])

  const confirmCardLink = useCallback(async (pin: string) => {
    if (!selectedCustomer || !cardId || !/^\d{4}$/.test(pin)) return
    const customer = selectedCustomer, key = cardId, version = sessionVersion.current
    await perform(async () => {
      const result = await card('link', key, customer.id, pin)
      if (version !== sessionVersion.current) return
      setSelectedCustomer({ ...customer, nfcCardId: result.card_id })
      setCardId('')
      setCustomerDetailStage('details')
      if (!await reloadAfterSave()) return
      showAppAlert('NFC card linked', 'The customer confirmed their PIN and the KONEK card is now linked. Their points remain in the same account.', 'success')
    }, 'Linking NFC card…')
  }, [selectedCustomer, cardId, perform, reloadAfterSave, showAppAlert])


  const startLinkCard =
    useCallback(() => {
      if (!selectedCustomer) {
        return
      }


      setCustomerDetailStage(
        'linking'
      )
      setCardId('')

      beginNfc(
        'link'
      )
    }, [
      selectedCustomer,
      beginNfc,
    ])


  const requestReplaceCard =
    useCallback(() => {
      setCustomerDetailStage(
        'replaceConfirm'
      )
    }, [])


  /* =======================================================
     REWARDS
     ======================================================= */

  const openReward =
    useCallback(
      (
        reward: Reward
      ) => {
        cancelNfc()


        if (
          reward.status !==
          'active'
        ) {
          showAppAlert(
            'Reward unavailable',
            'This reward is currently inactive.',
            'warning'
          )

          return
        }


        if (
          reward.stock !==
            undefined &&
          reward.stock <= 0
        ) {
          showAppAlert(
            'Out of stock',
            'This reward is currently out of stock.',
            'warning'
          )

          return
        }


        setSelectedReward(
          reward
        )

        setRewardQuantity(
          1
        )

        setRedeemCustomer(
          null
        )

        setRedemptionStage(
          'setup'
        )
      },
      [
        cancelNfc,
        showAppAlert,
      ]
    )


  const closeRewardFlow =
    useCallback(() => {
      rewardIdentity.current = {}
      cancelNfc()

      setSelectedReward(
        null
      )

      setRewardQuantity(
        1
      )

      setRedeemCustomer(
        null
      )

      setRedemptionStage(
        null
      )
    }, [cancelNfc])


  /* =======================================================
     REDEEM USING NFC
     ======================================================= */

  const startRewardNfc =
    useCallback(() => {
      if (!selectedReward) {
        return
      }


      setRedeemCustomer(
        null
      )

      setRedemptionStage(
        'scanning'
      )

      beginNfc(
        'redeem'
      )
    }, [
      selectedReward,
      beginNfc,
    ])


  /* =======================================================
     REDEEM USING PHONE + PIN
     ======================================================= */

  const startRewardPhone =
    useCallback(() => {
      rewardIdentity.current = {}
      if (!selectedReward) {
        return
      }


      setRedeemCustomer(
        null
      )

      setRedemptionStage(
        'phoneLookup'
      )
    }, [selectedReward])


  const lookupPhoneForReward=useCallback((phone:string)=>{
    const normalized=normalizePhone(phone)
    if(!normalized){showAppAlert('Phone required','Enter the customer’s phone number.','warning');return}
    void perform(async()=>{
      const row=await lookupMember(normalized);const customer=applyConfirmedCustomer(row)
      setRedeemCustomer(customer);setRedemptionStage('pin')
    },'Finding customer…')
  },[perform,applyConfirmedCustomer,showAppAlert])

  const verifyRewardPin = useCallback((pin: string) => {
    if (!redeemCustomer) return
    void perform(async () => {
      await mobile({ action: 'verify', customer_id: redeemCustomer.id, pin })
      rewardIdentity.current = { pin }
      setRedemptionStage('confirm')
    })
  }, [redeemCustomer, perform])

  /* =======================================================
     FINISH REWARD
     ======================================================= */

  const finishRedemption = useCallback(() => {
    if (!selectedReward || !redeemCustomer) return
    void perform(async () => {
      const result = await submit({ action: 'redeem', customer_id: redeemCustomer.id, reward_id: selectedReward.id,
        quantity: rewardQuantity, ...rewardIdentity.current })
      if (result.customer) applyConfirmedCustomer(result.customer)
      else { const data = await loadWorkspace(); applyWorkspace(data) }
      closeRewardFlow()
      rewardIdentity.current = {}
      showAppAlert('Reward redeemed', `${redeemCustomer.firstName} redeemed ${rewardQuantity} × ${selectedReward.name}.`, 'success')
    })
  }, [selectedReward, redeemCustomer, rewardQuantity, perform, submit, closeRewardFlow, applyConfirmedCustomer, applyWorkspace, showAppAlert])

  const changeBranch=useCallback(async(id:string)=>{
    if(!branchAccess?.can_select||busy.current||signOutBusy.current||id===branchAccess.branch_id)return
    const previous=workspaceData.current
    setPosPurchase(null);setPurchase('');setPosPairOpen(false)
    setAccountOpen(false);cancelNfc();dataVersion.current++;syncInFlight.current=null
    setWorkspaceBranchId(id);setCustomers([]);setRewards([]);setBusinessName('')
    try {await reload()}catch(error){
      setWorkspaceBranchId(previous?.branchAccess?.branch_id??null,previous?.branchAccess?.branch_id===previous?.branchAccess?.legacy_branch_id)
      if(previous)applyWorkspace(previous)
      setSyncState('saved');showAppAlert('Unable to switch branches',error instanceof Error?error.message:'Check your connection and try again.','error')
    }
  },[branchAccess,reload,applyWorkspace,cancelNfc,showAppAlert])

  /* =======================================================
     LOGIN
     ======================================================= */

  if (restoringSession) return <SafeAreaProvider><SafeAreaView style={{flex:1,backgroundColor:'#F8F6EB',alignItems:'center',justifyContent:'center',gap:16}}><Logo /><ActivityIndicator color="#16864a"/><Text style={{color:'#54665b'}}>Opening your workspace…</Text></SafeAreaView></SafeAreaProvider>
  if (loggedIn && !businessName) return <SafeAreaProvider><SafeAreaView style={{flex:1,backgroundColor:'#F8F6EB',alignItems:'center',justifyContent:'center',gap:16,padding:24}}><Logo />
    {syncState === 'syncing' ? <><ActivityIndicator color="#16864a"/><Text style={{color:'#54665b'}}>Loading your workspace…</Text></> : <><Text style={{color:'#54665b',textAlign:'center'}}>Connect to sync your workspace.</Text><Pressable accessibilityRole="button" onPress={() => {void reload().catch(() => {})}}><Text style={{color:'#16864a',fontWeight:'700'}}>Try again</Text></Pressable><Pressable accessibilityRole="button" onPress={() => {void signOut()}}><Text style={{color:'#54665b'}}>Sign out</Text></Pressable></>}
  </SafeAreaView></SafeAreaProvider>
  if (!loggedIn) {
    return (
      <Login restoring={restoringSession} onLogin={async (email, password) => {
        await restoring.current
        await auth.login(email, password)
        await reload()
        setLoggedIn(true)
      }} />
    )
  }


  /* =======================================================
     UI
     ======================================================= */

  return (
    <RequestStatusProvider value={requestStatus}>
    <SafeAreaProvider>
      <SafeAreaView
        style={
          styles.safe
        }
      >
        <StatusBar
          style="dark"
        />


        <View
          style={
            styles.app
          }
        >
          <Header
            initials={staffInitials}
            onAccount={() => {
              if (busy.current || modalIsOpen) return
              Keyboard.dismiss()
              cancelNfc()
              setAccountOpen(true)
            }}
          />


          {!!branchAccess?.branch_name&&<View style={{paddingHorizontal:24,paddingTop:8}}><Text style={{color:'#54665b',fontSize:12}}>{branchAccess.branch_name}{branchAccess.can_select?' · Change in your account menu':' · Your assigned branch'}</Text></View>}
          {syncState !== 'current' && <Pressable accessibilityRole="button" disabled={syncState === 'syncing'} onPress={() => { void reload().catch(() => {}) }} style={{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:24,paddingVertical:9,backgroundColor:'#E7F8E9'}}>
            {syncState === 'syncing' && <ActivityIndicator size="small" color="#16864a"/>}
            <Text style={{color:'#215E48',fontSize:12,flex:1}}>{syncState === 'syncing' ? 'Updating your workspace…' : 'Showing saved data · Tap to sync the latest updates'}</Text>
          </Pressable>}
          <ScrollView
            contentContainerStyle={
              styles.content
            }

            showsVerticalScrollIndicator={
              false
            }
          >
            {branchAccess?.branch_id&&<PosCheckoutConnection setupRequested={counterSetupRequested} onSetupHandled={()=>setCounterSetupRequested(false)} showQueue={screen==='dashboard'} key={branchAccess.branch_id} branchName={branchAccess.branch_name} pairRequest={posPairRequest} onPairRequestHandled={id=>setPosPairRequest(current=>current?.id===id?null:current)} selectedId={posPurchase?.id} paused={modalIsOpen||!!requestStatus} onModalChange={setPosPairOpen} onClear={()=>{setPosPurchase(null);setPurchase('')}} onSelect={value=>{if(busy.current||modalIsOpen)return;setPosPurchase(value);setPurchase(String(value.total_paid))}}/>}
            {screen ===
              'dashboard' && (
              <Dashboard
                onScanReward={() => {
                  if (busy.current || modalIsOpen || nfcPromptIsOpen()) return
                  setNfcPromptsSuppressed(true)
                  Keyboard.dismiss()
                  cancelNfc()
                  setClaimScannerOpen(true)
                }}
                staffName={staffName}
                customers={
                  customers
                }

                nfcReady={
                  nfcAvailability === 'enabled' && nfcMode ===
                  'identify'
                }
                nfcAvailability={nfcAvailability}

                onRegisterByPhone={
                  openPhoneRegistration
                }

                onPointsByPhone={
                  openPointsByPhone
                }

                onCustomers={() =>
                  setScreen(
                    'customers'
                  )
                }

                onCustomerPress={
                  openCustomerDetails
                }
              />
            )}


            {screen ===
              'customers' && (
              <Customers
                customers={
                  customers
                }

                onAdd={
                  openPhoneRegistration
                }

                onCustomerPress={
                  openCustomerDetails
                }
              />
            )}


            {screen ===
              'rewards' && (
              <RewardsPage
                onScanReward={() => {
                  if (busy.current || modalIsOpen || nfcPromptIsOpen()) return
                  setNfcPromptsSuppressed(true)
                  Keyboard.dismiss()
                  cancelNfc()
                  setClaimScannerOpen(true)
                }}
                rewards={
                  rewards
                }

                onRewardPress={
                  openReward
                }
              />
            )}



          </ScrollView>


          <BottomNav
            screen={
              screen
            }

            setScreen={
              setScreen
            }
          />
        </View>


        <AccountMenu onConnectCounter={()=>{setAccountOpen(false);setCounterSetupRequested(true)}} visible={accountOpen} name={accountName} email={accountEmail}
          branchAccess={branchAccess} onBranchChange={id=>{void changeBranch(id)}} businessName={businessName} initials={staffInitials} signingOut={signingOut}
          onClose={() => setAccountOpen(false)} onSignOut={() => { void signOut() }} />

        {claimScannerOpen && <RewardClaimScanner onClose={() => setClaimScannerOpen(false)}
          onVoucher={(claim) => {
            setClaimScannerOpen(false);setPosPurchase(null)
            const customer = claim.customer ? applyConfirmedCustomer(claim.customer) : customers.find(item => item.id === claim.customerId)
            if (!customer) { showAppAlert('Refresh customers', 'Reopen the customer list and find this customer to apply their voucher.', 'info'); return }
            pointsIdentity.current = {}
            setPurchase('')
            setPointsCustomer(customer)
            setCustomerFlowStage('points')
          }}
          onComplete={(alreadyUsed, claim) => {
            if (claim.customer) applyConfirmedCustomer(claim.customer)
            setClaimScannerOpen(false)
            showAppAlert(alreadyUsed ? 'Reward already collected' : 'Reward collected',
              alreadyUsed ? 'This code was already marked as used. Do not hand over the reward again.'
                : `${claim.customerName} collected ${claim.quantity} × ${claim.name}. The code is now marked as used.`,
              alreadyUsed ? 'info' : 'success')
            if (!claim.customer) void reloadAfterSave()
          }} />}

        {/* ===============================================
            REGISTRATION
            =============================================== */}

        <RegistrationModal
          source={
            registrationSource
          }

          cardId={
            cardId
          }

          onSave={
            saveCustomer
          }

          onClose={() => { if (!busy.current) closeRegistration() }}

          onAlert={
            showAppAlert
          }
        />


        {/* ===============================================
            GIVE POINTS
            =============================================== */}

        <CustomerFlowModal
          posPurchase={posPurchase}
          onCheckoutBusy={(active) => { busy.current = active; setRequestStatus(active ? "Processing checkout…" : "") }}
          amountPerPoint={amountPerPoint}
          stage={
            customerFlowStage
          }

          customer={
            pointsCustomer
          }

          purchase={
            purchase
          }

          setPurchase={
            setPurchase
          }

          onFindPhone={
            lookupPhoneForPoints
          }

          onVerifyPin={
            verifyPointsPin
          }

          onFinish={
            finishPoints
          }

          onClose={() => { if (!busy.current) closeCustomerFlow() }}
        />


        {/* ===============================================
            CUSTOMER DETAILS
            =============================================== */}

        <CustomerDetailsModal
          customer={
            selectedCustomer
          }

          stage={
            customerDetailStage
          }

          nfcState={
            nfcState
          }

          onClose={() => { if (!busy.current) closeCustomerDetails() }}

          onLink={
            startLinkCard
          }
          onPinConfirm={confirmCardLink}

          onReplace={
            requestReplaceCard
          }

          onReplaceConfirm={
            startLinkCard
          }

          onReplaceCancel={() =>
            setCustomerDetailStage(
              'details'
            )
          }

          onRetry={
            retryNfc
          }
        />


        {/* ===============================================
            REWARDS
            =============================================== */}

        <RewardFlowModal
          stage={
            redemptionStage
          }

          reward={
            selectedReward
          }

          customer={
            redeemCustomer
          }

          quantity={
            rewardQuantity
          }

          setQuantity={
            setRewardQuantity
          }

          nfcState={
            nfcState
          }

          onUseNfc={
            startRewardNfc
          }

          onUsePhone={
            startRewardPhone
          }

          onFindPhone={
            lookupPhoneForReward
          }

          onVerifyPin={
            verifyRewardPin
          }

          onRetry={
            retryNfc
          }

          onRedeem={
            finishRedemption
          }

          onClose={() => { if (!busy.current) closeRewardFlow() }}
        />


        {/* ===============================================
            ALERT
            =============================================== */}

        <ProfessionalAlertModal
          visible={
            appAlert.visible
          }

          title={
            appAlert.title
          }

          message={
            appAlert.message
          }

          type={
            appAlert.type
          }

          onClose={
            closeAppAlert
          }
        />
        {loggedIn && !modalIsOpen &&
          (requestStatus === 'Checking NFC card…' || requestStatus === 'Linking NFC card…') &&
          <NfcProcessingOverlay message={requestStatus} />}
      </SafeAreaView>
    </SafeAreaProvider>
    </RequestStatusProvider>
  )
}


/* =========================================================
   DASHBOARD
   ========================================================= */

function Dashboard({
  onScanReward,
  staffName,
  customers,
  nfcReady,
  nfcAvailability,
  onRegisterByPhone,
  onPointsByPhone,
  onCustomers,
  onCustomerPress,
}: {
  onScanReward: () => void
  staffName: string
  customers: Customer[]
  nfcReady: boolean
  nfcAvailability: string

  onRegisterByPhone:
    () => void

  onPointsByPhone:
    () => void

  onCustomers:
    () => void

  onCustomerPress:
    (
      customer: Customer
    ) => void
}) {
  const totalPoints =
    customers.reduce(
      (
        total,
        customer
      ) =>
        total +
        customer.totalPoints,
      0
    )


  const totalRedeemed =
    customers.reduce(
      (
        total,
        customer
      ) =>
        total +
        customer.totalRedeemed,
      0
    )


  return (
    <>
      <Text
        style={
          styles.eyebrow
        }
      >
        LOYALTY OVERVIEW
      </Text>


      <Text
        style={
          styles.title
        }
      >
        Good day, {staffName}.
      </Text>


      <Text
        style={
          styles.muted
        }
      >
        Customers can tap their
        KONEK card anytime.
      </Text>


      {/* NFC */}

      <View
        style={
          styles.nfcReadyCard
        }
      >
        <View
          style={
            styles.nfcReadyIcon
          }
        >
          <Ionicons
            name="wifi"

            size={27}

            color={
              colors.ink
            }
          />
        </View>


        <View
          style={{
            flex: 1,
          }}
        >
          <View
            style={
              styles.statusRow
            }
          >
            <View
              style={[
                styles.statusDot,

                {
                  backgroundColor:
                    nfcReady
                      ? colors.green
                      : '#F0B44D',
                },
              ]}
            />

            <Text
              style={
                styles.statusText
              }
            >
              {nfcReady
                ? 'NFC ready'
                : nfcAvailability === 'disabled' ? 'NFC is off'
                : nfcAvailability === 'unsupported' ? 'NFC unavailable'
                : nfcAvailability === 'unavailable' ? 'Unable to check NFC'
                : 'Preparing NFC'}
            </Text>
          </View>


          <Text
            style={
              styles.cardTitle
            }
          >
            Tap KONEK card
          </Text>


          <Text
            style={
              styles.smallMuted
            }
          >
            The fastest way to identify
            and reward loyal customers.
          </Text>
        </View>
      </View>


      {/* FALLBACK */}

      <ClaimScannerButton onPress={onScanReward} />

      <Text
        style={
          styles.quickTitle
        }
      >
        Without a KONEK card
      </Text>


      <View style={styles.quickGrid}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Register customer"
          accessibilityHint="Opens the customer registration form"
          style={styles.quickAction}
          onPress={onRegisterByPhone}
        >
          <View style={styles.quickActionHeader}>
            <View style={styles.quickIcon}><Ionicons name="person-add-outline" size={23} color={colors.ink} /></View>
            <Ionicons name="chevron-forward" size={21} color={colors.ink} />
          </View>
          <Text style={styles.quickActionTitle}>Register customer</Text>
          <Text style={styles.quickActionDescription}>Add a new loyalty member.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Give points"
          accessibilityHint="Opens phone number entry to give points"
          style={styles.quickAction}
          onPress={onPointsByPhone}
        >
          <View style={styles.quickActionHeader}>
            <View style={styles.quickIcon}><Ionicons name="call-outline" size={23} color={colors.ink} /></View>
            <Ionicons name="chevron-forward" size={21} color={colors.ink} />
          </View>
          <Text style={styles.quickActionTitle}>Give points</Text>
          <Text style={styles.quickActionDescription}>Find a member by phone number.</Text>
        </Pressable>
      </View>


      <View
        style={
          styles.statGrid
        }
      >
        <Stat
          label="Customers"

          value={
            String(
              customers.length
            )
          }

          icon="people-outline"
        />

        <Stat
          label="Points issued"

          value={
            totalPoints.toLocaleString()
          }

          icon="sparkles-outline"
        />

        <Stat
          label="Redeemed"

          value={
            totalRedeemed.toLocaleString()
          }

          icon="gift-outline"
        />
      </View>


      <View
        style={
          styles.sectionRow
        }
      >
        <Text
          style={
            styles.sectionTitle
          }
        >
          Recent customers
        </Text>

        <Pressable
          onPress={
            onCustomers
          }
        >
          <Text
            style={
              styles.link
            }
          >
            View all →
          </Text>
        </Pressable>
      </View>


      {customers
        .slice(
          0,
          3
        )
        .map(
          (
            customer
          ) => (
            <CustomerCard
              key={
                customer.id
              }

              customer={
                customer
              }

              onPress={() =>
                onCustomerPress(
                  customer
                )
              }
            />
          )
        )}
    </>
  )
}


/* =========================================================
   REGISTRATION MODAL
   ========================================================= */

type RegistrationData = { kind: 'new'; firstName: string; lastName: string; email: string; phone: string; pin: string } | { kind: 'existing'; phone: string; pin?: string }

function RegistrationModal({
  source,
  cardId,
  onSave,
  onClose,
  onAlert,
}: {
  source:
    RegistrationSource

  cardId: string

  onSave: (data: RegistrationData) => Promise<void>

  onClose:
    () => void

  onAlert:
    (
      title: string,
      message: string,
      type: AlertType
    ) => void
}) {
  return (
    <Modal
      transparent

      visible={
        source !== null
      }

      animationType="slide"

      onRequestClose={
        onClose
      }

      statusBarTranslucent
    >
      {source && (
        <RegisterView
          source={
            source
          }

          cardId={
            cardId
          }

          onSave={
            onSave
          }

          onClose={
            onClose
          }

          onAlert={
            onAlert
          }
        />
      )}
    </Modal>
  )
}


/* =========================================================
   KEYBOARD-SAFE MODAL CONTAINER
   ========================================================= */

function KeyboardModalContainer({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <View style={styles.keyboardModalBackdrop}>
      <KeyboardAvoidingView
        style={styles.keyboardModalViewport}
        // Keep Android forms above the keyboard even when the modal window
        // does not resize. The full-size backdrop stays outside this view.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View
          style={styles.keyboardModalCard}
        >
          <ModalHeader
            onClose={onClose}
          />

          <ScrollView
            style={styles.keyboardModalScroll}
            contentContainerStyle={
              styles.keyboardModalScrollContent
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === 'ios'
                ? 'interactive'
                : 'on-drag'
            }
            showsVerticalScrollIndicator={true}
            persistentScrollbar
            indicatorStyle="black"
            bounces={false}
            overScrollMode="never"
            contentInsetAdjustmentBehavior="never"
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}


/* =========================================================
   REGISTER
   ========================================================= */

function RegisterView({
  source,
  cardId,
  onSave,
  onClose,
  onAlert,
}: {
  source:
    'nfc' |
    'phone'

  cardId: string

  onSave: (data: RegistrationData) => Promise<void>

  onClose:
    () => void

  onAlert:
    (
      title: string,
      message: string,
      type: AlertType
    ) => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [step, setStep] = useState<'phone' | 'new' | 'existing'>('phone')
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const run = async (work: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true; setPending(true)
    try { await work() } catch (error) {
      if (alive.current) onAlert('Registration could not continue', error instanceof Error ? error.message : 'Please try again.', 'warning')
    } finally { busy.current = false; if (alive.current) setPending(false) }
  }
  const lookup = () => void run(async () => {
    if (!/^639[0-9]{9}$/.test(normalizePhone(phone))) throw Error('Enter a valid Philippine phone number.')
    const result = await registration<{ exists: boolean; alreadyMember: boolean }>({ action: 'lookup', phone: normalizePhone(phone) })
    if (alive.current) {
      if (result.alreadyMember) {
        setStep('phone')
        onAlert('Already registered', 'This customer is already registered with this business. You can award points using their phone number or registered KONEK card.', 'info')
        return
      }
      setStep(result.exists ? 'existing' : 'new')
    }
  })
  const save = () => {
    if (step === 'existing') {
      if (source === 'nfc' && !/^\d{4}$/.test(pin)) {
        onAlert('Customer PIN required', 'Please hand the phone to the customer so they can enter their existing four-digit KONEK PIN to link this card.', 'warning')
        return
      }
      const customerPin = pin
      setPin('')
      void run(() => onSave({ kind: 'existing', phone, ...(source === 'nfc' ? { pin: customerPin } : {}) }))
      return
    }
    if (!firstName.trim() || !lastName.trim()) {
      onAlert(
        'Name required',
        'Enter the customer’s first and last name.',
        'warning'
      )
      return
    }

    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || email.trim().length > 320) {
      onAlert(
        'Valid email required',
        'Enter a valid customer email address.',
        'warning'
      )
      return
    }

    if (!/^639[0-9]{9}$/.test(normalizePhone(phone))) {
      onAlert(
        'Valid phone required',
        'Enter a valid customer phone number.',
        'warning'
      )
      return
    }

    if (!/^\d{4}$/.test(pin)) {
      onAlert(
        'Create a 4-digit PIN',
        'The customer PIN must contain exactly four numbers.',
        'warning'
      )
      return
    }

    if (pin !== confirmPin) {
      onAlert(
        'PINs do not match',
        'Enter the same 4-digit PIN in both fields.',
        'warning'
      )
      return
    }

    void run(() => onSave({
      kind: 'new',
      firstName,
      lastName,
      email,
      phone,
      pin,
    }))
  }

  return (
    <RequestStatusProvider value={pending ? step === 'phone' ? 'Checking account…' : 'Registering customer…' : ''}>
    <KeyboardModalContainer onClose={() => { if (!busy.current) onClose() }}>
      <View style={styles.successIcon}>
        <Ionicons
          name={
            source === 'nfc'
              ? 'wifi'
              : 'person-add-outline'
          }
          size={27}
          color={colors.dark}
        />
      </View>

      <Text style={styles.modalEyebrow}>
        {source === 'nfc'
          ? 'NEW KONEK CARD'
          : 'NEW LOYAL CUSTOMER'}
      </Text>

      <Text style={styles.modalTitle}>
        Register customer
      </Text>

      <Text style={styles.muted}>
        {step === 'phone' ? 'Enter the phone number to check for an existing KONEK account.' : step === 'new' ? 'Create a KONEK account. This phone number and PIN can be used across participating businesses.' : source === 'nfc' ? 'This phone number already has a KONEK account. The customer must confirm their existing PIN before this NFC card can be linked.' : 'A KONEK account already exists for this phone number. Register it with this business using the same account. No PIN is needed to join. The customer can view their memberships on the KONEK website.'}
      </Text>

      {source === 'nfc' && (
        <View style={styles.cardDetected}>
          <Ionicons
            name="card-outline"
            size={20}
            color={colors.dark}
          />

          <View style={{ flex: 1 }}>
            <Text style={styles.labelSmall}>
              KONEK CARD
            </Text>

            <Text
              style={styles.cardIdText}
              numberOfLines={1}
            >
              Card detected
            </Text>
          </View>

          <Ionicons
            name="checkmark-circle"
            size={21}
            color={colors.green}
          />
        </View>
      )}

      <Text style={styles.inputLabel}>
        Phone number
      </Text>

      <TextInput
        style={styles.input}
        value={phone}
        editable={step === 'phone' && !pending}
        onChangeText={setPhone}
        placeholder="0917 123 4567"
        placeholderTextColor="#98A49F"
        keyboardType="phone-pad"
        returnKeyType="next"
      />

      {step === 'phone' ? <Button title={pending ? 'Checking account…' : 'Continue'} disabled={pending} onPress={lookup} /> : <Button title="Change phone number" variant="secondary" disabled={pending} onPress={() => { setStep('phone'); setPin(''); setConfirmPin('') }} />}
      {step === 'new' && <>
      <View style={styles.twoFields}>
        <View style={{ flex: 1 }}>
          <Text style={styles.inputLabel}>
            First name
          </Text>

          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Juan"
            placeholderTextColor="#98A49F"
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.inputLabel}>
            Last name
          </Text>

          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Dela Cruz"
            placeholderTextColor="#98A49F"
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>
      </View>

      <Text style={styles.inputLabel}>
        Email
      </Text>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="juan@email.com"
        placeholderTextColor="#98A49F"
        keyboardType="email-address"
        autoCapitalize="none"
        returnKeyType="next"
      />

      </>}
      {(step === 'new' || (step === 'existing' && source === 'nfc')) && <>
      <View style={styles.pinIntro}>
        <Ionicons
          name="shield-checkmark-outline"
          size={20}
          color={colors.dark}
        />

        <View style={{ flex: 1 }}>
          <Text style={styles.pinIntroTitle}>
            Customer security PIN
          </Text>

          <Text style={styles.pinIntroText}>
            {step === 'new'
              ? 'Please hand the phone to the customer so they can create and confirm their four-digit KONEK PIN privately.'
              : 'Please hand the phone to the customer so they can enter their existing four-digit KONEK PIN privately.'}
            {' '}One PIN works across participating businesses.
          </Text>
        </View>
      </View>

      <Text style={styles.inputLabel}>
        {step === 'new' ? 'Create KONEK PIN' : 'Existing KONEK PIN'}
      </Text>

      <TextInput
        style={[styles.input, styles.pinInput]}
        value={pin}
        onChangeText={(value) =>
          setPin(
            value
              .replace(/\D/g, '')
              .slice(0, 4)
          )
        }
        placeholder="••••"
        placeholderTextColor="#98A49F"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
      />

      {step === 'new' && <>
      <Text style={styles.inputLabel}>
        Confirm PIN
      </Text>

      <TextInput
        style={[styles.input, styles.pinInput]}
        value={confirmPin}
        onChangeText={(value) =>
          setConfirmPin(
            value
              .replace(/\D/g, '')
              .slice(0, 4)
          )
        }
        placeholder="••••"
        placeholderTextColor="#98A49F"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
      />

      </>}
      {step === 'new' && <View style={{ marginTop: 4 }}>
        <Button
          title={pending ? 'Registering…' : 'Register customer'}
          disabled={pending}
          onPress={save}
        />
      </View>}
      </>}
      {step === 'existing' && <Button title={pending ? 'Registering…' : 'Register with this business'} disabled={pending} onPress={save} />}
    </KeyboardModalContainer>
    </RequestStatusProvider>
  )
}


/* =========================================================
   GIVE POINTS FLOW
   ========================================================= */

function CustomerFlowModal({
  posPurchase,
  stage,
  amountPerPoint,
  customer,
  purchase,
  setPurchase,
  onFindPhone,
  onVerifyPin,
  onFinish,
  onCheckoutBusy,
  onClose,
}: {
  posPurchase?:PosPurchase|null
  stage:
    CustomerFlowStage

  amountPerPoint: number

  customer:
    Customer | null

  purchase: string

  setPurchase:
    (
      value: string
    ) => void

  onFindPhone:
    (
      phone: string
    ) => void

  onVerifyPin:
    (
      pin: string
    ) => void

  onCheckoutBusy: (active: boolean) => void

  onFinish:
    (result: CheckoutResult) => void

  onClose:
    () => void
}) {
  return (
    <Modal
      transparent

      visible={
        stage !== null
      }

      animationType="slide"

      statusBarTranslucent

      onRequestClose={
        onClose
      }
    >
      {stage ===
        'phoneLookup' ? (
        <PhoneLookupView
          title="Give points by phone"

          description="Enter the customer’s registered phone number."

          onSearch={
            onFindPhone
          }

          onClose={
            onClose
          }
        />
      ) : stage ===
          'pin' &&
        customer ? (
        <PinVerificationView
          customer={
            customer
          }

          action="points"

          onVerify={
            onVerifyPin
          }

          onClose={
            onClose
          }
        />
      ) : stage ===
          'points' &&
        customer ? (
        <PointsView
          posPurchase={posPurchase}
          onCheckoutBusy={onCheckoutBusy}
          amountPerPoint={amountPerPoint}
          customer={
            customer
          }

          purchase={
            purchase
          }

          setPurchase={
            setPurchase
          }

          onFinish={
            onFinish
          }

          onClose={
            onClose
          }
        />
      ) : null}
    </Modal>
  )
}


/* =========================================================
   PHONE LOOKUP
   ========================================================= */

function PhoneLookupView({
  title,
  description,
  onSearch,
  onClose,
}: {
  title: string
  description: string

  onSearch:
    (
      phone: string
    ) => void

  onClose:
    () => void
}) {
  const [phone, setPhone] = useState('')

  return (
    <KeyboardModalContainer onClose={onClose}>
      <View style={styles.phoneIcon}>
        <Ionicons
          name="call-outline"
          size={27}
          color={colors.dark}
        />
      </View>

      <Text style={styles.modalEyebrow}>
        PHONE VERIFICATION
      </Text>

      <Text style={styles.modalTitle}>
        {title}
      </Text>

      <Text style={styles.muted}>
        {description}
      </Text>

      <Text style={styles.inputLabel}>
        Phone number
      </Text>

      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="0917 123 4567"
        placeholderTextColor="#98A49F"
        keyboardType="phone-pad"
        autoFocus
      />

      <Button
        title="Continue"
        onPress={() => onSearch(phone)}
      />
    </KeyboardModalContainer>
  )
}


/* =========================================================
   PIN VERIFICATION
   ========================================================= */

function PinVerificationView({
  customer,
  action,
  onVerify,
  onClose,
}: {
  customer: Customer

  action:
    CustomerAction

  onVerify:
    (
      pin: string
    ) => void

  onClose:
    () => void
}) {
  const [pin, setPin] = useState('')

  return (
    <KeyboardModalContainer onClose={onClose}>
      <View style={styles.pinHeroIcon}>
        <Ionicons
          name="lock-closed-outline"
          size={28}
          color={colors.dark}
        />
      </View>

      <Text style={styles.modalEyebrow}>
        CUSTOMER VERIFICATION
      </Text>

      <Text style={styles.modalTitle}>
        Enter your PIN
      </Text>

      <Text style={styles.muted}>
        Please hand the device to{' '}
        <Text style={styles.inlineStrong}>
          {customer.firstName}
        </Text>{' '}
        to enter their 4-digit loyalty PIN.
      </Text>

      <View style={styles.privatePinCard}>
        <Ionicons
          name="shield-checkmark-outline"
          size={20}
          color={colors.dark}
        />

        <View style={{ flex: 1 }}>
          <Text style={styles.privatePinTitle}>
            Private verification
          </Text>

          <Text style={styles.privatePinText}>
            The customer should enter this PIN themselves.
          </Text>
        </View>
      </View>

      <TextInput
        style={styles.customerPinInput}
        value={pin}
        onChangeText={(value) =>
          setPin(
            value
              .replace(/\D/g, '')
              .slice(0, 4)
          )
        }
        placeholder="••••"
        placeholderTextColor="#98A49F"
        secureTextEntry
        keyboardType="number-pad"
        maxLength={4}
        autoFocus
      />

      <Text style={styles.pinActionHint}>
        {action === 'points'
          ? 'Verify your PIN to continue earning points using your phone number.'
          : 'Verify your PIN to continue redeeming this reward.'}
      </Text>

      <Button
        title="Verify PIN"
        onPress={() => onVerify(pin)}
      />
    </KeyboardModalContainer>
  )
}


/* =========================================================
   POINTS
   ========================================================= */

function PointsView({
  posPurchase,
  amountPerPoint,
  customer,
  purchase,
  setPurchase,
  onFinish,
  onCheckoutBusy,
  onClose,
}: {
  posPurchase?:PosPurchase|null
  amountPerPoint: number

  customer: Customer

  purchase: string

  setPurchase:
    (
      value: string
    ) => void

  onCheckoutBusy: (active: boolean) => void

  onFinish:
    (result: CheckoutResult) => void

  onClose:
    () => void
}) {
  const processing = useRequestStatus()

  return (
    <KeyboardModalContainer onClose={onClose}>
      <CustomerHero
        customer={customer}
        verified
      />

      <View style={styles.balanceCard}>
        <Text style={styles.labelSmall}>
          AVAILABLE POINTS
        </Text>

        <Text style={styles.balanceValue}>
          {getAvailablePoints(customer).toLocaleString()} pts
        </Text>
      </View>

      <Text style={styles.inputLabel}>
        {posPurchase ? "Paid POS total (verified)" : "Order total before discount"}
      </Text>

      <TextInput
        style={styles.purchaseInput}
        value={purchase}
        onChangeText={setPurchase}
        placeholder="₱0.00"
        placeholderTextColor="#98A49F"
        keyboardType="decimal-pad"
        editable={!processing&&!posPurchase}
        autoFocus
      />

      <CheckoutPanel posPurchase={posPurchase} customerId={customer.id} amount={purchase} onComplete={onFinish} onBusy={onCheckoutBusy} />
    </KeyboardModalContainer>
  )
}


/* =========================================================
   CUSTOMER DETAILS
   ========================================================= */

function CustomerDetailsModal({
  customer,
  stage,
  nfcState,
  onClose,
  onLink,
  onPinConfirm,
  onReplace,
  onReplaceConfirm,
  onReplaceCancel,
  onRetry,
}: {
  customer:
    Customer | null

  stage:
    CustomerDetailStage

  nfcState:
    string

  onClose:
    () => void

  onLink:
    () => void

  onPinConfirm: (pin: string) => Promise<void>

  onReplace:
    () => void

  onReplaceConfirm:
    () => void

  onReplaceCancel:
    () => void

  onRetry:
    () => void
}) {
  return (
    <Modal
      transparent

      visible={
        customer !== null
      }

      animationType="slide"

      statusBarTranslucent

      onRequestClose={
        onClose
      }
    >
      {!customer ? null :
        stage === 'cardPin' ? (
          <CustomerCardPinView customer={customer} onConfirm={onPinConfirm} onClose={onClose} />
        ) : stage ===
          'linking' ? (
          <LinkNfcView
            customer={
              customer
            }

            state={
              nfcState
            }

            onRetry={
              onRetry
            }

            onClose={
              onClose
            }
          />
        ) :
        stage ===
          'replaceConfirm' ? (
          <ReplaceNfcView
            customer={
              customer
            }

            onConfirm={
              onReplaceConfirm
            }

            onCancel={
              onReplaceCancel
            }

            onClose={
              onClose
            }
          />
        ) : (
          <CustomerDetailView
            customer={
              customer
            }

            onLink={
              onLink
            }

            onReplace={
              onReplace
            }

            onClose={
              onClose
            }
          />
        )}
    </Modal>
  )
}


/* =========================================================
   CUSTOMER DETAIL
   ========================================================= */

function CustomerDetailView({
  customer,
  onLink,
  onReplace,
  onClose,
}: {
  customer: Customer

  onLink:
    () => void

  onReplace:
    () => void

  onClose:
    () => void
}) {
  const available =
    getAvailablePoints(
      customer
    )


  return (
    <View
      style={
        styles.modalBackdrop
      }
    >
      <View
        style={
          styles.modalCard
        }
      >
        <ModalHeader
          onClose={
            onClose
          }
        />


        <ScrollView
          bounces={false}
          overScrollMode="never"
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={true}
          persistentScrollbar
          indicatorStyle="black"

          contentContainerStyle={
            styles.modalScroll
          }
        >
          <View
            style={
              styles.detailHero
            }
          >
            <View
              style={[
                styles.detailAvatar,

                {
                  backgroundColor:
                    customer.color,
                },
              ]}
            >
              <Text
                style={
                  styles.detailAvatarText
                }
              >
                {
                  customer
                    .firstName[0]
                }

                {
                  customer
                    .lastName[0]
                }
              </Text>
            </View>

            <Text
              style={
                styles.detailCustomerName
              }
            >
              {
                customer.firstName
              }{' '}
              {
                customer.lastName
              }
            </Text>

            <Text
              style={
                styles.detailSubtitle
              }
            >
              Loyal customer
            </Text>
          </View>


          <View
            style={
              styles.detailBalanceCard
            }
          >
            <View
              style={
                styles.detailBalanceIcon
              }
            >
              <Ionicons
                name="sparkles"

                size={20}

                color={
                  colors.dark
                }
              />
            </View>

            <View>
              <Text
                style={
                  styles.labelSmall
                }
              >
                AVAILABLE POINTS
              </Text>

              <Text
                style={
                  styles.detailBalanceValue
                }
              >
                {
                  available.toLocaleString()
                }{' '}
                pts
              </Text>
            </View>
          </View>


          <View
            style={
              styles.detailStats
            }
          >
            <DetailStat
              label="Lifetime earned"

              value={
                customer.totalPoints.toLocaleString()
              }
            />

            <View
              style={
                styles.detailStatDivider
              }
            />

            <DetailStat
              label="Lifetime redeemed"

              value={
                customer.totalRedeemed.toLocaleString()
              }
            />

            <View
              style={
                styles.detailStatDivider
              }
            />

            <DetailStat
              label="Times earned"

              value={
                String(
                  customer.timesEarned
                )
              }
            />
          </View>


          <View
            style={
              styles.nfcDetailSection
            }
          >
            <Text
              style={
                styles.detailSectionTitle
              }
            >
              KONEK card
            </Text>


            <View
              style={
                styles.nfcStatusCard
              }
            >
              <View
                style={[
                  styles.nfcStatusIcon,

                  customer.nfcCardId
                    ? styles.nfcStatusLinked
                    : styles.nfcStatusUnlinked,
                ]}
              >
                <Ionicons
                  name={
                    customer.nfcCardId
                      ? 'wifi'
                      : 'card-outline'
                  }

                  size={22}

                  color={
                    colors.dark
                  }
                />
              </View>


              <View
                style={{
                  flex: 1,
                }}
              >
                <Text
                  style={
                    styles.nfcStatusTitle
                  }
                >
                  {customer.nfcCardId
                    ? 'KONEK card linked'
                    : 'No KONEK card linked'}
                </Text>

                <Text
                  style={
                    styles.nfcStatusDescription
                  }
                >
                  {customer.nfcCardId
                    ? 'This customer can simply tap their card at checkout.'
                    : 'Link a card for faster identification and checkout.'}
                </Text>
              </View>


              {customer.nfcCardId && (
                <Ionicons
                  name="checkmark-circle"

                  size={23}

                  color={
                    colors.green
                  }
                />
              )}
            </View>


            {customer.nfcCardId ? (
              <Pressable
                style={
                  styles.secondaryActionButton
                }

                onPress={
                  onReplace
                }
              >
                <Ionicons
                  name="refresh-outline"

                  size={18}

                  color={
                    colors.dark
                  }
                />

                <Text
                  style={
                    styles.secondaryActionText
                  }
                >
                  Replace KONEK card
                </Text>
              </Pressable>
            ) : (
              <Pressable
                style={
                  styles.primaryButton
                }

                onPress={
                  onLink
                }
              >
                <Ionicons
                  name="wifi"

                  size={19}

                  color={
                    colors.ink
                  }
                />

                <Text
                  style={
                    styles.primaryButtonText
                  }
                >
                  Link KONEK card
                </Text>
              </Pressable>
            )}
          </View>


          <Text
            style={
              styles.privacyNote
            }
          >
            Contact information and
            security PIN are hidden.
          </Text>
        </ScrollView>
      </View>
    </View>
  )
}


/* =========================================================
   DETAIL STAT
   ========================================================= */

function DetailStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <View
      style={
        styles.detailStat
      }
    >
      <Text
        style={
          styles.detailStatLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.detailStatValue
        }
      >
        {value}
      </Text>
    </View>
  )
}


/* =========================================================
   LINK NFC
   ========================================================= */

function CustomerCardPinView({ customer, onConfirm, onClose }: { customer: Customer; onConfirm: (pin: string) => Promise<void>; onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const confirm = async () => {
    if (locked.current || !/^\d{4}$/.test(pin)) return
    locked.current = true; setPending(true)
    const value = pin; setPin(''); Keyboard.dismiss()
    try { await onConfirm(value) } finally { locked.current = false; setPending(false) }
  }
  return <KeyboardModalContainer onClose={() => { if (!locked.current) onClose() }}>
    <Text style={styles.modalEyebrow}>CUSTOMER CONFIRMATION</Text>
    <Text style={styles.modalTitle}>{customer.nfcCardId ? 'Confirm card replacement' : 'Confirm NFC card link'}</Text>
    <Text style={styles.muted}>Please hand the phone to {customer.firstName} so they can enter their four-digit KONEK PIN privately. The card will only be linked after their PIN is verified.</Text>
    <Text style={styles.inputLabel}>Customer PIN</Text>
    <TextInput accessibilityLabel="Customer PIN for NFC card" style={[styles.input, styles.pinInput]} secureTextEntry keyboardType="number-pad" autoComplete="off" maxLength={4} value={pin} editable={!pending} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 4))} placeholder="Four-digit PIN" placeholderTextColor="#98A49F" />
    <Button title={pending ? 'Verifying & linking…' : 'Confirm & link card'} loading={pending} disabled={!/^\d{4}$/.test(pin)} onPress={() => void confirm()} />
  </KeyboardModalContainer>
}

function LinkNfcView({
  customer,
  state,
  onRetry,
  onClose,
}: {
  customer: Customer
  state: string
  onRetry: () => void
  onClose: () => void
}) {
  return (
    <View
      style={
        styles.modalBackdrop
      }
    >
      <View
        style={
          styles.modalCard
        }
      >
        <ModalHeader
          onClose={
            onClose
          }
        />


        <View
          style={
            styles.bigNfc
          }
        >
          <Ionicons
            name="wifi"

            size={42}

            color={
              colors.ink
            }
          />
        </View>


        <Text
          style={
            styles.modalEyebrow
          }
        >
          LINK KONEK CARD
        </Text>


        <Text
          style={
            styles.modalTitle
          }
        >
          {state ===
          'error'
            ? 'Unable to read card'
            : state ===
                'detected'
              ? 'Card detected'
              : 'Tap the KONEK card'}
        </Text>


        <Text
          style={
            styles.muted
          }
        >
          The card will be linked to{' '}

          <Text
            style={
              styles.inlineStrong
            }
          >
            {
              customer.firstName
            }{' '}
            {
              customer.lastName
            }
          </Text>
          .
        </Text>


        {state ===
        'error' ? (
          <Button
            title="Try again"

            onPress={
              onRetry
            }
          />
        ) : (
          <View
            style={
              styles.waitingCard
            }
          >
            <View
              style={
                styles.statusDot
              }
            />

            <Text
              style={
                styles.statusText
              }
            >
              Waiting for NFC card
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}


/* =========================================================
   REPLACE NFC
   ========================================================= */

function ReplaceNfcView({
  customer,
  onConfirm,
  onCancel,
  onClose,
}: {
  customer: Customer

  onConfirm:
    () => void

  onCancel:
    () => void

  onClose:
    () => void
}) {
  return (
    <View
      style={
        styles.modalBackdrop
      }
    >
      <View
        style={
          styles.modalCard
        }
      >
        <ModalHeader
          onClose={
            onClose
          }
        />


        <View
          style={
            styles.warningLargeIcon
          }
        >
          <Ionicons
            name="refresh-outline"

            size={28}

            color="#9B6B00"
          />
        </View>


        <Text
          style={
            styles.modalEyebrow
          }
        >
          KONEK CARD
        </Text>


        <Text
          style={
            styles.modalTitle
          }
        >
          Replace card?
        </Text>


        <Text
          style={
            styles.muted
          }
        >
          The current card linked to{' '}

          <Text
            style={
              styles.inlineStrong
            }
          >
            {
              customer.firstName
            }{' '}
            {
              customer.lastName
            }
          </Text>

          {' '}will stop identifying
          this customer after the new
          card is linked.
        </Text>


        <Pressable
          style={
            styles.primaryButton
          }

          onPress={
            onConfirm
          }
        >
          <Ionicons
            name="wifi"

            size={19}

            color={
              colors.ink
            }
          />

          <Text
            style={
              styles.primaryButtonText
            }
          >
            Scan new card
          </Text>
        </Pressable>


        <Pressable
          style={
            styles.cancelButton
          }

          onPress={
            onCancel
          }
        >
          <Text
            style={
              styles.cancelButtonText
            }
          >
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  )
}


/* =========================================================
   REWARDS PAGE
   ========================================================= */

function RewardsPage({
  onScanReward,
  rewards,
  onRewardPress,
}: {
  onScanReward: () => void
  rewards: Reward[]

  onRewardPress:
    (
      reward: Reward
    ) => void
}) {
  const [
    query,
    setQuery,
  ] =
    useState('')


  const filtered =
    useMemo(() => {
      const search =
        query
          .toLowerCase()
          .trim()


      return rewards.filter(
        (reward) =>
          reward.name
            .toLowerCase()
            .includes(
              search
            ) ||

          reward.description
            .toLowerCase()
            .includes(
              search
            )
      )
    }, [
      rewards,
      query,
    ])


  return (
    <>
      <Text
        style={
          styles.eyebrow
        }
      >
        LOYALTY REWARDS
      </Text>


      <Text
        style={
          styles.title
        }
      >
        Rewards
      </Text>


      <Text
        style={
          styles.muted
        }
      >
        Browse rewards customers
        can redeem using their
        loyalty points.
      </Text>

      <ClaimScannerButton onPress={onScanReward} />


      <SearchBox
        value={
          query
        }

        onChangeText={
          setQuery
        }

        placeholder="Search rewards..."
      />


      <View
        style={
          styles.rewardGrid
        }
      >
        {filtered.map(
          (
            reward
          ) => (
            <RewardCard
              key={
                reward.id
              }

              reward={
                reward
              }

              onPress={() =>
                onRewardPress(
                  reward
                )
              }
            />
          )
        )}
      </View>
    </>
  )
}


/* =========================================================
   REWARD CARD
   ========================================================= */

function RewardCard({
  reward,
  onPress,
}: {
  reward: Reward
  onPress: () => void
}) {
  const outOfStock =
    reward.stock !==
      undefined &&
    reward.stock <= 0


  return (
    <Pressable
      style={[
        styles.rewardImageCard,

        outOfStock && {
          opacity: 0.5,
        },
      ]}

      onPress={
        onPress
      }

      disabled={
        outOfStock
      }
    >
      <Image
        source={{
          uri:
            reward.imageUrl,
        }}

        style={
          styles.rewardImage
        }

        resizeMode="cover"
      />


      <View
        style={
          styles.rewardContent
        }
      >
        <Text
          style={
            styles.rewardName
          }
        >
          {
            reward.name
          }
        </Text>


        <Text
          style={
            styles.rewardDescription
          }

          numberOfLines={2}
        >
          {
            reward.description
          }
        </Text>


        <View
          style={
            styles.rewardMeta
          }
        >
          <View
            style={
              styles.rewardPointsBadge
            }
          >
            <Ionicons
              name="sparkles"

              size={12}

              color={
                colors.dark
              }
            />

            <Text
              style={
                styles.rewardPointsText
              }
            >
              {
                reward.pointsCost.toLocaleString()
              }{' '}
              pts
            </Text>
          </View>


          {reward.stock !==
            undefined && (
            <Text
              style={
                styles.rewardStock
              }
            >
              {outOfStock
                ? 'Out of stock'
                : `${reward.stock} left`}
            </Text>
          )}
        </View>


        {!outOfStock && (
          <View
            style={
              styles.redeemLink
            }
          >
            <Text
              style={
                styles.redeemLinkText
              }
            >
              Redeem
            </Text>

            <Ionicons
              name="arrow-forward"

              size={15}

              color={
                colors.dark
              }
            />
          </View>
        )}
      </View>
    </Pressable>
  )
}


/* =========================================================
   REWARD FLOW
   ========================================================= */

function RewardFlowModal({
  stage,
  reward,
  customer,
  quantity,
  setQuantity,
  nfcState,
  onUseNfc,
  onUsePhone,
  onFindPhone,
  onVerifyPin,
  onRetry,
  onRedeem,
  onClose,
}: {
  stage:
    RedemptionStage

  reward:
    Reward | null

  customer:
    Customer | null

  quantity: number

  setQuantity:
    (
      value: number
    ) => void

  nfcState: string

  onUseNfc:
    () => void

  onUsePhone:
    () => void

  onFindPhone:
    (
      phone: string
    ) => void

  onVerifyPin:
    (
      pin: string
    ) => void

  onRetry:
    () => void

  onRedeem:
    () => void

  onClose:
    () => void
}) {
  return (
    <Modal
      transparent

      visible={
        stage !== null
      }

      animationType="slide"

      statusBarTranslucent

      onRequestClose={
        onClose
      }
    >
      {stage ===
        'setup' &&
      reward ? (
        <RewardSetupView
          reward={
            reward
          }

          quantity={
            quantity
          }

          setQuantity={
            setQuantity
          }

          onUseNfc={
            onUseNfc
          }

          onUsePhone={
            onUsePhone
          }

          onClose={
            onClose
          }
        />
      ) :
      stage ===
        'scanning' ? (
        <RewardNfcView
          state={
            nfcState
          }

          onRetry={
            onRetry
          }

          onClose={
            onClose
          }
        />
      ) :
      stage ===
        'phoneLookup' ? (
        <PhoneLookupView
          title="Redeem by phone"

          description="Enter the customer’s registered phone number."

          onSearch={
            onFindPhone
          }

          onClose={
            onClose
          }
        />
      ) :
      stage ===
        'pin' &&
      customer ? (
        <PinVerificationView
          customer={
            customer
          }

          action="redeem"

          onVerify={
            onVerifyPin
          }

          onClose={
            onClose
          }
        />
      ) :
      stage ===
        'confirm' &&
      reward &&
      customer ? (
        <RewardConfirmationView
          reward={
            reward
          }

          customer={
            customer
          }

          quantity={
            quantity
          }

          onRedeem={
            onRedeem
          }

          onClose={
            onClose
          }
        />
      ) : null}
    </Modal>
  )
}


/* =========================================================
   REWARD SETUP
   ========================================================= */

function RewardSetupView({
  reward,
  quantity,
  setQuantity,
  onUseNfc,
  onUsePhone,
  onClose,
}: {
  reward: Reward

  quantity: number

  setQuantity:
    (
      value: number
    ) => void

  onUseNfc:
    () => void

  onUsePhone:
    () => void

  onClose:
    () => void
}) {
  const total =
    reward.pointsCost *
    quantity

  const max =
    reward.stock ?? 99


  return (
    <View
      style={
        styles.modalBackdrop
      }
    >
      <View
        style={
          styles.modalCard
        }
      >
        <ModalHeader
          onClose={
            onClose
          }
        />


        <ScrollView
          bounces={false}
          overScrollMode="never"
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={true}
          persistentScrollbar
          indicatorStyle="black"

          contentContainerStyle={
            styles.modalScroll
          }
        >
          <Image
            source={{
              uri:
                reward.imageUrl,
            }}

            style={
              styles.rewardModalImage
            }

            resizeMode="cover"
          />


          <Text
            style={
              styles.modalEyebrow
            }
          >
            REDEEM REWARD
          </Text>


          <Text
            style={
              styles.modalTitle
            }
          >
            {
              reward.name
            }
          </Text>


          <Text
            style={
              styles.muted
            }
          >
            {
              reward.description
            }
          </Text>


          <View
            style={
              styles.unitPointsCard
            }
          >
            <Text
              style={
                styles.labelSmall
              }
            >
              POINTS PER ITEM
            </Text>

            <Text
              style={
                styles.unitPointsValue
              }
            >
              {
                reward.pointsCost.toLocaleString()
              }{' '}
              pts
            </Text>
          </View>


          <Text
            style={
              styles.inputLabel
            }
          >
            Quantity
          </Text>


          <View
            style={
              styles.quantityRow
            }
          >
            <Pressable
              style={
                styles.quantityButton
              }

              onPress={() =>
                setQuantity(
                  Math.max(
                    1,
                    quantity - 1
                  )
                )
              }
            >
              <Ionicons
                name="remove"

                size={22}

                color={
                  colors.ink
                }
              />
            </Pressable>


            <View
              style={
                styles.quantityValue
              }
            >
              <Text
                style={
                  styles.quantityText
                }
              >
                {quantity}
              </Text>
            </View>


            <Pressable
              style={
                styles.quantityButton
              }

              onPress={() =>
                setQuantity(
                  Math.min(
                    max,
                    quantity + 1
                  )
                )
              }
            >
              <Ionicons
                name="add"

                size={22}

                color={
                  colors.ink
                }
              />
            </Pressable>
          </View>


          <View
            style={
              styles.rewardTotal
            }
          >
            <View>
              <Text
                style={
                  styles.labelSmall
                }
              >
                TOTAL
              </Text>

              <Text
                style={
                  styles.smallMuted
                }
              >
                {
                  reward.pointsCost.toLocaleString()
                }{' '}
                pts × {quantity}
              </Text>
            </View>

            <Text
              style={
                styles.rewardTotalValue
              }
            >
              {
                total.toLocaleString()
              }{' '}
              pts
            </Text>
          </View>


          {/* PRIMARY NFC */}

          <Pressable
            style={
              styles.primaryButton
            }

            onPress={
              onUseNfc
            }
          >
            <Ionicons
              name="wifi"

              size={20}

              color={
                colors.ink
              }
            />

            <Text
              style={
                styles.primaryButtonText
              }
            >
              Tap KONEK card
            </Text>
          </Pressable>


          <View
            style={
              styles.orRow
            }
          >
            <View
              style={
                styles.orLine
              }
            />

            <Text
              style={
                styles.orText
              }
            >
              or
            </Text>

            <View
              style={
                styles.orLine
              }
            />
          </View>


          {/* PHONE FALLBACK */}

          <Pressable
            style={
              styles.secondaryActionButton
            }

            onPress={
              onUsePhone
            }
          >
            <Ionicons
              name="call-outline"

              size={18}

              color={
                colors.dark
              }
            />

            <Text
              style={
                styles.secondaryActionText
              }
            >
              Use phone number instead
            </Text>
          </Pressable>


          <View
            style={
              styles.konekAdvantage
            }
          >
            <Ionicons
              name="flash-outline"

              size={17}

              color={
                colors.dark
              }
            />

            <Text
              style={
                styles.konekAdvantageText
              }
            >
              KONEK cards are faster —
              simply tap and continue.
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  )
}


/* =========================================================
   REWARD NFC
   ========================================================= */

function RewardNfcView({
  state,
  onRetry,
  onClose,
}: {
  state: string
  onRetry: () => void
  onClose: () => void
}) {
  return (
    <View
      style={
        styles.modalBackdrop
      }
    >
      <View
        style={
          styles.modalCard
        }
      >
        <ModalHeader
          onClose={
            onClose
          }
        />


        <View
          style={
            styles.bigNfc
          }
        >
          <Ionicons
            name="wifi"

            size={42}

            color={
              colors.ink
            }
          />
        </View>


        <Text
          style={
            styles.modalEyebrow
          }
        >
          KONEK CARD
        </Text>


        <Text
          style={
            styles.modalTitle
          }
        >
          {state ===
          'error'
            ? 'Unable to read card'
            : state ===
                'detected'
              ? 'Customer identified'
              : 'Tap customer card'}
        </Text>


        <Text
          style={
            styles.muted
          }
        >
          Ask the customer to tap
          their KONEK loyalty card.
        </Text>


        {state ===
        'error' ? (
          <Button
            title="Try again"

            onPress={
              onRetry
            }
          />
        ) : (
          <View
            style={
              styles.waitingCard
            }
          >
            <View
              style={
                styles.statusDot
              }
            />

            <Text
              style={
                styles.statusText
              }
            >
              Waiting for KONEK card
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}


/* =========================================================
   REWARD CONFIRMATION
   ========================================================= */

function RewardConfirmationView({
  reward,
  customer,
  quantity,
  onRedeem,
  onClose,
}: {
  reward: Reward
  customer: Customer
  quantity: number
  onRedeem: () => void
  onClose: () => void
}) {
  const available =
    getAvailablePoints(
      customer
    )

  const total =
    reward.pointsCost *
    quantity

  const remaining =
    available -
    total

  const canRedeem =
    remaining >= 0


  return (
    <View
      style={
        styles.modalBackdrop
      }
    >
      <View
        style={
          styles.modalCard
        }
      >
        <ModalHeader
          onClose={
            onClose
          }
        />


        <ScrollView
          bounces={false}
          overScrollMode="never"
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={true}
          persistentScrollbar
          indicatorStyle="black"
        >
          <CustomerHero
            customer={
              customer
            }

            verified
          />


          <View
            style={
              styles.balanceCard
            }
          >
            <Text
              style={
                styles.labelSmall
              }
            >
              AVAILABLE POINTS
            </Text>

            <Text
              style={
                styles.balanceValue
              }
            >
              {
                available.toLocaleString()
              }{' '}
              pts
            </Text>
          </View>


          <View
            style={
              styles.redemptionProduct
            }
          >
            <Image
              source={{
                uri:
                  reward.imageUrl,
              }}

              style={
                styles.redemptionImage
              }
              resizeMode="cover"
            />

            <View
              style={{
                flex: 1,
              }}
            >
              <Text
                style={
                  styles.cardTitle
                }
              >
                {
                  reward.name
                }
              </Text>

              <Text
                style={
                  styles.smallMuted
                }
              >
                {
                  reward.pointsCost.toLocaleString()
                }{' '}
                pts × {quantity}
              </Text>
            </View>
          </View>


          <View
            style={
              styles.rewardSummary
            }
          >
            <SummaryRow
              label="Quantity"

              value={
                String(
                  quantity
                )
              }
            />

            <SummaryRow
              label="Total points"

              value={`${total.toLocaleString()} pts`}
            />

            <SummaryRow
              label="Remaining"

              value={
                canRedeem
                  ? `${remaining.toLocaleString()} pts`
                  : 'Insufficient'
              }
            />
          </View>


          {!canRedeem && (
            <View
              style={
                styles.warningCard
              }
            >
              <Ionicons
                name="alert-circle-outline"

                size={20}

                color="#9B6B00"
              />

              <Text
                style={
                  styles.warningText
                }
              >
                Customer needs{' '}
                {
                  (
                    total -
                    available
                  ).toLocaleString()
                }{' '}
                more points.
              </Text>
            </View>
          )}


          <Pressable
            style={[
              styles.primaryButton,

              !canRedeem && {
                opacity: 0.4,
              },
            ]}

            disabled={
              !canRedeem
            }

            onPress={
              onRedeem
            }
          >
            <Ionicons
              name="gift-outline"

              size={19}

              color={
                colors.ink
              }
            />

            <Text
              style={
                styles.primaryButtonText
              }
            >
              Redeem reward
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  )
}


/* =========================================================
   CUSTOMER HERO
   ========================================================= */

function CustomerHero({
  customer,
  verified = false,
}: {
  customer: Customer
  verified?: boolean
}) {
  return (
    <View
      style={
        styles.customerHero
      }
    >
      <View
        style={[
          styles.largeAvatar,

          {
            backgroundColor:
              customer.color,
          },
        ]}
      >
        <Text
          style={
            styles.largeAvatarText
          }
        >
          {
            customer
              .firstName[0]
          }

          {
            customer
              .lastName[0]
          }
        </Text>
      </View>


      <View
        style={{
          flex: 1,
        }}
      >
        <Text
          style={
            styles.labelSmall
          }
        >
          LOYAL CUSTOMER
        </Text>

        <Text
          style={
            styles.customerModalName
          }
        >
          {
            customer.firstName
          }{' '}
          {
            customer.lastName
          }
        </Text>


        {verified && (
          <View
            style={
              styles.verifiedRow
            }
          >
            <Ionicons
              name="checkmark-circle"

              size={14}

              color={
                colors.green
              }
            />

            <Text
              style={
                styles.verifiedText
              }
            >
              Customer verified
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}


/* =========================================================
   CUSTOMERS
   ========================================================= */

function Customers({
  customers,
  onAdd,
  onCustomerPress,
}: {
  customers: Customer[]

  onAdd: () => void

  onCustomerPress:
    (
      customer: Customer
    ) => void
}) {
  const [
    query,
    setQuery,
  ] =
    useState('')


  const filtered =
    useMemo(() => {
      const value =
        query
          .toLowerCase()
          .trim()


      return customers.filter(
        (
          customer
        ) =>
          customer.firstName
            .toLowerCase()
            .includes(
              value
            ) ||

          customer.lastName
            .toLowerCase()
            .includes(
              value
            ) ||

          customer.phone.includes(
            value
          ) ||

          customer.email
            .toLowerCase()
            .includes(
              value
            )
      )
    }, [
      customers,
      query,
    ])


  return (
    <>
      <Text
        style={
          styles.eyebrow
        }
      >
        LOYALTY PROGRAM
      </Text>

      <Text
        style={
          styles.title
        }
      >
        Loyal customers
      </Text>

      <Text
        style={
          styles.muted
        }
      >
        Search and manage your
        loyal customers.
      </Text>


      <Button
        title="＋ Register customer"

        onPress={
          onAdd
        }
      />


      <SearchBox
        value={
          query
        }

        onChangeText={
          setQuery
        }

        placeholder="Search name, phone or email..."
      />


      {filtered.map(
        (
          customer
        ) => (
          <CustomerCard
            key={
              customer.id
            }

            customer={
              customer
            }

            onPress={() =>
              onCustomerPress(
                customer
              )
            }
          />
        )
      )}
    </>
  )
}


/* =========================================================
   CUSTOMER CARD
   ========================================================= */

function CustomerCard({
  customer,
  onPress,
}: {
  customer: Customer
  onPress: () => void
}) {
  return (
    <Pressable
      style={
        styles.customerCard
      }

      onPress={
        onPress
      }
    >
      <View
        style={[
          styles.customerAvatar,

          {
            backgroundColor:
              customer.color,
          },
        ]}
      >
        <Text
          style={
            styles.customerAvatarText
          }
        >
          {
            customer
              .firstName[0]
          }

          {
            customer
              .lastName[0]
          }
        </Text>
      </View>


      <View
        style={{
          flex: 1,
        }}
      >
        <Text
          style={
            styles.customerName
          }
        >
          {
            customer.firstName
          }{' '}
          {
            customer.lastName
          }
        </Text>

        <Text
          style={
            styles.smallMuted
          }
        >
          {
            getAvailablePoints(
              customer
            ).toLocaleString()
          }{' '}
          points available
        </Text>
      </View>


      <View
        style={
          styles.nfcBadge
        }
      >
        <Ionicons
          name={
            customer.nfcCardId
              ? 'wifi'
              : 'phone-portrait-outline'
          }

          size={14}

          color={
            colors.dark
          }
        />

        <Text
          style={
            styles.nfcBadgeText
          }
        >
          {customer.nfcCardId
            ? 'NFC'
            : 'Phone'}
        </Text>
      </View>


      <Ionicons
        name="chevron-forward"

        size={18}

        color={
          colors.muted
        }
      />
    </Pressable>
  )
}


/* =========================================================
   SEARCH
   ========================================================= */

function SearchBox({
  value,
  onChangeText,
  placeholder,
}: {
  value: string

  onChangeText:
    (
      value: string
    ) => void

  placeholder: string
}) {
  return (
    <View
      style={
        styles.searchBox
      }
    >
      <Ionicons
        name="search-outline"

        size={18}

        color={
          colors.muted
        }
      />

      <TextInput
        style={
          styles.searchInput
        }

        value={
          value
        }

        onChangeText={
          onChangeText
        }

        placeholder={
          placeholder
        }

        placeholderTextColor="#98A49F"
      />
    </View>
  )
}


/* =========================================================
   STAT
   ========================================================= */

function Stat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: any
}) {
  return (
    <View
      style={
        styles.stat
      }
    >
      <View
        style={
          styles.statIcon
        }
      >
        <Ionicons
          name={
            icon
          }

          size={18}

          color={
            colors.dark
          }
        />
      </View>

      <Text
        style={
          styles.statLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.statValue
        }
      >
        {value}
      </Text>
    </View>
  )
}


/* =========================================================
   SUMMARY
   ========================================================= */

function SummaryRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <View
      style={
        styles.summaryRow
      }
    >
      <Text
        style={
          styles.summaryLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.summaryValue
        }
      >
        {value}
      </Text>
    </View>
  )
}


/* =========================================================
   LOGIN
   ========================================================= */

function Login({
  onLogin,
  restoring,
}: {
  onLogin: (email: string, password: string) => Promise<void>
  restoring: boolean
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [forgotPassword, setForgotPassword] = useState(false)
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const signingInRef = useRef(false)
  const loginScroll = useRef<ScrollView>(null)
  const revealForm = useCallback(() => {
    loginScroll.current?.scrollToEnd({ animated: true })
  }, [])
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', revealForm)
    return () => subscription.remove()
  }, [revealForm])
  const signIn = async () => {
    if (signingInRef.current || restoring) return
    signingInRef.current = true
    setSigningIn(true)
    try { await onLogin(email, password); setPassword('') }
    catch (error) { setError(error instanceof Error ? error.message : 'Sign in failed.') }
    finally { signingInRef.current = false; setSigningIn(false) }
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={
          styles.safe
        }
      >
        <StatusBar
          style="light"
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={
            styles.login
          }
        >
          <ScrollView
            ref={loginScroll}
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            onLayout={() => { if (Keyboard.isVisible()) revealForm() }}
          >
          <View
            style={
              styles.loginBrand
            }
          >
            <Logo inverse />

            <View
              style={
                styles.loginCopy
              }
            >
              <Text
                style={
                  styles.eyebrowLight
                }
              >
                KONEK LOYALTY
              </Text>

              <Text
                style={
                  styles.loginTitle
                }
              >
                Every visit
                {'\n'}

                <Text
                  style={{
                    color:
                      colors.green,
                  }}
                >
                  counts.
                </Text>
              </Text>
            </View>
          </View>


          <View
            style={
              styles.loginForm
            }
          >
            <Text
              style={
                styles.title
              }
            >
              Welcome back.
            </Text>

            <Field
              label="Work email"

              placeholder="you@business.com"

              value={email}
              onChangeText={setEmail}
              onFocus={revealForm}
            />

            <Field
              label="Password"

              placeholder="Password"

              value={password}
              onChangeText={setPassword}
              onFocus={revealForm}

              secure
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
              disabled={restoring || signingIn}
              onPress={() => { Keyboard.dismiss(); setForgotPassword(true) }}
              style={{ alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
            >
              <Text style={{ color: colors.dark, fontWeight: '700', textDecorationLine: 'underline' }}>Forgot password?</Text>
            </Pressable>
            <Button
              title={restoring ? "Signing you in…" : signingIn ? "Signing in…" : "Sign in"}
              loading={signingIn || restoring}
              disabled={signingIn || restoring}

              onPress={
                signIn
              }
            />
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      {forgotPassword && <ForgotPasswordModal initialEmail={email} onClose={() => { Keyboard.dismiss(); setForgotPassword(false) }} />}
      <ProfessionalAlertModal visible={!!error} title="Sign in failed" message={error} type="error" onClose={() => setError('')} />
    </SafeAreaProvider>
  )
}


function ForgotPasswordModal({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const locked = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    if (!retryAt) return
    const tick = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [retryAt])
  const close = () => { if (!locked.current) onClose() }
  const send = async () => {
    if (locked.current || Date.now() < retryAt) return
    locked.current = true; setPending(true); setError('')
    try {
      await auth.requestPasswordReset(email)
      if (!alive.current) return
      Keyboard.dismiss()
      setEmail(email.trim().toLowerCase()); setSent(true); setRetryAt(Date.now() + 60_000)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Please try again shortly.')
    } finally {
      locked.current = false
      if (alive.current) setPending(false)
    }
  }
  return <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={close}>
    <KeyboardModalContainer onClose={close}>
      <View style={styles.phoneIcon}><Ionicons name={sent ? 'mail-open-outline' : 'lock-closed-outline'} size={27} color={colors.dark} /></View>
      <Text style={styles.modalEyebrow}>ACCOUNT RECOVERY</Text>
      <Text style={styles.modalTitle}>{sent ? 'Check your inbox' : 'Forgot your password?'}</Text>
      <Text style={styles.muted}>{sent ? `We sent a reset link to ${email}. Check your spam or junk folder too. Open the email to choose a new password on konekdigital.com, then return here to sign in.` : 'Enter the email for your KONEK staff account. We’ll send a link to securely reset your password on the KONEK website.'}</Text>
      {!sent && <Field label="Work email" placeholder="you@business.com" value={email} onChangeText={value => { if (!locked.current) setEmail(value) }} />}
      {!!error && <Text accessibilityLiveRegion="polite" style={{ color: '#B42318', lineHeight: 22, marginTop: 12 }}>{error}</Text>}
      <View style={{ gap: 12, marginTop: 20 }}>
        <Button title={remaining > 0 ? `Resend link in ${remaining}s` : sent ? 'Resend reset link' : 'Send reset link'} loading={pending} disabled={pending || remaining > 0} onPress={() => void send()} />
        {sent && <Button title="Use a different email" variant="secondary" disabled={pending} onPress={() => { setSent(false); setError('') }} />}
        <Button title="Back to sign in" variant="secondary" disabled={pending} onPress={close} />
      </View>
    </KeyboardModalContainer>
  </Modal>
}


/* =========================================================
   HEADER
   ========================================================= */

function Header({
  initials,
  onAccount,
}: {
  initials: string
  onAccount: () => void
}) {
  return (
    <View
      style={
        styles.header
      }
    >
      <Logo />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open account menu"
        onPress={
          onAccount
        }
      >
        <View
          style={
            styles.avatar
          }
        >
          <Text
            style={
              styles.avatarText
            }
          >
            {initials}
          </Text>
        </View>
      </Pressable>
    </View>
  )
}


/* =========================================================
   ACCOUNT
   ========================================================= */

/* =========================================================
   BOTTOM NAV
   ========================================================= */

function BottomNav({
  screen,
  setScreen,
}: {
  screen: Screen

  setScreen:
    (
      screen: Screen
    ) => void
}) {
  const items: {
    key: Screen
    icon: string
    label: string
  }[] = [
    {
      key:
        'dashboard',

      icon:
        'grid-outline',

      label:
        'Home',
    },

    {
      key:
        'customers',

      icon:
        'people-outline',

      label:
        'Customers',
    },

    {
      key:
        'rewards',

      icon:
        'gift-outline',

      label:
        'Rewards',
    },


  ]


  return (
    <View
      style={
        styles.bottomNav
      }
    >
      {items.map(
        (
          item
        ) => (
          <Pressable
            key={
              item.key
            }

            style={
              styles.navItem
            }

            onPress={() =>
              setScreen(
                item.key
              )
            }
          >
            <Ionicons
              name={
                item.icon as any
              }

              size={20}

              color={
                screen ===
                item.key
                  ? colors.green
                  : colors.muted
              }
            />

            <Text
              style={[
                styles.navText,

                screen ===
                  item.key && {
                  color:
                    colors.ink,
                },
              ]}
            >
              {
                item.label
              }
            </Text>
          </Pressable>
        )
      )}
    </View>
  )
}


/* =========================================================
   MODAL HEADER
   ========================================================= */

function ModalHeader({
  onClose,
}: {
  onClose: () => void
}) {
  const pending = useRequestStatus()
  return (
    <>
      {!!pending && <View accessibilityRole="progressbar" accessibilityLabel={pending} accessibilityViewIsModal style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 1000, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator size="large" color={colors.dark} />
        <Text style={styles.pinIntroTitle}>{pending}</Text>
      </View>}
      <View
        style={
          styles.modalHandle
        }
      />

      <Pressable
        disabled={!!pending}
        style={
          styles.close
        }

        onPress={
          onClose
        }
      >
        <Ionicons
          name="close"

          size={21}

          color={
            colors.ink
          }
        />
      </Pressable>
    </>
  )
}


/* =========================================================
   ALERT
   ========================================================= */

function ProfessionalAlertModal({
  visible,
  title,
  message,
  type,
  onClose,
}: {
  visible: boolean
  title: string
  message: string
  type: AlertType
  onClose: () => void
}) {
  const settings = {
    success: {
      icon:
        'checkmark' as const,

      bg:
        '#DDF7E5',

      color:
        '#229A55',
    },

    warning: {
      icon:
        'alert-outline' as const,

      bg:
        '#FFF2CE',

      color:
        '#B77B00',
    },

    error: {
      icon:
        'close' as const,

      bg:
        '#FFE3E0',

      color:
        '#C84336',
    },

    info: {
      icon:
        'information' as const,

      bg:
        '#DDF1F3',

      color:
        '#267A83',
    },
  }


  const selected =
    settings[type]


  return (
    <Modal
      transparent

      visible={
        visible
      }

      animationType="fade"

      statusBarTranslucent

      onRequestClose={
        onClose
      }
    >
      <View
        style={
          styles.alertBackdrop
        }
      >
        <View
          style={
            styles.alertCard
          }
        >
          <View
            style={[
              styles.alertIcon,

              {
                backgroundColor:
                  selected.bg,
              },
            ]}
          >
            <Ionicons
              name={
                selected.icon
              }

              size={25}

              color={
                selected.color
              }
            />
          </View>

          <Text
            style={
              styles.alertTitle
            }
          >
            {title}
          </Text>

          <Text
            style={
              styles.alertMessage
            }
          >
            {message}
          </Text>

          <Pressable
            style={
              styles.alertButton
            }

            onPress={
              onClose
            }
          >
            <Text
              style={
                styles.alertButtonText
              }
            >
              Okay
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}


/* =========================================================
   COLORS
   ========================================================= */

const colors = {
  cream:
    '#F8F5EC',

  white:
    '#FFFDF7',

  ink:
    '#081711',

  dark:
    '#12483D',

  green:
    '#3AD875',

  muted:
    '#6C7B76',

  line:
    '#D5E1DA',
}


/* =========================================================
   STYLES
   ========================================================= */

const styles =
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor:
        colors.cream,
    },

    app: {
      flex: 1,
    },

    content: {
      padding: 22,
      paddingBottom: 115,
    },


    /* HEADER */

    header: {
      height: 72,
      paddingHorizontal: 22,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      borderBottomWidth: 1,

      borderBottomColor:
        colors.line,
    },

    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,

      backgroundColor:
        colors.green,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    avatarText: {
      color:
        colors.ink,

      fontWeight:
        '900',
    },


    /* TEXT */

    eyebrow: {
      color:
        colors.dark,

      fontSize: 10,

      fontWeight:
        '900',

      letterSpacing: 2,

      marginTop: 20,

      marginBottom: 9,
    },

    eyebrowLight: {
      color:
        '#B7F075',

      fontSize: 10,

      fontWeight:
        '900',

      letterSpacing: 2,
    },

    title: {
      color:
        colors.ink,

      fontSize: 29,

      fontWeight:
        '900',

      letterSpacing: -1,

      marginBottom: 7,
    },

    muted: {
      color:
        colors.muted,

      fontSize: 14,

      lineHeight: 21,
    },

    smallMuted: {
      color:
        colors.muted,

      fontSize: 11,

      lineHeight: 16,
    },

    cardTitle: {
      color:
        colors.ink,

      fontSize: 15,

      fontWeight:
        '900',

      marginBottom: 3,
    },

    labelSmall: {
      color:
        colors.muted,

      fontSize: 9,

      fontWeight:
        '900',

      letterSpacing: 1.2,
    },

    inlineStrong: {
      color:
        colors.ink,

      fontWeight:
        '900',
    },


    /* NFC */

    nfcReadyCard: {
      flexDirection:
        'row',

      gap: 14,

      alignItems:
        'center',

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 20,

      padding: 16,

      marginTop: 23,
    },

    nfcReadyIcon: {
      width: 58,
      height: 58,

      borderRadius: 18,

      backgroundColor:
        colors.green,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    statusRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 6,

      marginBottom: 4,
    },

    statusDot: {
      width: 7,
      height: 7,

      borderRadius: 4,

      backgroundColor:
        colors.green,
    },

    statusText: {
      color:
        colors.dark,

      fontSize: 10,

      fontWeight:
        '900',
    },


    /* QUICK */

    quickTitle: {
      color:
        colors.ink,

      fontSize: 16,

      fontWeight:
        '900',

      marginTop: 25,

      marginBottom: 11,
    },

    quickGrid: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 19,
    },
    quickAction: {
      flex: 1, minWidth: 0,
      backgroundColor: '#E5F3E5', borderWidth: 1, borderColor: '#CCE2CE',
      borderRadius: 22, padding: 16, gap: 7,
    },
    quickActionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 },
    quickIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#3AD875', alignItems: 'center', justifyContent: 'center' },
    quickActionTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
    quickActionDescription: { color: '#54665B', fontSize: 12, lineHeight: 18 },

    /* STATS */

    statGrid: {
      flexDirection:
        'row',

      gap: 8,
    },

    stat: {
      flex: 1,

      minHeight: 120,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 17,

      padding: 12,
    },

    statIcon: {
      width: 33,
      height: 33,

      borderRadius: 10,

      backgroundColor:
        '#E7F8E9',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom: 10,
    },

    statLabel: {
      color:
        colors.muted,

      fontSize: 9,

      fontWeight:
        '700',
    },

    statValue: {
      color:
        colors.ink,

      fontSize: 20,

      fontWeight:
        '900',

      marginTop: 4,
    },


    /* SECTION */

    sectionRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      marginTop: 26,

      marginBottom: 11,
    },

    sectionTitle: {
      color:
        colors.ink,

      fontSize: 17,

      fontWeight:
        '900',
    },

    link: {
      color:
        colors.dark,

      fontSize: 11,

      fontWeight:
        '800',
    },


    /* CUSTOMER */

    customerCard: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 11,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 17,

      padding: 13,

      marginBottom: 9,
    },

    customerAvatar: {
      width: 43,
      height: 43,

      borderRadius: 13,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    customerAvatarText: {
      color:
        colors.ink,

      fontSize: 12,

      fontWeight:
        '900',
    },

    customerName: {
      color:
        colors.ink,

      fontSize: 14,

      fontWeight:
        '900',

      marginBottom: 2,
    },

    nfcBadge: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 4,

      backgroundColor:
        '#E7F8E9',

      paddingHorizontal: 8,

      paddingVertical: 5,

      borderRadius: 20,
    },

    nfcBadgeText: {
      color:
        colors.dark,

      fontSize: 8,

      fontWeight:
        '900',
    },


    /* SEARCH */

    searchBox: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 9,

      height: 51,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 14,

      paddingHorizontal: 14,

      marginVertical: 18,
    },

    searchInput: {
      flex: 1,

      height:
        '100%',

      color:
        colors.ink,

      fontSize: 13,
    },


    /* REWARD CARDS */

    rewardGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 14,
    },

    rewardImageCard: {
      width: '48%',
      overflow:
        'hidden',

      backgroundColor:
        colors.white,

      borderRadius: 20,

      borderWidth: 1,

      borderColor:
        colors.line,
    },

    rewardImage: {
      width:
        '100%',

      aspectRatio: 1,

      backgroundColor:
        '#E5E9E6',
    },

    rewardContent: {
      padding: 12,
    },

    rewardName: {
      color:
        colors.ink,

      fontSize: 16,

      fontWeight:
        '900',

      marginBottom: 4,
    },

    rewardDescription: {
      color:
        colors.muted,

      fontSize: 11,

      lineHeight: 17,
    },

    rewardMeta: {
      flexDirection:
        'column',

      alignItems:
        'flex-start',

      gap: 6,

      justifyContent:
        'space-between',

      marginTop: 12,
    },

    rewardPointsBadge: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 5,

      backgroundColor:
        '#E7F8E9',

      paddingHorizontal: 10,

      paddingVertical: 6,

      borderRadius: 20,
    },

    rewardPointsText: {
      color:
        colors.dark,

      fontSize: 10,

      fontWeight:
        '900',
    },

    rewardStock: {
      color:
        colors.muted,

      fontSize: 9,

      fontWeight:
        '700',
    },

    redeemLink: {
      flexDirection:
        'row',

      gap: 5,

      alignItems:
        'center',

      marginTop: 15,
    },

    redeemLinkText: {
      color:
        colors.dark,

      fontSize: 12,

      fontWeight:
        '900',
    },


    /* MODAL */

    keyboardModalBackdrop: {
      flex: 1,

      backgroundColor:
        'rgba(6,27,22,.50)',
    },

    keyboardModalViewport: {
      flex: 1,
      minHeight: 0,
      justifyContent: 'flex-end',
    },

    keyboardModalCard: {
      flexShrink: 1,
      minHeight: 0,
      maxHeight:
        '92%',

      backgroundColor:
        colors.cream,

      borderTopLeftRadius: 30,

      borderTopRightRadius: 30,

      paddingHorizontal: 22,

      paddingTop: 12,

      overflow:
        'hidden',
    },

    keyboardModalScroll: {
      flexGrow: 0,
      flexShrink: 1,
      minHeight: 0,
    },

    keyboardModalScrollContent: {
      paddingTop: 6,

      paddingBottom: 24,
    },

    modalBackdrop: {
      flex: 1,

      justifyContent:
        'flex-end',

      backgroundColor:
        'rgba(6,27,22,.50)',
    },

    modalCard: {
      backgroundColor:
        colors.cream,

      borderTopLeftRadius: 30,

      borderTopRightRadius: 30,

      paddingHorizontal: 22,

      paddingTop: 12,

      paddingBottom: 27,

      maxHeight:
        '92%',
    },

    modalHandle: {
      width: 42,
      height: 5,

      borderRadius: 5,

      backgroundColor:
        '#D2DCD6',

      alignSelf:
        'center',

      marginBottom: 8,
    },

    close: {
      position:
        'absolute',

      top: 18,

      right: 18,

      width: 34,

      height: 34,

      borderRadius: 17,

      backgroundColor:
        '#E7EDE9',

      alignItems:
        'center',

      justifyContent:
        'center',

      zIndex: 20,
    },

    modalScroll: {
      paddingBottom: 12,
    },

    modalEyebrow: {
      color:
        colors.dark,

      fontSize: 9,

      fontWeight:
        '900',

      letterSpacing: 1.8,

      marginTop: 12,

      marginBottom: 8,
    },

    modalTitle: {
      color:
        colors.ink,

      fontSize: 25,

      fontWeight:
        '900',

      letterSpacing:
        -0.5,

      marginBottom: 8,
    },


    /* INPUT */

    successIcon: {
      width: 58,
      height: 58,

      borderRadius: 18,

      backgroundColor:
        '#DDF7E5',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop: 12,
    },

    phoneIcon: {
      width: 58,
      height: 58,

      borderRadius: 18,

      backgroundColor:
        '#DDF7E5',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop: 12,
    },

    cardDetected: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 11,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 14,

      padding: 13,

      marginTop: 18,
    },

    cardIdText: {
      color:
        colors.dark,

      fontSize: 11,

      fontWeight:
        '800',

      marginTop: 3,
    },

    twoFields: {
      flexDirection:
        'row',

      gap: 10,

      marginTop: 8,
    },

    inputLabel: {
      color:
        colors.ink,

      fontSize: 12,

      fontWeight:
        '800',

      marginTop: 15,

      marginBottom: 6,
    },

    input: {
      height: 50,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 13,

      paddingHorizontal: 13,

      color:
        colors.ink,

      fontSize: 13,
    },

    pinInput: {
      textAlign:
        'center',

      letterSpacing: 4,

      fontSize: 18,
    },

    pinIntro: {
      flexDirection:
        'row',

      gap: 10,

      alignItems:
        'center',

      backgroundColor:
        '#E7F8E9',

      borderRadius: 14,

      padding: 13,

      marginTop: 18,
    },

    pinIntroTitle: {
      color:
        colors.ink,

      fontSize: 12,

      fontWeight:
        '900',
    },

    pinIntroText: {
      color:
        colors.muted,

      fontSize: 10,

      lineHeight: 15,

      marginTop: 2,
    },


    /* PIN VERIFY */

    pinHeroIcon: {
      width: 60,

      height: 60,

      borderRadius: 19,

      backgroundColor:
        '#DDF7E5',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop: 12,
    },

    privatePinCard: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 9,

      backgroundColor:
        '#E7F8E9',

      borderRadius: 14,

      padding: 13,

      marginTop: 18,
    },

    privatePinTitle: {
      color:
        colors.ink,

      fontSize: 12,

      fontWeight:
        '900',
    },

    privatePinText: {
      color:
        colors.dark,

      fontSize: 11,

      fontWeight:
        '700',
    },

    customerPinInput: {
      height: 70,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 16,

      marginTop: 18,

      color:
        colors.ink,

      fontSize: 31,

      fontWeight:
        '900',

      letterSpacing: 13,

      textAlign:
        'center',
    },

    pinActionHint: {
      color:
        colors.muted,

      fontSize: 10,

      lineHeight: 15,

      textAlign:
        'center',

      marginTop: 11,
    },


    /* CUSTOMER HERO */

    customerHero: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 13,

      marginTop: 18,

      marginBottom: 17,
    },

    largeAvatar: {
      width: 58,

      height: 58,

      borderRadius: 18,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    largeAvatarText: {
      color:
        colors.ink,

      fontSize: 18,

      fontWeight:
        '900',
    },

    customerModalName: {
      color:
        colors.ink,

      fontSize: 20,

      fontWeight:
        '900',

      marginTop: 3,
    },

    verifiedRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 4,

      marginTop: 4,
    },

    verifiedText: {
      color:
        colors.dark,

      fontSize: 10,

      fontWeight:
        '800',
    },


    /* POINTS */

    balanceCard: {
      backgroundColor:
        '#E7F8E9',

      borderRadius: 15,

      padding: 15,

      marginBottom: 12,
    },

    balanceValue: {
      color:
        colors.ink,

      fontSize: 23,

      fontWeight:
        '900',

      marginTop: 4,
    },

    purchaseInput: {
      height: 61,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 14,

      paddingHorizontal: 15,

      color:
        colors.ink,

      fontSize: 23,

      fontWeight:
        '800',
    },

    pointsResult: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      backgroundColor:
        '#E7F8E9',

      borderRadius: 14,

      padding: 14,

      marginTop: 13,
    },

    pointsResultLabel: {
      color:
        colors.dark,

      fontSize: 12,

      fontWeight:
        '800',
    },

    pointsValue: {
      color:
        colors.ink,

      fontSize: 19,

      fontWeight:
        '900',
    },


    /* CUSTOMER DETAILS */

    detailHero: {
      alignItems:
        'center',

      paddingTop: 18,

      paddingBottom: 20,
    },

    detailAvatar: {
      width: 72,

      height: 72,

      borderRadius: 22,

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom: 13,
    },

    detailAvatarText: {
      color:
        colors.ink,

      fontSize: 22,

      fontWeight:
        '900',
    },

    detailCustomerName: {
      color:
        colors.ink,

      fontSize: 23,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    detailSubtitle: {
      color:
        colors.muted,

      fontSize: 11,

      marginTop: 4,
    },

    detailBalanceCard: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 12,

      backgroundColor:
        '#E7F8E9',

      borderRadius: 17,

      padding: 16,
    },

    detailBalanceIcon: {
      width: 42,

      height: 42,

      borderRadius: 13,

      backgroundColor:
        'rgba(53,217,120,.20)',

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    detailBalanceValue: {
      color:
        colors.ink,

      fontSize: 25,

      fontWeight:
        '900',

      marginTop: 3,
    },

    detailStats: {
      flexDirection:
        'row',

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 17,

      paddingVertical: 16,

      marginTop: 12,
    },

    detailStat: {
      flex: 1,

      alignItems:
        'center',

      paddingHorizontal: 5,
    },

    detailStatLabel: {
      color:
        colors.muted,

      fontSize: 9,

      textAlign:
        'center',

      marginBottom: 5,
    },

    detailStatValue: {
      color:
        colors.ink,

      fontSize: 16,

      fontWeight:
        '900',
    },

    detailStatDivider: {
      width: 1,

      backgroundColor:
        colors.line,
    },

    nfcDetailSection: {
      marginTop: 23,
    },

    detailSectionTitle: {
      color:
        colors.ink,

      fontSize: 16,

      fontWeight:
        '900',

      marginBottom: 10,
    },

    nfcStatusCard: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 11,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 16,

      padding: 14,
    },

    nfcStatusIcon: {
      width: 44,

      height: 44,

      borderRadius: 14,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    nfcStatusLinked: {
      backgroundColor:
        '#DDF7E5',
    },

    nfcStatusUnlinked: {
      backgroundColor:
        '#EEF1EF',
    },

    nfcStatusTitle: {
      color:
        colors.ink,

      fontSize: 13,

      fontWeight:
        '900',
    },

    nfcStatusDescription: {
      color:
        colors.muted,

      fontSize: 10,

      lineHeight: 15,

      marginTop: 3,
    },

    privacyNote: {
      color:
        colors.muted,

      fontSize: 9,

      lineHeight: 14,

      textAlign:
        'center',

      marginTop: 16,
    },


    /* REWARDS */

    rewardModalImage: {
      width:
        '100%',

      aspectRatio: 4 / 3,

      borderRadius: 18,

      marginTop: 12,

      backgroundColor:
        '#E5E9E6',
    },

    unitPointsCard: {
      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 14,

      padding: 14,

      marginTop: 17,
    },

    unitPointsValue: {
      color:
        colors.ink,

      fontSize: 19,

      fontWeight:
        '900',

      marginTop: 3,
    },

    quantityRow: {
      flexDirection:
        'row',

      gap: 10,
    },

    quantityButton: {
      width: 52,

      height: 52,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 14,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    quantityValue: {
      flex: 1,

      height: 52,

      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 14,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    quantityText: {
      color:
        colors.ink,

      fontSize: 21,

      fontWeight:
        '900',
    },

    rewardTotal: {
      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'space-between',

      backgroundColor:
        '#E7F8E9',

      borderRadius: 15,

      padding: 15,

      marginTop: 17,
    },

    rewardTotalValue: {
      color:
        colors.ink,

      fontSize: 19,

      fontWeight:
        '900',
    },

    primaryButton: {
      height: 53,

      backgroundColor:
        colors.green,

      borderRadius: 14,

      marginTop: 17,

      flexDirection:
        'row',

      gap: 8,

      alignItems:
        'center',

      justifyContent:
        'center',
    },

    primaryButtonText: {
      color:
        colors.ink,

      fontSize: 14,

      fontWeight:
        '900',
    },

    secondaryActionButton: {
      height: 52,

      flexDirection:
        'row',

      alignItems:
        'center',

      justifyContent:
        'center',

      gap: 7,

      borderWidth: 1,

      borderColor:
        colors.line,

      backgroundColor:
        colors.white,

      borderRadius: 14,

      marginTop: 12,
    },

    secondaryActionText: {
      color:
        colors.dark,

      fontSize: 13,

      fontWeight:
        '900',
    },

    orRow: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 10,

      marginTop: 16,
    },

    orLine: {
      flex: 1,

      height: 1,

      backgroundColor:
        colors.line,
    },

    orText: {
      color:
        colors.muted,

      fontSize: 10,

      fontWeight:
        '700',
    },

    konekAdvantage: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 7,

      backgroundColor:
        '#E7F8E9',

      borderRadius: 13,

      padding: 11,

      marginTop: 14,
    },

    konekAdvantageText: {
      flex: 1,

      color:
        colors.dark,

      fontSize: 10,

      lineHeight: 15,

      fontWeight:
        '700',
    },

    bigNfc: {
      width: 90,

      height: 90,

      borderRadius: 45,

      backgroundColor:
        colors.green,

      alignItems:
        'center',

      justifyContent:
        'center',

      alignSelf:
        'center',

      marginTop: 15,
    },

    waitingCard: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 8,

      backgroundColor:
        '#E7F8E9',

      borderRadius: 13,

      padding: 13,

      marginTop: 18,
    },

    redemptionProduct: {
      flexDirection:
        'row',

      alignItems:
        'center',

      gap: 12,

      backgroundColor:
        colors.white,

      borderRadius: 16,

      borderWidth: 1,

      borderColor:
        colors.line,

      padding: 10,

      marginTop: 8,
    },

    redemptionImage: {
      width: 58,

      height: 58,

      borderRadius: 12,

      backgroundColor:
        '#E5E9E6',
    },

    rewardSummary: {
      backgroundColor:
        colors.white,

      borderWidth: 1,

      borderColor:
        colors.line,

      borderRadius: 16,

      padding: 14,

      marginTop: 10,
    },

    summaryRow: {
      flexDirection:
        'row',

      justifyContent:
        'space-between',

      alignItems:
        'center',

      paddingVertical: 8,
    },

    summaryLabel: {
      color:
        colors.muted,

      fontSize: 11,
    },

    summaryValue: {
      color:
        colors.ink,

      fontSize: 12,

      fontWeight:
        '900',
    },

    warningCard: {
      flexDirection:
        'row',

      gap: 8,

      alignItems:
        'center',

      backgroundColor:
        '#FFF2CE',

      borderRadius: 13,

      padding: 12,

      marginTop: 12,
    },

    warningText: {
      flex: 1,

      color:
        '#805500',

      fontSize: 11,

      lineHeight: 16,
    },


    /* REPLACE */

    warningLargeIcon: {
      width: 60,

      height: 60,

      borderRadius: 19,

      backgroundColor:
        '#FFF2CE',

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop: 12,
    },

    cancelButton: {
      height: 50,

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop: 8,
    },

    cancelButtonText: {
      color:
        colors.muted,

      fontSize: 13,

      fontWeight:
        '800',
    },


    /* NAV */

    bottomNav: {
      position:
        'absolute',

      left: 0,

      right: 0,

      bottom: 0,

      height: 78,

      backgroundColor:
        colors.white,

      borderTopWidth: 1,

      borderTopColor:
        colors.line,

      flexDirection:
        'row',

      justifyContent:
        'space-around',

      paddingTop: 12,
    },

    navItem: {
      minWidth: 62,

      alignItems:
        'center',

      gap: 3,
    },

    navText: {
      color:
        colors.muted,

      fontSize: 9,

      fontWeight:
        '700',
    },


    /* LOGIN */

    login: {
      flex: 1,

      backgroundColor:
        colors.dark,
    },

    loginBrand: {
      flexGrow: 0,
      flexShrink: 0,

      padding: 25,
    },

    loginCopy: {
      marginTop: 32,
    },

    loginTitle: {
      color:
        colors.cream,

      fontSize: 44,

      lineHeight: 43,

      fontWeight:
        '900',

      marginTop: 15,
    },

    loginForm: {
      flexGrow: 1,
      backgroundColor:
        colors.cream,

      borderTopLeftRadius: 30,

      borderTopRightRadius: 30,

      padding: 25,
    },


    /* ALERT */

    alertBackdrop: {
      flex: 1,

      alignItems:
        'center',

      justifyContent:
        'center',

      backgroundColor:
        'rgba(6,27,22,.58)',

      padding: 24,
    },

    alertCard: {
      width:
        '100%',

      maxWidth: 380,

      backgroundColor:
        colors.white,

      borderRadius: 23,

      padding: 23,

      alignItems:
        'center',
    },

    alertIcon: {
      width: 57,

      height: 57,

      borderRadius: 18,

      alignItems:
        'center',

      justifyContent:
        'center',

      marginBottom: 15,
    },

    alertTitle: {
      color:
        colors.ink,

      fontSize: 19,

      fontWeight:
        '900',

      textAlign:
        'center',
    },

    alertMessage: {
      color:
        colors.muted,

      fontSize: 13,

      lineHeight: 20,

      textAlign:
        'center',

      marginTop: 7,
    },

    alertButton: {
      width:
        '100%',

      height: 49,

      borderRadius: 13,

      backgroundColor:
        colors.green,

      alignItems:
        'center',

      justifyContent:
        'center',

      marginTop: 20,
    },

    alertButtonText: {
      color:
        colors.ink,

      fontSize: 13,

      fontWeight:
        '900',
    },
  })
