import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/tokens'

export function NfcProcessingOverlay({ message }: { message: string }) {
  return <View style={styles.backdrop} accessibilityViewIsModal>
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLabel={message} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.dark} />
      <Text style={styles.title}>{message}</Text>
      <Text style={styles.description}>Please wait while we check the card and load the customer’s account.</Text>
    </View>
  </View>
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 2000, elevation: 20, backgroundColor: 'rgba(8,23,17,0.38)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.cream, borderRadius: 28, padding: 28, alignItems: 'center', gap: 16 },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  description: { fontSize: 14, lineHeight: 22, color: colors.muted, textAlign: 'center' },
})
