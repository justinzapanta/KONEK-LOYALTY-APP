export const UNREGISTERED_NFC_MESSAGE = 'This NFC card is not registered with KONEK. Only registered KONEK NFC cards are allowed. Please tap a KONEK loyalty card.'
export class UnregisteredNfcError extends Error {
  constructor() { super(UNREGISTERED_NFC_MESSAGE); this.name = 'UnregisteredNfcError' }
}
/** NFC stores /businessUuid/card_key; API/database requests use only card_key. */
export function extractCardKey(value: string): string {
  try {
    const input = value.trim()
    if (!/^https?:\/\//i.test(input)) {
      if (!/^[A-Za-z0-9-]{1,200}$/.test(input)) throw new UnregisteredNfcError()
      return input
    }
    const url = new URL(input)
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segments[0])) throw new UnregisteredNfcError()
    const key = decodeURIComponent(segments[1])
    if (!/^[A-Za-z0-9-]{1,200}$/.test(key)) throw new UnregisteredNfcError()
    return key
  } catch { throw new UnregisteredNfcError() }
}
