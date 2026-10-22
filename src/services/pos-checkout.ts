import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { api, getCheckoutStorageScope } from "./api/client";
export type PosBinding = {
  checkout_id: string;
  counter_code?: string;
  currency?: string;
  name: string;
  branch_id: string;
  branch_name: string;
  source: string;
  device_token: string;
};
export type PosPurchase = {
  id: string;
  total_paid: number;
  source: string;
  reference: string;
  paid_at: string;
  expires_at: string;
};
export type PosQueue = {
  checkout_id: string;
  counter_code?: string;
  currency?: string;
  name: string;
  branch_id: string;
  source: string;
  rows: PosPurchase[];
  realtime?: { url?: string; anonKey?: string };
};
const webMemory = new Map<string, string>();
async function key() {
  return (
    "konek.pos." +
    (await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      getCheckoutStorageScope(),
    ))
  );
}
// Only a one-time phone code may arrive through an app link. Never accept API
// keys, device tokens, branch IDs or automatic pairing instructions from URLs.
export function phonePairCodeFromLink(raw: string): string | null {
  return (
    /^konnek:\/\/pos-pair\?code=([a-f0-9]{12})$/i
      .exec(raw.trim())?.[1]
      .toLowerCase() ?? null
  );
}
export function normalizePairCode(raw: string) {
  const text = phonePairCodeFromLink(raw) ?? raw.trim();
  if (/^(?:KNC-|KONEK-COUNTER:)/i.test(text)) {
    const counter = text
      .replace(/^KONEK-COUNTER:/i, "")
      .replace(/^KNC-/i, "")
      .replace(/-/g, "")
      .toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(counter))
      throw new Error(
        "Enter the counter code from Dashboard → POS counters → Set up counter.",
      );
    return "KNC-" + counter;
  }
  if (/^KONEK-POS-CONNECTOR:/i.test(text))
    throw new Error(
      "This is an old POS connector code. Use the permanent counter code from Dashboard → POS counters → Set up counter, or a temporary replacement phone code.",
    );
  const code = text
    .replace(/^KONEK-POS-PHONE:/i, "")
    .replace(/-/g, "")
    .toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(code))
    throw new Error(
      "Enter the counter code (KNC-...) or a 12-character temporary replacement phone code from your branch manager.",
    );
  return code;
}
export async function readPosBinding(): Promise<PosBinding | null> {
  const scope = getCheckoutStorageScope(),
    k = await key();
  const raw =
    Platform.OS === "web"
      ? webMemory.get(k)
      : await SecureStore.getItemAsync(k);
  if (getCheckoutStorageScope() !== scope)
    throw new Error("Your branch changed. Reopen Connect to a counter.");
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (
    typeof parsed.checkout_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(parsed.device_token ?? "")
  )
    throw new Error(
      "The saved counter connection is invalid. Pair this phone again.",
    );
  return parsed;
}
export async function forgetPosBinding() {
  const k = await key();
  if (Platform.OS === "web") webMemory.delete(k);
  else await SecureStore.deleteItemAsync(k);
}
export async function pairPosPhone(code: string, name: string) {
  const scope = getCheckoutStorageScope(),
    k = await key();
  const previous = await readPosBinding();
  const value = await api<PosBinding>("/api/loyalty/pos", {
    action: "pair",
    code: normalizePairCode(code),
    name: name.trim() || "Counter phone",
    ...(previous ? { previous_token: previous.device_token } : {}),
  });
  if (getCheckoutStorageScope() !== scope)
    throw new Error("Your branch changed. Reopen Connect to a counter.");
  if (!/^[a-f0-9]{64}$/.test(value.device_token ?? ""))
    throw new Error("KONEK did not return a secure counter connection.");
  const clean = {
    checkout_id: value.checkout_id,
    ...(value.currency ? { currency: value.currency } : {}),
    ...(value.counter_code ? { counter_code: value.counter_code } : {}),
    name: value.name,
    branch_id: value.branch_id,
    branch_name: value.branch_name,
    source: value.source,
    device_token: value.device_token,
  };
  if (Platform.OS === "web") webMemory.set(k, JSON.stringify(clean));
  else await SecureStore.setItemAsync(k, JSON.stringify(clean));
  return clean;
}
export async function loadPosQueue(binding: PosBinding) {
  return api<PosQueue>("/api/loyalty/pos", {
    action: "queue",
    device_token: binding.device_token,
  });
}
export async function posCheckout<T>(
  paymentId: string,
  input: Record<string, unknown>,
): Promise<T> {
  const binding = await readPosBinding();
  if (!binding)
    throw new Error(
      "Pair this phone with the original counter before retrying this POS purchase.",
    );
  return api<T>("/api/loyalty/pos", {
    action: "checkout",
    payment_id: paymentId,
    device_token: binding.device_token,
    input,
  });
}
