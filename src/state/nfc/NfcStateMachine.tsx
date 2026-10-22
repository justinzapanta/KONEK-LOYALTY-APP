import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { UnregisteredNfcError } from '../../services/nfc/cardKey'
import { Alert, AppState } from 'react-native'
import { nfcService, NfcAvailability, NfcAvailabilityError } from '../../services/nfc/nfcService'
import { NFCMode } from '../../types/loyalty'

type NfcState =
  | 'idle'
  | 'waiting'
  | 'reading'
  | 'detected'
  | 'error'

type NfcTag = {
  id: string
}

type NfcContextValue = {
  availability: NfcAvailability
  mode: NFCMode
  state: NfcState
  tag: NfcTag | null
  error: Error | null

  start: (
    mode: Exclude<NFCMode, 'idle'>
  ) => void

  cancel: () => void
  retry: () => void
  consumeTag: () => NfcTag | null
  setPromptsSuppressed: (suppressed: boolean) => void
  isPromptOpen: () => boolean
}

const NfcContext =
  createContext<NfcContextValue | null>(null)

export function NfcStateMachineProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [availability, setAvailability] = useState<NfcAvailability>('checking')
  const promptVisible = useRef(false)
  const promptsSuppressed = useRef(false)
  const offPromptShown = useRef(false)
  const pausedForNfc = useRef(false)

  const promptForNfc = useCallback((force = false) => {
    if (promptsSuppressed.current || AppState.currentState !== 'active' || promptVisible.current || (!force && offPromptShown.current)) return
    promptVisible.current = true
    offPromptShown.current = true
    const dismiss = () => { promptVisible.current = false }
    Alert.alert('Turn on NFC',
      'NFC is switched off. Turn it on to scan KONEK loyalty cards. You can still use a customer’s phone number.',
      [
        { text: 'Not now', style: 'cancel', onPress: dismiss },
        { text: 'Turn on NFC', onPress: () => {
          dismiss()
          void nfcService.openSettings().catch(() => {
            Alert.alert('Open NFC settings', 'Open your phone’s Settings and turn on NFC, then return to KONEK.')
          })
        } },
      ], { cancelable: true, onDismiss: dismiss })
  }, [])
  const setPromptsSuppressed = useCallback((suppressed: boolean) => {
    if (promptsSuppressed.current === suppressed) return
    promptsSuppressed.current = suppressed
    if (!suppressed) void nfcService.checkAvailability().catch(() => {})
  }, [])
  const isPromptOpen = useCallback(() => promptVisible.current, [])
  const [readError, setReadError] = useState<Error | null>(null)
  const [mode, setMode] =
    useState<NFCMode>('idle')

  const [state, setState] =
    useState<NfcState>('idle')

  const [tag, setTag] =
    useState<NfcTag | null>(null)

  const generation =
    useRef(0)

  const modeRef =
    useRef<NFCMode>('idle')

  const stateRef =
    useRef<NfcState>('idle')

  const tagRef =
    useRef<NfcTag | null>(null)

  const cancel = useCallback(() => {
    pausedForNfc.current = false
    generation.current += 1

    modeRef.current = 'idle'
    stateRef.current = 'idle'
    tagRef.current = null

    setReadError(null)
    setMode('idle')
    setState('idle')
    setTag(null)

    void nfcService.stop()
  }, [])

  const activate = useCallback(
    (
      requestedMode: Exclude<
        NFCMode,
        'idle'
      >
    ) => {
      generation.current += 1
      pausedForNfc.current = false

      const currentGeneration =
        generation.current

      void nfcService
        .stop()
        .then(async () => {
          if (
            currentGeneration !==
            generation.current
          ) {
            return
          }

          modeRef.current =
            requestedMode

          stateRef.current =
            'reading'

          tagRef.current =
            null

          setMode(
            requestedMode
          )

          setState(
            'reading'
          )

          setReadError(null)
          setTag(null)

          try {
            const result =
              await nfcService.readTag()

            if (
              currentGeneration !==
                generation.current ||
              modeRef.current !==
                requestedMode
            ) {
              return
            }

            const id =
              result?.id

            if (!id) {
              throw new UnregisteredNfcError()
            }

            const nextTag: NfcTag = {
              id,
            }

            tagRef.current =
              nextTag

            stateRef.current =
              'detected'

            setTag(nextTag)
            setState('detected')

            /*
             * IMPORTANT:
             *
             * Do NOT cancel the whole NFC flow.
             *
             * We only finish the current read; Android capture stays active.
             * React still keeps:
             *
             * mode = create/reward
             * state = detected
             * tag = detected card
             */
            await nfcService.stop()
          } catch (error) {
            if (
              currentGeneration !==
              generation.current
            ) {
              return
            }

            await nfcService.stop()
            if (currentGeneration !== generation.current) return
            if (error instanceof NfcAvailabilityError) {
              pausedForNfc.current = error.availability !== 'unsupported'
              stateRef.current = 'waiting'
              setState('waiting')
              if (error.availability === 'disabled') {
                promptForNfc(true)
              } else {
                Alert.alert(error.availability === 'unsupported' ? 'NFC unavailable' : 'Unable to check NFC', error.message)
              }
              return
            }
            setReadError(error instanceof Error ? error : new Error('Unable to read the NFC card. Please try again.'))

            stateRef.current =
              'error'

            setState('error')
          }
        })
    },
    [promptForNfc]
  )

  const retry = useCallback(() => {
    const activeMode =
      modeRef.current

    if (
      activeMode === 'idle'
    ) {
      return
    }

    activate(activeMode)
  }, [activate])

  const consumeTag =
    useCallback(() => {
      const detectedTag =
        tagRef.current

      if (!detectedTag) {
        return null
      }

      /*
       * Clear the tag from the ref
       * so it can only be consumed once.
       */
      tagRef.current = null

      /*
       * Also clear React state so the
       * useEffect in App.tsx does not
       * process the same card again.
       */
      setTag(null)

      return detectedTag
    }, [])

  useEffect(() => {
    let mounted = true
    let previous: NfcAvailability = 'checking'
    const unsubscribe = nfcService.watchAvailability(status => {
      if (!mounted) return
      if (status !== previous) offPromptShown.current = false
      previous = status
      setAvailability(status)
      if (status === 'disabled') promptForNfc()
    })
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        offPromptShown.current = false
        void nfcService.checkAvailability()
      }
    })
    return () => {
      mounted = false
      unsubscribe()
      subscription.remove()
      generation.current += 1
      void nfcService.dispose().catch(() => {})
    }
  }, [promptForNfc])

  useEffect(() => {
    if (availability !== 'enabled') return
    // Keep Android reader capture active over modal gaps so URL cards stay
    // inside KONEK. A cancelled flow must not restart after NFC is enabled.
    void nfcService.initializeForegroundCapture().catch(() => {})
  }, [availability])

  useEffect(() => {
    if (availability !== 'enabled') return
    if (pausedForNfc.current && stateRef.current === 'waiting' && modeRef.current !== 'idle') {
      activate(modeRef.current)
    }
  }, [availability, state, activate])

  const value =
    useMemo<NfcContextValue>(
      () => ({
        availability,
        mode,
        state,
        tag,
        error: readError,
        start: activate,
        cancel,
        retry,
        consumeTag,
        setPromptsSuppressed,
        isPromptOpen,
      }),
      [
        availability,
        mode,
        state,
        tag,
        readError,
        activate,
        cancel,
        retry,
        consumeTag,
        setPromptsSuppressed,
        isPromptOpen,
      ]
    )

  return (
    <NfcContext.Provider
      value={value}
    >
      {children}
    </NfcContext.Provider>
  )
}

export function useNfcStateMachine() {
  const context =
    useContext(NfcContext)

  if (!context) {
    throw new Error(
      'useNfcStateMachine must be used inside NfcStateMachineProvider'
    )
  }

  return context
}

export function isNfcError(
  state: NfcState
) {
  return state === 'error'
}
