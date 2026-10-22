import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { colors, styles } from '../theme/tokens'
import { useRequestStatus } from '../state/RequestStatus'

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean; loading?: boolean }) {
  const pending = !!useRequestStatus() || disabled || loading
  return <Pressable onPress={onPress} disabled={pending} accessibilityRole="button" accessibilityState={{ disabled: pending, busy: loading }} style={[styles.button, pending && { opacity: 0.6 }, variant === 'secondary' && styles.secondaryButton]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{loading && <ActivityIndicator size="small" color={variant === 'secondary' ? colors.ink : colors.dark} />}<Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryText]}>{title}</Text></View></Pressable>
}

export function Field({ label, placeholder, value, secure, onChangeText, onFocus }: { label: string; placeholder: string; value?: string; secure?: boolean; onChangeText?: (value: string) => void; onFocus?: () => void }) { return <View><Text style={{ color: colors.ink, fontWeight: '700', marginTop: 13 }}>{label}</Text><TextInput style={styles.input} placeholder={placeholder} value={value} onChangeText={onChangeText} onFocus={onFocus} secureTextEntry={secure} autoCapitalize="none" /></View> }
