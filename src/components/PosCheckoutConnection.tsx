import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCameraPermissions } from "expo-camera";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth, ApiError } from "../services/api/client";
import {
  readPosBinding,
  pairPosPhone,
  loadPosQueue,
  forgetPosBinding,
  type PosBinding,
  type PosPurchase,
} from "../services/pos-checkout";
import { scanRewardCode } from "../services/nativeRewardScanner";
export function PosCheckoutConnection({
  selectedId,
  onSelect,
  onClear,
  onModalChange,
  branchName,
  pairRequest,
  onPairRequestHandled,
  paused = false,
}: {
  selectedId?: string;
  onSelect: (purchase: PosPurchase) => void;
  onClear: () => void;
  onModalChange: (open: boolean) => void;
  branchName?: string | null;
  pairRequest?: { code: string; id: number } | null;
  onPairRequestHandled?: (id: number) => void;
  paused?: boolean;
}) {
  const [binding, setBinding] = useState<PosBinding | null>(null),
    [counterCode, setCounterCode] = useState(""),
    [currency, setCurrency] = useState("PHP"),
    [rows, setRows] = useState<PosPurchase[]>([]),
    [pairOpen, setPairOpen] = useState(false),
    [code, setCode] = useState(""),
    [name, setName] = useState("Counter phone"),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [, requestPermission] = useCameraPermissions();
  const alive = useRef(true),
    requestLock = useRef(false),
    pairLock = useRef(false),
    realtime = useRef<SupabaseClient | null>(null),
    debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanLock = useRef(false);
  useEffect(() => {
    // An app link only pre-fills the form. Sign-in, branch checks and explicit
    // confirmation still happen before the existing authenticated pair request.
    if (!pairRequest || paused) return;
    setCode(pairRequest.code);
    setError("");
    setPairOpen(true);
    onPairRequestHandled?.(pairRequest.id);
  }, [pairRequest, paused, onPairRequestHandled]);
  useEffect(() => {
    onModalChange(pairOpen);
    return () => onModalChange(false);
  }, [pairOpen, onModalChange]);
  useEffect(() => {
    alive.current = true;
    void readPosBinding()
      .then((value) => {
        if (alive.current) {
          setBinding(value);
        }
      })
      .catch((cause) => {
        if (alive.current) setError(cause.message);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!binding) return;
    let active = true;
    async function refresh() {
      if (
        !active ||
        requestLock.current ||
        AppState.currentState === "background" ||
        AppState.currentState === "inactive"
      )
        return;
      requestLock.current = true;
      try {
        const data = await loadPosQueue(binding!);
        if (!active) return;
        setRows(data.rows);
        if (data.counter_code) setCounterCode(data.counter_code);
        if (data.currency) setCurrency(data.currency);
        setError("");
        if (realtime.current)
          await realtime.current.realtime.setAuth(await auth.realtimeToken());
        if (!realtime.current && data.realtime?.url && data.realtime.anonKey) {
          const client = createClient(
            data.realtime.url,
            data.realtime.anonKey,
            {
              auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
              },
            },
          );
          realtime.current = client;
          await client.realtime.setAuth(await auth.realtimeToken());
          client
            .channel("checkout:" + binding!.checkout_id)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "konek_pos_signals",
                filter: "checkout_id=eq." + binding!.checkout_id,
              },
              () => {
                if (debounce.current) clearTimeout(debounce.current);
                debounce.current = setTimeout(() => void refresh(), 400);
              },
            )
            .subscribe((status) => {
              if (active)
                setNotice(
                  status === "SUBSCRIBED"
                    ? "Connected · New purchases update automatically"
                    : "Connected · Refresh available if updates are delayed",
                );
            });
        }
      } catch (cause) {
        if (!active) return;
        const e = cause as Error;
        setError(e.message);
        if (cause instanceof ApiError && cause.status === 403) {
          await forgetPosBinding();
          setBinding(null);
          setRows([]);
          onClear();
        }
      } finally {
        requestLock.current = false;
      }
    }
    const disconnect = () => {
      if (realtime.current) {
        void realtime.current.removeAllChannels();
        realtime.current = null;
      }
    };
    void refresh();
    const changes = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
      else disconnect();
    });
    const fallback = setInterval(() => void refresh(), 60000);
    const manual = () => void refresh();
    refreshRef.current = manual;
    return () => {
      active = false;
      changes.remove();
      clearInterval(fallback);
      if (debounce.current) clearTimeout(debounce.current);
      disconnect();
      refreshRef.current = null;
    };
  }, [binding]);
  const refreshRef = useRef<(() => void) | null>(null);
  async function pair(raw = code) {
    if (pairLock.current) return;
    pairLock.current = true;
    setPending("Connecting this phone…");
    setError("");
    try {
      const value = await pairPosPhone(raw, name);
      if (alive.current) {
        setBinding(value);
        setCounterCode(value.counter_code ?? "");
        if (value.currency) setCurrency(value.currency);
        setPairOpen(false);
        setCode("");
        setRows([]);
        onClear();
      }
    } catch (cause) {
      if (alive.current) setError((cause as Error).message);
    } finally {
      pairLock.current = false;
      if (alive.current) setPending("");
    }
  }
  async function scan() {
    if (pairLock.current || scanLock.current) return;
    scanLock.current = true;
    try {
      const permission = await requestPermission();
      if (!permission.granted) {
        setError("Allow camera access or enter the pairing code.");
        return;
      }
      setPending("Opening scanner…");
      const value = await scanRewardCode("counter");
      setPending("");
      if (value) {
        setCode(value);
        setNotice("Code scanned. Check your branch and tap Connect phone.");
      }
    } catch (cause) {
      setPending("");
      setError((cause as Error).message);
    } finally {
      scanLock.current = false;
    }
  }
  function close() {
    if (!pairLock.current && !pending) {
      setPairOpen(false);
      setCode("");
    }
  }
  return (
    <View style={s.card}>
      <View style={s.heading}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            {binding ? binding.name : "Connect to a counter"}
          </Text>
          <Text style={s.muted}>
            {binding
              ? binding.branch_name + " · Only this counter’s purchases"
              : "Enter the same counter code used in your POS to receive its paid purchases."}
          </Text>
        </View>
        <Pressable
          disabled={paused || !!pending}
          accessibilityRole="button"
          onPress={() => {
            setError("");
            setPairOpen(true);
          }}
          style={s.smallButton}
        >
          <Text style={s.action}>
            {binding ? "Change counter" : "Connect phone"}
          </Text>
        </Pressable>
      </View>
      {binding && (
        <>
          {!!(counterCode || binding.counter_code) && (
            <Text selectable style={s.counterCode}>
              Counter code: {counterCode || binding.counter_code}
            </Text>
          )}
          <Text style={s.muted}>
            {notice || "Checking this counter’s purchases…"}
          </Text>
          {!rows.length && (
            <Text style={s.muted}>
              Waiting for the next paid purchase from this counter.
            </Text>
          )}
          {rows.slice(0, 5).map((row) => (
            <Pressable
              key={row.id}
              disabled={paused || !!pending}
              onPress={() => onSelect(row)}
              style={[s.purchase, selectedId === row.id && s.selected]}
              accessibilityRole="button"
            >
              <Text style={s.title}>
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency,
                }).format(Number(row.total_paid))}
                {selectedId === row.id ? " · Selected" : ""}
              </Text>
              <Text style={s.muted}>
                {new Date(row.paid_at).toLocaleTimeString()} ·{" "}
                {selectedId === row.id
                  ? "Tap the customer’s NFC card or use Give points by phone."
                  : "Select this purchase to identify the customer."}
              </Text>
            </Pressable>
          ))}
          {rows.length > 5 && (
            <Text style={s.muted}>
              Showing the first 5 waiting purchases. Complete one to see the
              next.
            </Text>
          )}
          <View style={s.heading}>
            <Pressable
              onPress={() => refreshRef.current?.()}
              disabled={!!pending}
              accessibilityRole="button"
            >
              <Text style={s.action}>Refresh purchases</Text>
            </Pressable>
            {selectedId && (
              <Pressable
                onPress={onClear}
                disabled={paused}
                accessibilityRole="button"
              >
                <Text style={s.action}>Clear selection</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
      {!!error && !pairOpen && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Modal
        visible={pairOpen}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={s.backdrop}
        >
          <View style={s.modal}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 14, padding: 22 }}
            >
              <Text style={s.title}>Connect to a counter</Text>
              <View style={s.guide}>
                <Text style={s.title}>
                  Your branch:{" "}
                  {branchName ||
                    binding?.branch_name ||
                    "Check your account menu"}
                </Text>
                <Text style={s.muted}>
                  Only this branch’s counters can be paired. Check your account
                  menu if you need to change branches.
                </Text>
              </View>
              <Text style={s.muted}>
                1. Ask your manager for the counter code from POS counters → Set
                up counter. Use the same code configured in the POS.
              </Text>
              <Text style={s.muted}>
                2. Enter the code below or scan its QR. You must be signed in to
                the correct business and branch.
              </Text>
              <Text style={s.muted}>
                3. Give this phone a name and tap Connect phone. Check the
                branch and counter shown after connection.
              </Text>
              <View style={s.guide}>
                <Text style={s.muted}>
                  One counter, one receiving phone. If another phone is already
                  connected, ask your manager for a temporary replacement phone
                  code. The permanent counter code cannot take over its
                  connection.
                </Text>
              </View>
              <Text style={s.muted}>Phone label</Text>
              <TextInput
                accessibilityLabel="Counter phone name"
                style={s.input}
                value={name}
                onChangeText={setName}
                maxLength={80}
                editable={!pending}
              />
              <Text style={s.muted}>
                Counter code or replacement phone code
              </Text>
              <TextInput
                accessibilityLabel="Counter code or replacement phone code"
                style={s.input}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={80}
                placeholder="KNC-ABCD-EF12-3456"
                editable={!pending}
              />
              {Platform.OS === "android" && (
                <Pressable
                  disabled={!!pending}
                  onPress={() => void scan()}
                  style={s.smallButton}
                >
                  <Text style={s.action}>Scan counter QR</Text>
                </Pressable>
              )}
              {!!error && (
                <Text style={s.error} accessibilityRole="alert">
                  {error}
                </Text>
              )}
              {!!pending && (
                <View style={s.heading}>
                  <ActivityIndicator color="#16864a" />
                  <Text>{pending}</Text>
                </View>
              )}
              <Pressable
                disabled={!!pending || !code.trim()}
                onPress={() => void pair()}
                style={s.button}
              >
                <Text style={{ fontWeight: "700", color: "#fff" }}>
                  Connect phone
                </Text>
              </Pressable>
              <Pressable
                disabled={!!pending}
                onPress={close}
                style={s.smallButton}
              >
                <Text style={s.action}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  counterCode: {
    fontSize: 13,
    fontWeight: "600",
    color: "#155c35",
    backgroundColor: "#e5f3e5",
    padding: 12,
    borderRadius: 10,
  },
  card: {
    marginHorizontal: 0,
    marginTop: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#c7d8ce",
    borderRadius: 18,
    backgroundColor: "#fffdf6",
    gap: 12,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    justifyContent: "space-between",
  },
  title: { fontSize: 15, fontWeight: "700", color: "#081711" },
  muted: { fontSize: 12, lineHeight: 18, color: "#54665b" },
  action: { fontSize: 12, fontWeight: "700", color: "#16864a" },
  smallButton: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c7d8ce",
    alignItems: "center",
  },
  purchase: {
    padding: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: "#dce5d9",
    borderRadius: 12,
  },
  selected: { backgroundColor: "#e5f3e5", borderColor: "#16864a" },
  button: {
    backgroundColor: "#16864a",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 22,
    backgroundColor: "rgba(8,23,17,.5)",
  },
  modal: { maxHeight: "85%", backgroundColor: "#f7f5e9", borderRadius: 24 },
  input: {
    borderWidth: 1,
    borderColor: "#c7d8ce",
    borderRadius: 12,
    padding: 13,
    color: "#081711",
    backgroundColor: "#fff",
  },
  guide: { backgroundColor: "#e5f3e5", borderRadius: 12, padding: 14, gap: 6 },
  error: { fontSize: 12, lineHeight: 18, color: "#b42318" },
});
