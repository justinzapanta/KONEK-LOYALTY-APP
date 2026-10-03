import { StyleSheet } from 'react-native'

export const colors = { cream: '#F7F4EC', ink: '#061B16', green: '#35D978', muted: '#6C7B76', line: '#D5E1DA', dark: '#12483D', white: '#FFFDF7' } as const

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  app: { flex: 1 },
  content: { padding: 22, paddingBottom: 110 },
  header: { height: 74, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoMark: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: colors.ink, fontSize: 16, fontWeight: '900', letterSpacing: -0.5 },
  title: { color: colors.ink, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginBottom: 7 },
  modalTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  smallMuted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  eyebrow: { color: colors.dark, letterSpacing: 2.2, fontSize: 10, fontWeight: '800', marginTop: 22, marginBottom: 10 },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 3 },
  button: { minHeight: 50, borderRadius: 15, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 14 },
  buttonText: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  secondaryText: { color: colors.ink },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: colors.ink },
  customerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, marginBottom: 10 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 13, paddingHorizontal: 14, color: colors.ink, backgroundColor: colors.white, marginTop: 10 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(6,27,22,.35)' },
  modalCard: { backgroundColor: colors.cream, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 34 },
  close: { alignSelf: 'flex-end', padding: 5 },
})
