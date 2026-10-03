import { Ionicons } from '@expo/vector-icons'
import { Text, View } from 'react-native'
import { colors, styles } from '../theme/tokens'

export function Logo() { return <View style={styles.logo}><View style={styles.logoMark}><Ionicons name="wifi" size={20} color={colors.ink} /></View><Text style={styles.logoText}>KON<Text style={{ color: colors.green }}>EK</Text>.</Text></View> }
