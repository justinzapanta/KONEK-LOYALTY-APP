import { Pressable, Text, TextInput, View } from 'react-native'
import { colors, styles } from '../theme/tokens'

export function Button({ title, onPress, variant = 'primary' }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary' }) { return <Pressable onPress={onPress} style={[styles.button, variant === 'secondary' && styles.secondaryButton]}><Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryText]}>{title}</Text></Pressable> }

export function Field({ label, placeholder, value, secure }: { label: string; placeholder: string; value?: string; secure?: boolean }) { return <View><Text style={{ color: colors.ink, fontWeight: '700', marginTop: 13 }}>{label}</Text><TextInput style={styles.input} placeholder={placeholder} defaultValue={value} secureTextEntry={secure} autoCapitalize="none" /></View> }
