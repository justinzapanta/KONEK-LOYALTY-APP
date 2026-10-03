import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { nfcService } from '../../services/nfc/nfcService'
import { NFCMode } from '../../types/loyalty'

type NfcState = 'idle' | 'waiting' | 'reading' | 'detected' | 'error'
type NfcTag = { id: string }

type NfcContextValue = {
  mode: NFCMode
  state: NfcState
  tag: NfcTag | null
  start: (mode: Exclude<NFCMode, 'idle'>) => void
  cancel: () => void
  retry: () => void
  consumeTag: () => NfcTag | null
}

const NfcContext = createContext<NfcContextValue | null>(null)

export function NfcStateMachineProvider({ children, onTag }: { children: React.ReactNode; onTag: (mode: Exclude<NFCMode, 'idle'>, tag: NfcTag) => void }) {
  const [mode, setMode] = useState<NFCMode>('idle')
  const [state, setState] = useState<NfcState>('idle')
  const [tag, setTag] = useState<NfcTag | null>(null)
  const generation = useRef(0)
  const modeRef = useRef(mode)
  const stateRef = useRef(state)
  const onTagRef = useRef(onTag)
  modeRef.current = mode
  stateRef.current = state
  onTagRef.current = onTag

  const cancel = useCallback(() => {
    generation.current += 1
    void nfcService.stop()
    modeRef.current = 'idle'
    setTag(null)
    setMode('idle')
    setState('idle')
  }, [])

  const activate = useCallback((requestedMode: Exclude<NFCMode, 'idle'>) => {
    generation.current += 1
    const currentGeneration = generation.current
    void nfcService.stop().then(async () => {
      if (currentGeneration !== generation.current) return
      modeRef.current = requestedMode
      setTag(null)
      setMode(requestedMode)
      setState('reading')
      try {
        const result = await nfcService.readTag()
        if (currentGeneration !== generation.current || modeRef.current !== requestedMode) return
        // Temporary contract: use the decoded NDEF URL as the card UUID/key.
        // If the platform returns the tag identifier but omits parsed NDEF
        // records, keep the flow visible so the detected value can be verified.
        const id = result?.id ?? result?.url
        if (!id) throw new Error('No NFC card identifier found')
        const nextTag = { id }
        setTag(nextTag)
        // Route first, while the captured mode is authoritative. The app
        // opens the CREATE or REWARD modal from this single callback only.
        setState('detected')
        onTagRef.current(requestedMode, nextTag)
        await nfcService.stop()
        // Keep the mode in `detected` until the follow-up form closes or submits.
        // This prevents cleanup from unmounting the form during the same render.
      } catch {
        if (currentGeneration === generation.current) setState('error')
      }
    })
  }, [])

  const retry = useCallback(() => {
    const activeMode = modeRef.current
    if (activeMode !== 'idle') activate(activeMode)
  }, [activate])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      // Only cancel while scanning. Once a tag is detected, the follow-up
      // form owns dismissal and must remain open until Close or Submit.
      if (nextState !== 'active' && modeRef.current !== 'idle' && stateRef.current !== 'detected') cancel()
    })
    return () => {
      subscription.remove()
      void nfcService.stop()
    }
  }, [cancel])

  const value = useMemo(() => ({ mode, state, tag, start: activate, cancel, retry, consumeTag: () => tag }), [mode, state, tag, activate, cancel, retry])
  return <NfcContext.Provider value={value}>{children}</NfcContext.Provider>
}

export function useNfcStateMachine() {
  const context = useContext(NfcContext)
  if (!context) throw new Error('useNfcStateMachine must be used inside NfcStateMachineProvider')
  return context
}

export function isNfcError(state: NfcState) {
  return state === 'error'
}
