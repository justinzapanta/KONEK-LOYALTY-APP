import { CameraView } from 'expo-camera'

let scannerOpen = false

/** Android owns this full-screen camera; no React Native preview surface is mounted. */
export async function scanRewardCode(kind: "reward" | "counter" = "reward"): Promise<string | null> {
  if (scannerOpen) return null
  if (!CameraView.isModernBarcodeScannerAvailable) {
    throw new Error(`The scanner is unavailable. Update Google Play services, or enter the ${kind} code below.`)
  }
  scannerOpen = true
  let value: string | null = null
  let subscription: { remove: () => void } | undefined
  try {
    subscription = CameraView.onModernBarcodeScanned(event => {
      if (value === null && event.data) value = event.data
    })
    await CameraView.launchScanner({ barcodeTypes: ['qr', 'code128', 'code39'] })
    return value
  } catch (cause) {
    const error = cause as { code?: string; message?: string }
    if (/cancel/i.test(error.code || '') || /cancel/i.test(error.message || '')) return null
    throw new Error(`Unable to open the scanner. Connect to the internet for its first setup and update Google Play services, then try again. You can also enter the ${kind} code below.`)
  } finally {
    subscription?.remove()
    scannerOpen = false
  }
}
