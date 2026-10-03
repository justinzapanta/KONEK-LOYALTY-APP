import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import { Logo } from './src/components/Brand'
import { Button, Field } from './src/components/FormControls'
import { Customer, NFCMode, Screen, POINTS_PER_AMOUNT, getAvailablePoints, initialCustomers } from './src/types/loyalty'
import { NfcStateMachineProvider, useNfcStateMachine } from './src/state/nfc/NfcStateMachine'

export default function App() {
  const [tagEvent, setTagEvent] = useState<{ mode: Exclude<NFCMode, 'idle'>; tag: { id: string } } | null>(null)
  const handleTag = useCallback((mode: Exclude<NFCMode, 'idle'>, tag: { id: string }) => setTagEvent({ mode, tag }), [])
  const clearTag = useCallback(() => setTagEvent(null), [])
  return <NfcStateMachineProvider onTag={handleTag}><AppContent tagEvent={tagEvent} clearTag={clearTag} /></NfcStateMachineProvider>
}

function AppContent({ tagEvent, clearTag }: { tagEvent: { mode: Exclude<NFCMode, 'idle'>; tag: { id: string } } | null; clearTag: () => void }) {
  const [loggedIn, setLoggedIn] = useState(false)
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [customers, setCustomers] = useState(initialCustomers)
  const [cardId, setCardId] = useState('')
  const [showRegister, setShowRegister] = useState(false)
  const [pointsCustomer, setPointsCustomer] = useState<Customer | null>(null)
  const [purchase, setPurchase] = useState('')
  const { mode: nfcMode, state: nfcState, start: beginNfc, cancel: cancelNfc, retry: retryNfc } = useNfcStateMachine()

  const handleNfcTag = useCallback((mode: Exclude<NFCMode, 'idle'>, tag: { id: string }) => {
    setCardId(tag.id)
    if (mode === 'create') {
      const alreadyRegistered = customers.some((customer) => customer.nfcCardId === tag.id)
      if (alreadyRegistered) {
        Alert.alert('Card already registered', 'This NFC card is already linked to a loyal customer.')
        cancelNfc()
        return
      }
      setShowRegister(true)
      return
    }
    const customer = customers.find((item) => item.nfcCardId === tag.id)
    if (!customer) {
      Alert.alert('Unrecognized Card', 'Please register this customer first.')
      cancelNfc()
      return
    }
    setPointsCustomer(customer)
  }, [cancelNfc, customers])

  useEffect(() => {
    if (!tagEvent) return

    const { mode, tag } = tagEvent
    clearTag()

    // Allow the native NFC sheet and reader modal to finish dismissing before
    // presenting the follow-up form modal.
    const timer = setTimeout(() => {
      handleNfcTag(mode, tag)
    }, 500)

    return () => clearTimeout(timer)
  }, [tagEvent, clearTag, handleNfcTag])

  const finishPoints = () => {
    if (!pointsCustomer) return
    const earned = Math.floor(Number(purchase || 0) / POINTS_PER_AMOUNT)
    setCustomers((current) => current.map((customer) => customer.id === pointsCustomer.id ? { ...customer, totalPoints: customer.totalPoints + earned, timesEarned: customer.timesEarned + 1 } : customer))
    cancelNfc()
    setPointsCustomer(null); setPurchase('')
  }
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />
  return <SafeAreaProvider><SafeAreaView style={styles.safe}><StatusBar style="dark" /><View style={styles.app}><Header onProfile={() => setScreen('profile')} /><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>{screen === 'dashboard' && <Dashboard customers={customers} onAdd={() => beginNfc('create')} onTap={() => beginNfc('reward')} onCustomers={() => setScreen('customers')} />}{screen === 'customers' && <Customers customers={customers} onAdd={() => beginNfc('create')} />}{screen === 'profile' && <Profile onSignOut={() => setLoggedIn(false)} />}</ScrollView><BottomNav screen={screen} setScreen={setScreen} /></View>
    <NfcModal mode={nfcMode} state={nfcState} onClose={cancelNfc} onRead={retryNfc} />
    <RegisterModal visible={showRegister} cardId={cardId} onClose={() => { cancelNfc(); setShowRegister(false) }} onSave={(data) => { setCustomers((current) => [{ ...data, id: String(Date.now()), nfcCardId: cardId, totalPoints: 0, timesEarned: 0, totalRedeemed: 0, createdAt: 'Sep 30, 2026', color: '#B5EDC6' }, ...current]); cancelNfc(); setShowRegister(false); setScreen('customers') }} />
    <PointsModal customer={pointsCustomer} cardId={cardId} purchase={purchase} setPurchase={setPurchase} onClose={() => { cancelNfc(); setPointsCustomer(null); setPurchase('') }} onFinish={finishPoints} />
  </SafeAreaView></SafeAreaProvider>
}

function Login({ onLogin }: { onLogin: () => void }) { return <SafeAreaProvider><SafeAreaView style={styles.safe}><StatusBar style="light" /><View style={styles.login}><View style={styles.loginBrand}><Logo /><View style={styles.loginCopy}><Text style={styles.eyebrowLight}>KONNEK LOYALTY</Text><Text style={styles.loginTitle}>Every visit{`\n`}<Text style={{ color: colors.green }}>counts.</Text></Text><Text style={styles.loginDescription}>Turn everyday customers into loyal regulars with one simple tap.</Text><Text style={styles.bullet}>✓  Tap-to-earn rewards</Text><Text style={styles.bullet}>✓  Built for busy counters</Text></View></View><View style={styles.loginForm}><Text style={styles.eyebrow}>STAFF ACCESS</Text><Text style={styles.title}>Welcome back.</Text><Text style={styles.muted}>Sign in to manage your loyalty program.</Text><Field label="Work email" placeholder="you@business.com" value="justin@konnek.co" /><Field label="Password" placeholder="Enter your password" value="password" secure /><Button title="Sign in" onPress={onLogin} /></View></View></SafeAreaView></SafeAreaProvider> }
function Header({ onProfile }: { onProfile: () => void }) { return <View style={styles.header}><Logo /><Pressable onPress={onProfile} style={styles.headerUser}><View style={styles.avatar}><Text style={styles.avatarText}>JD</Text></View><Ionicons name="chevron-down" size={16} color={colors.ink} /></Pressable></View> }
function Dashboard({ customers, onAdd, onTap, onCustomers }: { customers: Customer[]; onAdd: () => void; onTap: () => void; onCustomers: () => void }) {
  return <>
    <Text style={styles.eyebrow}>WEDNESDAY, SEPTEMBER 30, 2026</Text>
    <Text style={styles.title}>Good morning, Justin.</Text>
    <Text style={styles.muted}>Here&apos;s how your loyalty program is doing.</Text>
    <Pressable style={styles.tapBanner} onPress={onTap}><View style={styles.tapIcon}><Ionicons name="wifi" size={26} color={colors.ink} /></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Reward a customer?</Text><Text style={styles.smallMuted}>Tap a loyalty card to reward an existing loyal customer.</Text></View><Ionicons name="arrow-forward" size={20} color={colors.ink} /></Pressable>
    <View style={styles.statGrid}><Stat label="Loyal customers" value={String(customers.length + 20)} color="#B5EDC6" /><Stat label="Points issued" value="18,420" color="#F7D98B" /><Stat label="Points redeemed" value="6,280" color="#B9E8EB" /></View>
    <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Recent loyal customers</Text><Pressable onPress={onCustomers}><Text style={styles.link}>All loyal customers  →</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}><Text style={[styles.tableCell, styles.nameCell]}>Customer</Text><Text style={styles.tableCell}>Points</Text><Text style={styles.tableCell}>Earned</Text><Text style={styles.tableCell}>Redeemed</Text><Text style={styles.tableCell}>Created</Text></View>
        {customers.slice(0, 3).map((customer) => <View key={customer.id} style={styles.tableRow}><View style={[styles.tableCell, styles.nameCell, styles.customerNameCell]}><View style={[styles.tableAvatar, { backgroundColor: customer.color }]}><Text style={styles.tableAvatarText}>{customer.firstName[0]}{customer.lastName[0]}</Text></View><Text style={styles.tableName}>{customer.firstName} {customer.lastName}</Text></View><Text style={[styles.tableCell, styles.tableStrong]}>{getAvailablePoints(customer).toLocaleString()}</Text><Text style={styles.tableCell}>{customer.timesEarned}</Text><Text style={styles.tableCell}>{customer.totalRedeemed.toLocaleString()}</Text><Text style={styles.tableCell}>{customer.createdAt}</Text></View>)}
      </View>
    </ScrollView>
    <Button title="＋  Add loyal customer" onPress={onAdd} />
  </>
}
function Stat({ label, value, color }: { label: string; value: string; color: string }) { return <View style={styles.stat}><View style={[styles.statIcon, { backgroundColor: color }]}><Ionicons name="sparkles-outline" size={18} color={colors.ink} /></View><Text style={styles.smallMuted}>{label}</Text><Text style={styles.statValue}>{value}</Text><Text style={styles.trend}>+8.4% <Text style={styles.smallMuted}>vs last month</Text></Text></View> }
function Customers({ customers, onAdd }: { customers: Customer[]; onAdd: () => void }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => customers.filter((customer) => `${customer.firstName} ${customer.lastName}`.toLowerCase().includes(query.toLowerCase())), [customers, query])
  return <>
    <Text style={styles.eyebrow}>LOYALTY PROGRAM</Text>
    <Text style={styles.title}>Loyal customers</Text>
    <Text style={styles.muted}>Manage every registered customer in one view.</Text>
    <View style={styles.customerAction}><Button title="＋ Add loyal customer" onPress={onAdd} /></View>
    <TextInput style={styles.search} placeholder="Search customers..." value={query} onChangeText={setQuery} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}><Text style={[styles.tableCell, styles.nameCell]}>Customer</Text><Text style={styles.tableCell}>Points</Text><Text style={styles.tableCell}>Earned</Text><Text style={styles.tableCell}>Redeemed</Text><Text style={styles.tableCell}>Created</Text></View>
        {filtered.map((customer) => <View key={customer.id} style={styles.tableRow}>
          <View style={[styles.tableCell, styles.nameCell, styles.customerNameCell]}><View style={[styles.tableAvatar, { backgroundColor: customer.color }]}><Text style={styles.tableAvatarText}>{customer.firstName[0]}{customer.lastName[0]}</Text></View><Text style={styles.tableName}>{customer.firstName} {customer.lastName}</Text></View>
          <Text style={[styles.tableCell, styles.tableStrong]}>{getAvailablePoints(customer).toLocaleString()}</Text><Text style={styles.tableCell}>{customer.timesEarned}</Text><Text style={styles.tableCell}>{customer.totalRedeemed.toLocaleString()}</Text><Text style={styles.tableCell}>{customer.createdAt}</Text>
        </View>)}
        {filtered.length === 0 && <Text style={styles.emptyTable}>No customers found.</Text>}
      </View>
    </ScrollView>
  </>
}
function CustomerCard({ customer }: { customer: Customer }) {
  const availablePoints = getAvailablePoints(customer)

  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, backgroundColor: '#FFFDF7', borderRadius: 18, borderWidth: 1, borderColor: colors.line, marginBottom: 10 }}>
    <View style={[styles.avatar, { backgroundColor: customer.color }]}><Text style={styles.avatarText}>{customer.firstName[0]}{customer.lastName[0]}</Text></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.cardTitle}>{customer.firstName} {customer.lastName}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
        <View style={{ minWidth: 82 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 3 }}>Points</Text><Text style={{ color: colors.dark, fontSize: 23, fontWeight: '900' }}>{availablePoints.toLocaleString()}</Text></View>
        <View style={{ minWidth: 78 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 3 }}>Times Earned</Text><Text style={{ color: colors.ink, fontSize: 12, fontWeight: '700' }}>{customer.timesEarned} times</Text></View>
        <View style={{ minWidth: 78 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 3 }}>Redeemed</Text><Text style={{ color: colors.ink, fontSize: 12, fontWeight: '700' }}>{customer.totalRedeemed.toLocaleString()}</Text></View>
        <View style={{ minWidth: 78 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginBottom: 3 }}>Member Since</Text><Text style={{ color: colors.ink, fontSize: 12, fontWeight: '700' }}>{customer.createdAt}</Text></View>
      </View>
    </View>
  </View>
}
function Profile({ onSignOut }: { onSignOut: () => void }) { return <><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.title}>Profile & settings</Text><View style={styles.profileCard}><View style={[styles.avatar, { backgroundColor: colors.green }]}><Text style={styles.avatarText}>JD</Text></View><Text style={styles.cardTitle}>Justin Davis</Text><Text style={styles.muted}>Cashier · Konnek Coffee</Text></View><Button title="Sign out" variant="secondary" onPress={onSignOut} /></> }
function BottomNav({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) { return <View style={styles.bottomNav}>{[['dashboard', 'grid-outline', 'Dashboard'], ['customers', 'people-outline', 'Customers'], ['profile', 'person-outline', 'Profile']].map(([key, icon, label]) => <Pressable key={key} onPress={() => setScreen(key as Screen)} style={styles.navItem}><Ionicons name={icon as any} size={21} color={screen === key ? colors.green : colors.muted} /><Text style={[styles.navLabel, screen === key && { color: colors.ink }]}>{label}</Text></Pressable>)}</View> }
function NfcModal({ mode, state, onClose, onRead }: { mode: NFCMode; state: 'idle' | 'waiting' | 'reading' | 'detected' | 'error'; onClose: () => void; onRead: () => void }) { if (mode === 'idle' || state === 'detected') return null; const registering = mode === 'create'; return <Modal transparent animationType="slide" visible onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Pressable onPress={onClose} style={styles.close}><Ionicons name="close" size={22} color={colors.ink} /></Pressable><View style={styles.nfcCircle}><Ionicons name="wifi" size={44} color={colors.ink} /></View><Text style={styles.eyebrow}>{registering ? 'NEW CUSTOMER' : 'LOYALTY CARD'}</Text><Text style={styles.modalTitle}>{state === 'reading' ? 'Reading card...' : state === 'error' ? 'Unable to read card' : registering ? 'Create Loyal Customer' : 'Tap loyalty card'}</Text><Text style={styles.muted}>{state === 'error' ? 'The NFC read attempt failed. Check that NFC is enabled, then try again.' : registering ? 'Tap the loyalty card\n\nHold the NFC loyalty card near the back of the phone to register this customer.' : 'Hold the card near the back of this phone. Konnek reads the identifier only and will not open websites.'}</Text>{state === 'error' ? <Button title="Try again" onPress={onRead} /> : <Button title={state === 'reading' ? 'Reading...' : 'Start NFC reader'} onPress={onRead} />}</View></View></Modal> }
function RegisterModal({ visible, cardId, onClose, onSave }: { visible: boolean; cardId: string; onClose: () => void; onSave: (data: Omit<Customer, 'id' | 'nfcCardId' | 'totalPoints' | 'timesEarned' | 'totalRedeemed' | 'createdAt' | 'color'>) => void }) { const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); return <Modal transparent animationType="slide" visible={visible} onRequestClose={() => undefined}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Pressable onPress={onClose} style={styles.close}><Ionicons name="close" size={22} color={colors.ink} /></Pressable><Text style={[styles.eyebrow, { color: colors.green }]}>CARD DETECTED</Text><Text style={styles.modalTitle}>Register customer</Text><Text style={styles.muted}>Card ID saved securely: {cardId}</Text><View style={styles.twoFields}><TextInput style={[styles.input, { flex: 1 }]} placeholder="First name" value={firstName} onChangeText={setFirstName} /><TextInput style={[styles.input, { flex: 1 }]} placeholder="Last name" value={lastName} onChangeText={setLastName} /></View><TextInput style={styles.input} placeholder="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" /><TextInput style={styles.input} placeholder="Phone number (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Button title="Save customer" onPress={() => firstName.trim() && lastName.trim() ? onSave({ firstName, lastName, email, phone }) : Alert.alert('Missing name', 'Enter the customer’s first and last name.')} /></View></View></Modal> }
function PointsModal({ customer, cardId, purchase, setPurchase, onClose, onFinish }: { customer: Customer | null; cardId: string; purchase: string; setPurchase: (s: string) => void; onClose: () => void; onFinish: () => void }) { if (!customer) return null; const points = Math.floor(Number(purchase || 0) / POINTS_PER_AMOUNT); return <Modal transparent animationType="slide" visible onRequestClose={() => undefined}><View style={styles.modalBackdrop}><View style={styles.modalCard}><Pressable onPress={onClose} style={styles.close}><Ionicons name="close" size={22} color={colors.ink} /></Pressable><View style={styles.customerHero}><View style={[styles.avatar, { backgroundColor: customer.color }]}><Text style={styles.avatarText}>{customer.firstName[0]}{customer.lastName[0]}</Text></View><View><Text style={styles.eyebrow}>LOYAL CUSTOMER</Text><Text style={styles.modalTitle}>{customer.firstName} {customer.lastName}</Text><Text style={styles.muted}>{customer.totalPoints.toLocaleString()} points available</Text><Text style={styles.nfcValue}>NFC URL / Card ID: {cardId || 'Not detected'}</Text></View></View><Text style={styles.label}>Order Total</Text><TextInput style={styles.purchaseInput} placeholder="₱1,250.00" value={purchase} onChangeText={setPurchase} keyboardType="decimal-pad" /><View style={styles.pointsResult}><Text style={styles.muted}>Points to earn</Text><Text style={styles.pointsValue}>{points} pts</Text></View><Button title="Award points" onPress={onFinish} /><Text style={styles.formNote}>Conversion rule: every ₱{POINTS_PER_AMOUNT} = 1 point.</Text></View></View></Modal> }

const colors = { cream: '#F7F4EC', ink: '#061B16', green: '#35D978', muted: '#6C7B76', line: '#D5E1DA', dark: '#12483D' }
const tableStyles = { table: { minWidth: 720, borderWidth: 1, borderColor: colors.line, borderRadius: 16, overflow: 'hidden' as const, backgroundColor: '#FFFDF7', marginBottom: 14 }, tableRow: { minHeight: 58, flexDirection: 'row' as const, alignItems: 'center' as const, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 14 }, tableHeader: { minHeight: 42, backgroundColor: '#EEF8F1' }, tableCell: { width: 110, color: colors.ink, fontSize: 12 }, nameCell: { width: 230 }, customerNameCell: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 }, tableStrong: { fontWeight: '900' as const, color: colors.dark }, tableName: { fontWeight: '800' as const, color: colors.dark }, tableAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center' as const, justifyContent: 'center' as const }, tableAvatarText: { fontSize: 10, fontWeight: '900' as const, color: colors.ink }, emptyTable: { padding: 20, color: colors.muted } }
const styles = StyleSheet.create({ ...tableStyles, nfcValue: { marginTop: 8, color: colors.dark, fontSize: 12, fontWeight: '800' }, customerAction: { marginTop: 18, marginBottom: 4 }, safe: { flex: 1, backgroundColor: colors.cream }, app: { flex: 1 }, content: { padding: 22, paddingBottom: 110 }, header: { height: 74, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line }, logo: { flexDirection: 'row', alignItems: 'center', gap: 9 }, logoMark: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }, logoText: { color: colors.ink, fontSize: 16, fontWeight: '900', letterSpacing: -0.5 }, headerUser: { flexDirection: 'row', alignItems: 'center', gap: 8 }, avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontWeight: '800', color: colors.ink }, eyebrow: { color: colors.dark, letterSpacing: 2.2, fontSize: 10, fontWeight: '800', marginTop: 22, marginBottom: 10 }, eyebrowLight: { color: '#B7F075', letterSpacing: 2.2, fontSize: 10, fontWeight: '800', marginBottom: 14 }, title: { color: colors.ink, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginBottom: 7 }, muted: { color: colors.muted, fontSize: 14, lineHeight: 21 }, smallMuted: { color: colors.muted, fontSize: 12, lineHeight: 18 }, tapBanner: { backgroundColor: colors.green, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 18 }, tapIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.5)', alignItems: 'center', justifyContent: 'center' }, cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 3 }, statGrid: { flexDirection: 'row', gap: 10 }, stat: { flex: 1, backgroundColor: '#FFFDF7', borderRadius: 18, padding: 13, borderWidth: 1, borderColor: colors.line }, statIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }, statValue: { color: colors.ink, fontSize: 23, fontWeight: '900', marginTop: 5 }, trend: { color: '#269C59', fontSize: 11, marginTop: 4 }, sectionRow: { marginTop: 28, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.ink }, link: { color: colors.ink, fontWeight: '800', fontSize: 13 }, customerCard: { backgroundColor: '#FFFDF7', borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }, button: { backgroundColor: colors.green, borderRadius: 15, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, buttonText: { color: colors.ink, fontSize: 15, fontWeight: '900' }, secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line }, secondaryText: { color: colors.ink }, search: { backgroundColor: '#FFFDF7', borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 15, height: 50, marginTop: 22, marginBottom: 18, fontSize: 14 }, bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 78, backgroundColor: '#FFFDF7', borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 13 }, navItem: { alignItems: 'center', gap: 3, minWidth: 70 }, navLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' }, profileCard: { backgroundColor: '#FFFDF7', borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 20, alignItems: 'center', marginTop: 25 }, login: { flex: 1, backgroundColor: colors.dark }, loginBrand: { flex: 1, padding: 26 }, loginCopy: { marginTop: 100 }, loginTitle: { color: colors.cream, fontSize: 45, lineHeight: 44, fontWeight: '900', letterSpacing: -2 }, loginDescription: { color: '#D5E8DF', fontSize: 16, lineHeight: 24, marginTop: 22, maxWidth: 320 }, bullet: { color: '#D5E8DF', marginTop: 18, fontWeight: '700' }, loginForm: { backgroundColor: colors.cream, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 26, paddingTop: 28 }, field: { marginTop: 18 }, label: { color: colors.ink, fontWeight: '800', fontSize: 13, marginBottom: 7 }, input: { height: 50, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFDF7', borderRadius: 13, paddingHorizontal: 14, fontSize: 14, color: colors.ink, marginTop: 9 }, formNote: { textAlign: 'center', color: colors.muted, fontSize: 11, marginTop: 14 }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(6,27,22,.45)' }, modalCard: { backgroundColor: colors.cream, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 32 }, close: { position: 'absolute', right: 20, top: 18, zIndex: 2, padding: 5 }, nfcCircle: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 8, marginBottom: 8 }, modalTitle: { fontSize: 25, color: colors.ink, fontWeight: '900', marginBottom: 8 }, twoFields: { flexDirection: 'row', gap: 10, marginTop: 20 }, customerHero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, marginBottom: 24 }, purchaseInput: { backgroundColor: '#FFFDF7', borderColor: colors.line, borderWidth: 1, borderRadius: 15, height: 62, paddingHorizontal: 18, fontSize: 27, fontWeight: '800', marginTop: 8 }, pointsResult: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E7F8E9', borderRadius: 14, padding: 15, marginTop: 14 }, pointsValue: { fontSize: 20, fontWeight: '900', color: colors.ink } })

