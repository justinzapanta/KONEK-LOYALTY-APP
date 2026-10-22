import { AppState, Platform } from 'react-native'
import NfcManager, { NfcAdapter, NfcEvents, NfcTech, TagEvent } from 'react-native-nfc-manager'
import { extractCardKey, UnregisteredNfcError } from './cardKey'

export type ReadTagResult = { id?: string; url?: string; ndefMessage?: TagEvent['ndefMessage']; techTypes?: string[] }
export type NfcAvailability = 'checking' | 'enabled' | 'disabled' | 'unsupported' | 'unavailable'
export class NfcAvailabilityError extends Error {
  constructor(public availability: NfcAvailability) {
    super(availability === 'disabled' ? 'NFC is turned off. Turn it on in your phone settings to scan a KONEK card.' : availability === 'unsupported' ? 'This device does not support NFC. You can still use the customer’s phone number.' : 'Unable to check NFC. Please try again on an NFC-enabled phone.')
    this.name = 'NfcAvailabilityError'
  }
}
const availabilityListeners = new Set<(status: NfcAvailability) => void>()
let availability: NfcAvailability = 'checking'
let availabilityEpoch = 0
function publishAvailability(status: NfcAvailability) {
  availability = status
  if (status !== 'enabled' && pendingRead) {
    const read = pendingRead; pendingRead = null
    read.reject(new NfcAvailabilityError(status))
  }
  for (const listener of availabilityListeners) listener(status)
}
async function checkAvailability(): Promise<NfcAvailability> {
  const epoch = availabilityEpoch
  const publish = (status: NfcAvailability) => {
    if (epoch !== availabilityEpoch) return availability
    publishAvailability(status)
    return status
  }
  try {
    if (Platform.OS === 'web' || !await NfcManager.isSupported()) {
      return publish('unsupported')
    }
    await NfcManager.start()
    const status = Platform.OS === 'android' && !await NfcManager.isEnabled() ? 'disabled' : 'enabled'
    return publish(status)
  } catch {
    return publish('unavailable')
  }
}
async function ensureReady() {
  const status = await checkAvailability()
  if (status !== 'enabled') throw new NfcAvailabilityError(status)
}

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

function parseTag(tag: TagEvent): ReadTagResult {
  const url = decodeUrl(tag)
  if (!url) throw new UnregisteredNfcError()
  return { id: extractCardKey(url), url, ndefMessage: tag.ndefMessage, techTypes: tag.techTypes }
}

type PendingRead = { resolve: (tag: ReadTagResult) => void; reject: (error: Error) => void }
let pendingRead: PendingRead | null = null
let captureEnabled = false
let captureWanted = false
let captureStarting: Promise<void> | null = null
let captureTransition: Promise<void> = Promise.resolve()
let captureLifetime = 0

function handleForegroundTag(tag: TagEvent) {
  // The native reader stays active over modals, but only an explicit app scan
  // may consume a tag. Never retain a tag tapped during another customer flow.
  if (AppState.currentState !== 'active' || availability !== 'enabled' || !pendingRead) return
  const read = pendingRead
  pendingRead = null
  try { read.resolve(parseTag(tag)) }
  catch (error) { read.reject(error instanceof Error ? error : new UnregisteredNfcError()) }
}

async function initializeForegroundCapture(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve()
  const lifetime = captureLifetime
  await ensureReady()
  if (lifetime !== captureLifetime) return
  captureWanted = true
  if (captureEnabled) return Promise.resolve()
  if (captureStarting) return captureStarting
  captureStarting = captureTransition.then(async () => {
    if (!captureWanted || captureEnabled) return
    await NfcManager.start()
    if (!captureWanted) return
    NfcManager.setEventListener(NfcEvents.DiscoverTag, handleForegroundTag)
    await NfcManager.registerTagEvent({
      isReaderModeEnabled: true,
      readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B |
        NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V,
      readerModeDelay: 250,
      invalidateAfterFirstRead: false,
    })
    captureEnabled = true
  }).finally(() => { captureStarting = null })
  captureTransition = captureStarting.catch(() => {})
  return captureStarting
}

export const nfcService = {
  checkAvailability,
  watchAvailability(listener: (status: NfcAvailability) => void) {
    availabilityListeners.add(listener)
    listener(availability)
    if (Platform.OS === 'android') NfcManager.setEventListener(NfcEvents.StateChanged, (event: { state: string }) => {
      if (event.state === 'off' || event.state === 'turning_off') {
        availabilityEpoch += 1
        publishAvailability('disabled')
      }
      else void checkAvailability()
    })
    void checkAvailability()
    return () => {
      availabilityListeners.delete(listener)
      if (!availabilityListeners.size && Platform.OS === 'android') NfcManager.setEventListener(NfcEvents.StateChanged, null)
    }
  },
  async openSettings() {
    if (Platform.OS !== 'android') throw new Error('NFC settings are managed by your phone.')
    await NfcManager.goToNfcSetting()
  },
  initializeForegroundCapture,
  async readTag(): Promise<ReadTagResult | null> {
    if (Platform.OS === 'android') {
      if (pendingRead) throw new Error('An NFC scan is already in progress.')
      return new Promise<ReadTagResult>((resolve, reject) => {
        const read = { resolve, reject }
        pendingRead = read
        void initializeForegroundCapture().catch(error => {
          if (pendingRead !== read) return
          pendingRead = null
          reject(error)
        })
      })
    }
    await ensureReady()
    await NfcManager.start()
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Hold the loyalty card near the back of your phone.',
    })

    const tag = await NfcManager.getTag()
    if (!tag) return null

    return parseTag(tag)
  },

  async stop() {
    if (Platform.OS === 'android') {
      const read = pendingRead
      pendingRead = null
      read?.reject(new Error('NFC scan cancelled.'))
      // Keep reader mode registered: cancelling a customer flow must never
      // hand an HTTP NFC link to Android's browser while this app is active.
      return
    }
    try {
      await NfcManager.cancelTechnologyRequest()
    } catch {
      // No active NFC request is safe to ignore.
    }
  },

  async dispose() {
    captureLifetime += 1
    captureWanted = false
    await nfcService.stop()
    if (Platform.OS !== 'android') return
    const release = captureTransition.then(async () => {
      if (captureWanted || !captureEnabled) return
      captureEnabled = false
      await NfcManager.unregisterTagEvent()
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null)
    })
    captureTransition = release.catch(() => {})
    await release
  },
}

