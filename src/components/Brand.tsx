import { Image, Platform, Text, View } from 'react-native'
import { colors, styles } from '../theme/tokens'

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return <View style={styles.logo} accessibilityLabel="KONEK">
    <View style={[styles.logoMark, { borderRadius: 12, backgroundColor: colors.ink }]}>
      <Image source={require('../../assets/nfc-mark.png')} style={{ width: 24, height: 24 }} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
    <Text style={[styles.logoText, { color: inverse ? colors.cream : colors.ink, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>KONEK<Text style={{ color: colors.green }}>.</Text></Text>
  </View>
}
