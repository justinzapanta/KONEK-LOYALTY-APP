import NfcManager, { NfcTech, TagEvent } from 'react-native-nfc-manager'

export type ReadTagResult = { id?: string; url?: string; ndefMessage?: TagEvent['ndefMessage']; techTypes?: string[] }

const uriPrefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://']

function decodeUrl(tag: TagEvent): string | undefined {
  const records = tag.ndefMessage ?? []
  const uriRecord = records.find((record) => record.tnf === 1 && record.type?.[0] === 0x55)
  if (uriRecord?.payload && uriRecord.payload.length > 1) {
    const prefix = uriPrefixes[uriRecord.payload[0]]
    if (prefix !== undefined) return `${prefix}${String.fromCharCode(...uriRecord.payload.slice(1))}`
  }

  const textRecord = records.find((record) => record.tnf === 1 && record.type?.[0] === 0x54)
  if (textRecord?.payload && textRecord.payload.length > 1) {
    const languageLength = textRecord.payload[0] & 0x3f
    return String.fromCharCode(...textRecord.payload.slice(languageLength + 1)).trim() || undefined
  }

  return undefined
}

export const nfcService = {
  async readTag(): Promise<ReadTagResult | null> {
    await NfcManager.start()
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Hold the loyalty card near the back of your phone.',
    })

    const tag = await NfcManager.getTag()
    if (!tag) return null

    // The URL is data only. It becomes the temporary loyalty-card UUID/key.
    const url = decodeUrl(tag)
    return { id: url ?? tag.id, url, ndefMessage: tag.ndefMessage, techTypes: tag.techTypes }
  },

  async stop() {
    try {
      await NfcManager.cancelTechnologyRequest()
    } catch {
      // No active NFC request is safe to ignore.
    }
  },
}

