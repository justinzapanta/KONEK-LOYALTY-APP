import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import Ionicons from '@expo/vector-icons/Ionicons'
import { fulfillRewardClaim, previewRewardClaim, RewardClaim } from '../services/api/loyalty'
import { parseClaimCode } from '../services/api/claimCode'
import { scanRewardCode } from '../services/nativeRewardScanner'

export function ClaimScannerButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Scan reward QR" onPress={onPress} style={styles.launch}>
    <View style={styles.icon}><Ionicons name="qr-code-outline" size={25} color="#081711" /></View>
    <View style={{ flex: 1 }}><Text style={styles.launchTitle}>Scan reward QR</Text><Text style={styles.muted}>Collect a reward claimed on the customer website.</Text></View>
    <Ionicons name="chevron-forward" size={19} color="#081711" />
  </Pressable>
}

export function RewardClaimScanner({ onClose, onComplete, onVoucher }: { onVoucher?: (claim: RewardClaim) => void; onClose: () => void; onComplete: (alreadyUsed: boolean, claim: RewardClaim) => void }) {
  const [permission, requestPermission, refreshPermission] = useCameraPermissions()
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
  const [modalShown, setModalShown] = useState(false)
  const [previewLaidOut, setPreviewLaidOut] = useState(false)
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 240 })
  const [cameraSession, setCameraSession] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [torch, setTorch] = useState(false)
  const [code, setCode] = useState('')
  const [claim, setClaim] = useState<RewardClaim | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState('')
  const [scanning, setScanning] = useState(true)
  const [manualEntry, setManualEntry] = useState(false)
  const nativeScanner = Platform.OS === 'android'
  const [nativeOpening, setNativeOpening] = useState(false)
  const nativeOpeningRef = useRef(false)
  const manualEntryFocused = useRef(false)
  const scroll = useRef<ScrollView>(null)
  const lock = useRef(false), alive = useRef(true), completed = useRef(false)

  async function openNativeScanner() {
    if (nativeOpeningRef.current || lock.current || completed.current || !alive.current) return
    nativeOpeningRef.current = true
    setNativeOpening(true)
    setError('')
    Keyboard.dismiss()
    try {
      const value = await scanRewardCode()
      if (alive.current && value) await lookup(value)
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Unable to open the scanner. Enter the reward code below.')
    } finally {
      nativeOpeningRef.current = false
      if (alive.current) setNativeOpening(false)
    }
  }

  async function restartCamera() {
    if (!alive.current || lock.current || completed.current) return
    setCameraReady(false)
    setCameraFailed(false)
    setTorch(false)
    setError('')
    setCameraSession(value => value + 1)
    try { await refreshPermission() }
    catch { if (alive.current) setError('Camera permission could not be checked. Try again or enter the reward code below.') }
  }

  useEffect(() => {
    alive.current = true
    const subscription = AppState.addEventListener('change', value => {
      setActive(value === 'active')
      setCameraReady(false)
      setTorch(false)
      if (value === 'active') {
        // Settings and permission dialogs may suspend the native camera session.
        void refreshPermission().then(() => {
          if (alive.current) { setCameraFailed(false); setCameraSession(current => current + 1) }
        }).catch(() => {
          if (alive.current) setError('Camera permission could not be checked. Try again or enter the reward code below.')
        })
      }
    })
    return () => { alive.current = false; subscription.remove() }
  }, [refreshPermission])

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (manualEntryFocused.current) scroll.current?.scrollToEnd({ animated: true })
    })
    return () => subscription.remove()
  }, [])

  const cameraVisible = !nativeScanner && scanning && !manualEntry && active && !!permission?.granted && !cameraFailed && modalShown && previewLaidOut && !claim && !pending
  useEffect(() => {
    if (!cameraVisible || cameraReady) return
    const timer = setTimeout(() => {
      setCameraFailed(true)
      setError('The camera did not start. Tap Restart camera, close another app using the camera, or enter the reward code below.')
    }, 12_000)
    return () => clearTimeout(timer)
  }, [cameraVisible, cameraReady, cameraSession])

  async function lookup(value: string) {
    if (lock.current || completed.current || !alive.current) return
    lock.current = true
    setScanning(false)
    setError('')
    Keyboard.dismiss()
    try {
      const normalized = parseClaimCode(value)
      setCode(normalized)
      setPending('Checking reward…')
      const result = await previewRewardClaim(normalized)
      if (alive.current) setClaim(result)
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Unable to check this reward. Please try again.')
    } finally {
      lock.current = false
      if (alive.current) setPending('')
    }
  }

  async function confirm() {
    if (lock.current || completed.current || !alive.current || !claim) return
    if (claim.discountKind) { if (onVoucher) { completed.current = true; onVoucher(claim) } else setError('Apply this voucher through customer checkout.'); return }
    lock.current = true
    setPending('Confirming collection…')
    setError('')
    try {
      const result = await fulfillRewardClaim(code)
      completed.current = true
      if (alive.current) onComplete(result.already_used, { ...claim, ...(result.customer ? {customer:result.customer} : {}) })
    } catch (cause) {
      if (alive.current) setError(`${cause instanceof Error ? cause.message : 'Unable to confirm collection.'} Could not confirm the save. Retry this same reward code safely; it cannot be collected twice.`)
    } finally {
      lock.current = false
      if (alive.current) setPending('')
    }
  }

  return <Modal visible hardwareAccelerated animationType="slide" onShow={() => { setModalShown(true); if (nativeScanner) void openNativeScanner() }} onRequestClose={() => { if (!lock.current && !nativeOpeningRef.current) onClose() }}>
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.keyboardArea} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>CUSTOMER REWARD</Text><Text style={styles.title}>Scan & collect</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close reward scanner" disabled={!!pending || nativeOpening} onPress={onClose} style={styles.close}><Ionicons name="close" size={25} color="#081711" /></Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={true} persistentScrollbar indicatorStyle="black" ref={scroll} style={styles.keyboardArea} removeClippedSubviews={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={styles.body}
        onLayout={() => { if (manualEntryFocused.current) scroll.current?.scrollToEnd({ animated: true }) }}
        onContentSizeChange={() => { if (manualEntryFocused.current) scroll.current?.scrollToEnd({ animated: true }) }}>
        <Text style={styles.description}>Ask the customer to open their reward QR code in My rewards. Check the details before handing over the reward.</Text>
        {pending ? <View style={styles.loading} accessibilityRole="progressbar"><ActivityIndicator size="large" color="#16864A" /><Text style={styles.label}>{pending}</Text></View> : null}
        {!claim && !pending && <>
          {nativeScanner && scanning && !manualEntry && <View style={styles.permission}>
            <Ionicons name="scan-outline" size={44} color="#16864A" />
            <Text style={styles.label}>Scan a customer reward</Text>
            <Text style={styles.muted}>Point the camera at the reward QR code. You’ll return here to check and confirm collection.</Text>
            <Pressable accessibilityRole="button" disabled={nativeOpening} onPress={() => { void openNativeScanner() }} style={styles.primary}>
              {nativeOpening ? <ActivityIndicator color="#081711" /> : <Text style={styles.primaryText}>Open scanner</Text>}
            </Pressable>
          </View>}
          {!nativeScanner && (scanning && !manualEntry && active && permission?.granted && !cameraFailed ? <View collapsable={false} style={styles.cameraFrame} onLayout={({ nativeEvent: { layout } }) => {
            setPreviewLaidOut(layout.width > 0 && layout.height > 0)
            setPreviewSize(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height })
          }}>
            {cameraVisible && <CameraView key={cameraSession} style={previewSize} facing="back" mode="picture" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onCameraReady={() => setCameraReady(true)} onBarcodeScanned={({ data }) => { void lookup(data) }} onMountError={() => { setCameraFailed(true); setError('The camera could not open. Tap Restart camera or enter the reward code below instead.') }} />}
            <View pointerEvents="none" style={styles.guide}><Ionicons name="scan-outline" size={150} color="#3AD875" /></View>
            {!cameraReady && <View pointerEvents="none" style={styles.cameraStarting}><ActivityIndicator size="large" color="#3AD875" /><Text style={styles.cameraStartingText}>Starting camera…</Text></View>}
            <Pressable disabled={!cameraReady} accessibilityRole="button" accessibilityLabel={torch ? 'Turn flashlight off' : 'Turn flashlight on'} onPress={() => setTorch(value => !value)} style={styles.torch}><Ionicons name={torch ? 'flash' : 'flash-outline'} size={22} color="white" /></Pressable>
          </View> : scanning && !manualEntry && !cameraFailed && !permission?.granted ? <View style={styles.permission}>
            <Ionicons name="camera-outline" size={38} color="#16864A" /><Text style={styles.label}>Allow camera access to scan</Text><Text style={styles.muted}>KONEK uses the camera only to read reward QR codes.</Text>
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => { void (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission()).catch(() => setError('Open your phone settings to allow camera access, or enter the code below.')) }}><Text style={styles.primaryText}>{permission?.canAskAgain === false ? 'Open settings' : 'Allow camera'}</Text></Pressable>
          </View> : null)}
          {!nativeScanner && scanning && !manualEntry && permission?.granted && <Pressable accessibilityRole="button" onPress={() => { void restartCamera() }} style={styles.secondary}><Text style={styles.label}>Restart camera</Text></Pressable>}
          {manualEntry && <View style={{ gap: 8 }}><Text style={styles.muted}>Camera paused while you enter the reward code.</Text>
            <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); manualEntryFocused.current = false; setManualEntry(false); setCameraReady(false); if (nativeScanner) void openNativeScanner() }}><Text style={[styles.label, { textDecorationLine: 'underline' }]}>Scan QR instead</Text></Pressable>
          </View>}
          <Text style={styles.label}>Or enter the reward code</Text>
          <TextInput accessibilityLabel="Reward claim code" value={code} onChangeText={value => { setCode(value); setClaim(null) }}
            onFocus={() => { manualEntryFocused.current = true; setManualEntry(true); setCameraReady(false); setTorch(false) }}
            onBlur={() => { manualEntryFocused.current = false }}
            onSubmitEditing={() => { if (code.trim()) void lookup(code) }} returnKeyType="done"
            autoCapitalize="characters" autoCorrect={false} maxLength={40} placeholder="KNK-…" placeholderTextColor="#738077" style={styles.input} />
          <Pressable accessibilityRole="button" disabled={!code.trim()} onPress={() => { void lookup(code) }} style={[styles.primary, !code.trim() && styles.disabled]}><Text style={styles.primaryText}>Check reward</Text></Pressable>
        </>}
        {claim && <View style={styles.details}>
          <Text style={styles.eyebrow}>READY TO COLLECT</Text><Text style={styles.rewardName}>{claim.name}</Text><Text style={styles.description}>{claim.customerName}</Text>
          <View style={styles.detailRow}><Text style={styles.muted}>Quantity</Text><Text style={styles.label}>{claim.quantity}</Text></View>
          <View style={styles.detailRow}><Text style={styles.muted}>Points already spent</Text><Text style={styles.label}>{Number(claim.pointsSpent).toLocaleString('en-PH')}</Text></View>
          <View style={styles.detailRow}><Text style={styles.muted}>Collect before</Text><Text style={styles.label}>{new Date(claim.validUntil).toLocaleDateString('en-PH')}</Text></View>
          <Text style={styles.muted}>{claim.discountKind ? 'This is a discount voucher. Continue to customer checkout to enter the order total and apply it. The code stays unused until checkout succeeds.' : 'Confirm only when you hand over the reward. This marks the saved code as used and does not deduct points again.'}</Text>
          <Pressable accessibilityRole="button" disabled={!!pending} onPress={() => { void confirm() }} style={[styles.primary, !!pending && styles.disabled]}><Text style={styles.primaryText}>{claim.discountKind ? 'Continue to checkout' : 'Confirm collection'}</Text></Pressable>
        </View>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!pending && (!scanning || claim) && <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => { setClaim(null); setCode(''); setError(''); manualEntryFocused.current = false; setManualEntry(false); setCameraReady(false); setCameraFailed(false); setCameraSession(value => value + 1); setTorch(false); setScanning(true) }}><Text style={styles.label}>Scan another QR code</Text></Pressable>}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F6EB' },
  keyboardArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 22, borderBottomWidth: 1, borderBottomColor: '#DCE5D9' },
  eyebrow: { fontSize: 11, letterSpacing: 2, fontWeight: '700', color: '#38604E', marginBottom: 7 },
  title: { fontSize: 27, fontWeight: '800', color: '#081711' },
  close: { padding: 10 }, body: { padding: 22, gap: 16, paddingBottom: 30 },
  launch: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#E5F3E5', borderWidth: 1, borderColor: '#CCE2CE', borderRadius: 22, padding: 18, marginTop: 20, marginBottom: 6 },
  icon: { width: 48, height: 48, borderRadius: 15, backgroundColor: '#3AD875', alignItems: 'center', justifyContent: 'center' },
  launchTitle: { fontSize: 17, fontWeight: '800', color: '#081711', marginBottom: 4 },
  muted: { color: '#54665B', fontSize: 13, lineHeight: 20 },
  description: { color: '#54665B', fontSize: 15, lineHeight: 23 },
  label: { color: '#081711', fontSize: 15, fontWeight: '700' },
  cameraFrame: { height: 240, borderRadius: 24, overflow: 'hidden', backgroundColor: '#081711' },
  cameraStarting: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#081711CC' },
  cameraStartingText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  guide: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center' },
  torch: { position: 'absolute', right: 14, bottom: 14, borderRadius: 25, padding: 12, backgroundColor: '#081711AA' },
  permission: { padding: 24, gap: 12, borderWidth: 1, borderColor: '#DCE5D9', borderRadius: 24, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#CBDDCE', borderRadius: 16, padding: 15, backgroundColor: '#FFF', color: '#081711', fontSize: 16 },
  primary: { padding: 16, backgroundColor: '#3AD875', borderRadius: 18, alignItems: 'center' },
  primaryText: { color: '#081711', fontWeight: '800', fontSize: 15 },
  secondary: { padding: 16, borderRadius: 18, borderWidth: 1, borderColor: '#CBDDCE', alignItems: 'center' },
  disabled: { opacity: 0.5 }, loading: { alignItems: 'center', padding: 28, gap: 14 },
  details: { borderRadius: 24, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DCE5D9', padding: 20, gap: 16 },
  rewardName: { fontSize: 24, fontWeight: '800', color: '#081711' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  error: { color: '#AC3232', fontSize: 14, lineHeight: 21 },
})
