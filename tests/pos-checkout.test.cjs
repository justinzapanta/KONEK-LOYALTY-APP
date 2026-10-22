const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  ts = require("typescript"),
  crypto = require("node:crypto");
function harness() {
  const storage = new Map(),
    scope = { value: "https://api:business:pampanga" },
    calls = [];
  const exports = {};
  const binding = {
    checkout_id: "checkout-1",
    name: "Counter 1",
    branch_id: "pampanga",
    branch_name: "Pampanga",
    source: "shopify",
    device_token: "a".repeat(64),
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("src/services/pos-checkout.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      Map,
      JSON,
      Error,
      require(name) {
        if (name === "expo-secure-store")
          return {
            getItemAsync: async (k) => storage.get(k) || null,
            setItemAsync: async (k, v) => storage.set(k, v),
            deleteItemAsync: async (k) => storage.delete(k),
          };
        if (name === "expo-crypto")
          return {
            CryptoDigestAlgorithm: { SHA256: "sha256" },
            digestStringAsync: async (a, v) =>
              crypto.createHash(a).update(v).digest("hex"),
          };
        if (name === "react-native") return { Platform: { OS: "android" } };
        if (name === "./api/client")
          return {
            getCheckoutStorageScope: () => scope.value,
            api: async (path, body) => {
              calls.push({ path, body });
              return body.action === "pair"
                ? binding
                : { rows: [], saved: true };
            },
          };
        throw Error(name);
      },
    },
  );
  return { api: exports, storage, scope, calls, binding };
}
test("phone pairing uses one-time phone codes and securely persists a branch-scoped device connection", async () => {
  const h = harness();
  assert.equal(
    h.api.normalizePairCode("KONEK-POS-PHONE:ABCD-EF12-3456"),
    "abcdef123456",
  );
  assert.throws(
    () => h.api.normalizePairCode("KONEK-POS-CONNECTOR:abcdef123456"),
    /connector code/,
  );
  assert.throws(
    () => h.api.normalizePairCode("https://example.com"),
    /counter code/,
  );
  await h.api.pairPosPhone("ABCD-EF12-3456", "Counter phone");
  assert.equal(h.calls[0].body.code, "abcdef123456");
  assert.equal((await h.api.readPosBinding()).checkout_id, "checkout-1");
  assert.equal(h.storage.size, 1);
  h.scope.value = "https://api:business:manila";
  assert.equal(await h.api.readPosBinding(), null);
  await assert.rejects(h.api.posCheckout("receipt", {}), /original counter/);
  h.scope.value = "https://other-api:business:pampanga";
  assert.equal(await h.api.readPosBinding(), null);
  h.scope.value = "https://api:business:pampanga";
  await h.api.forgetPosBinding();
  assert.equal(await h.api.readPosBinding(), null);
});
test("POS purchases use the protected device endpoint rather than caller-supplied terminal IDs", async () => {
  const h = harness();
  await h.api.pairPosPhone("abcdef123456", "Counter");
  await h.api.loadPosQueue(h.binding);
  await h.api.posCheckout("receipt-1", {
    action: "preview",
    order: { amount: 140, reference: "receipt-1" },
  });
  const request = h.calls.at(-1);
  assert.equal(request.path, "/api/loyalty/pos");
  assert.equal(request.body.payment_id, "receipt-1");
  assert.equal(request.body.device_token, "a".repeat(64));
  assert.equal(request.body.terminal_id, undefined);
  assert.equal(request.body.input.order.amount, 140);
  assert.equal([...h.storage.keys()][0].includes("pampanga"), false);
});

test("Android setup links prefill only a one-time phone code and cannot carry device credentials or choose a branch", async () => {
  const h = harness();
  const link = "konnek://pos-pair?code=abcdef123456";
  assert.equal(h.api.phonePairCodeFromLink(link), "abcdef123456");
  assert.equal(h.api.normalizePairCode(link), "abcdef123456");
  for (const invalid of [
    "https://example.com?code=abcdef123456",
    "konnek://other?code=abcdef123456",
    "konnek://pos-pair?code=" + "a".repeat(64),
    link + "&branch=manila",
    link + "&device_token=" + "a".repeat(64),
    "KONEK-POS-CONNECTOR:abcdef123456",
  ])
    assert.equal(h.api.phonePairCodeFromLink(invalid), null);
  assert.equal(
    h.calls.length,
    0,
    "Opening a URL must not automatically pair or fetch a queue",
  );
  assert.equal(h.storage.size, 0);
  await h.api.pairPosPhone(link, "This Android");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.action, "pair");
  assert.equal(h.calls[0].body.code, "abcdef123456");
  assert.equal(h.calls[0].body.branch_id, undefined);
});

test("permanent counter codes and QR values link a signed-in phone without changing its branch", async()=>{
  const h=harness();h.binding.counter_code="KNC-ABCDEF123456";
  assert.equal(h.api.normalizePairCode("knc-abcd-ef12-3456"),"KNC-ABCDEF123456");
  assert.equal(h.api.normalizePairCode("KONEK-COUNTER:KNC-ABCDEF123456"),"KNC-ABCDEF123456");
  assert.throws(()=>h.api.normalizePairCode("KNC-invalid"),/counter code/);
  await h.api.pairPosPhone("KNC-ABCD-EF12-3456","Front desk phone");
  assert.equal(h.calls[0].body.code,"KNC-ABCDEF123456");
  assert.equal(h.calls[0].body.branch_id,undefined);
  assert.equal((await h.api.readPosBinding()).counter_code,"KNC-ABCDEF123456");
  h.scope.value="https://api:business:manila";assert.equal(await h.api.readPosBinding(),null);
});
