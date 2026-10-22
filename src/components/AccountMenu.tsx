import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type {BranchAccess} from '../services/api/loyalty'
import { Button } from './FormControls'
import { colors } from '../theme/tokens'

export function AccountMenu({ branchAccess,onBranchChange,visible, name, email, businessName, initials, signingOut, onClose, onSignOut }: {
  branchAccess?:BranchAccess;onBranchChange:(id:string)=>void;
  visible: boolean; name: string; email: string; businessName: string; initials: string;
  signingOut: boolean; onClose: () => void; onSignOut: () => void;
}) {
  const close = () => { if (!signingOut) onClose() }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <View style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss account menu" disabled={signingOut} onPress={close} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={styles.card}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>My account</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close account menu" disabled={signingOut} onPress={close} hitSlop={8} style={styles.close}>
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <View style={styles.avatar}><Text style={styles.initials}>{initials}</Text></View>
            <View style={styles.details}>
              <Text style={styles.name}>{name}</Text>
              {!!email && <Text style={styles.email}>{email}</Text>}
            </View>
          </View>
          <View style={styles.workspace}>
            <Ionicons name="business-outline" size={21} color={colors.ink} />
            <View style={styles.details}><Text style={styles.label}>BUSINESS WORKSPACE</Text><Text style={styles.business}>{businessName}</Text></View>
          </View>
          {!!branchAccess&&<View style={{gap:8}}><Text style={styles.label}>WORKING BRANCH</Text>{branchAccess.can_select?branchAccess.branches.filter(branch=>branch.status==='active').map(branch=><Pressable key={branch.id} accessibilityRole="button" disabled={signingOut} onPress={()=>onBranchChange(branch.id)} style={{padding:12,borderWidth:1,borderColor:branchAccess.branch_id===branch.id?colors.green:colors.line,borderRadius:12}}><Text style={{color:colors.ink}}>{branchAccess.branch_id===branch.id?'✓ ':''}{branch.name}</Text></Pressable>):<Text style={styles.business}>{branchAccess.branch_name}</Text>}<Text style={styles.email}>{branchAccess.can_select?'Purchases and reward collections will be recorded at the selected branch.':'Your branch is assigned by an owner or Admin.'}</Text></View>}
          <Button title={signingOut ? 'Signing out…' : 'Sign out'} variant="secondary" loading={signingOut} onPress={onSignOut} />
        </ScrollView>
      </View>
    </View>
  </Modal>
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(8,23,17,0.48)' },
  card: { width: '100%', maxWidth: 420, maxHeight: '85%', borderRadius: 28, backgroundColor: colors.cream, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  body: { padding: 24, gap: 22 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  details: { flex: 1, minWidth: 0 },
  name: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  email: { color: colors.muted, fontSize: 13, marginTop: 5 },
  workspace: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  label: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  business: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 5 },
})
