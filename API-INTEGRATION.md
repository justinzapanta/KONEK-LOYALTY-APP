# NFC app API integration

## Current hosted API

The app now connects to `https://konekdigital.vercel.app`. This address is set in `.env.local` and every EAS build profile in `eas.json`. Android cleartext HTTP access is disabled for this HTTPS backend. The phone can use Wi-Fi or mobile data; the local PC server is no longer required for this configuration.

Restart development with `npm start -- --clear`. An installed APK must be rebuilt and reinstalled to use this URL, for example `npx eas-cli build --platform android --profile preview`.

To change the domain later, run `npm run api:url -- https://your-new-domain.com`, then restart Expo or rebuild the installed app. The local setup instructions below are only for switching back to a local backend.

The app now uses the APIs in `C:\Users\PC\Documents\KONEK WEB FINAL V2 copy`. The existing screens, layouts, colors, and styles are preserved. Login fields now accept real credentials. Customers, rewards, balances, staff name, NFC links, and points configuration come from the website. Prototype customer/reward records and client PIN comparisons were removed.

## Start locally

1. In your Supabase SQL Editor, run the website's `supabase/nfc-mobile-migration.sql` after your existing KONEK setup/card migrations. For a fresh database, run `supabase/setup.sql` first, then `supabase/nfc-mobile-migration.sql`. This creates private PIN and request records and the mobile transaction function. This migration has not been applied to your live database.
2. Start the website: run `npm run dev` in `C:\Users\PC\Documents\KONEK WEB FINAL V2 copy`. Its existing Supabase environment configuration is used.
3. To switch back to local testing, run `npm run api:url -- http://192.168.254.198:3000` and put the phone on the same Wi-Fi as the computer. Update this address if your IP changes. For Android emulator, use `http://10.0.2.2:3000`. For production, use your hosted HTTPS website origin, without `/api` at the end.
4. Rebuild the native app with `npm run android` (or your normal EAS development build). `expo-secure-store` and `expo-crypto` were installed; an old installed APK needs rebuilding to load these modules. NFC requires a physical device and a native development/release build. Expo Go does not supply `react-native-nfc-manager`.
5. Start Metro with `npm start -- --clear` after environment changes. Sign in using an existing website workspace owner or active team member's email and password. Suspended members are denied access. Customers are loyalty records, not staff login accounts.

## Change the website address

From the app folder, run this command whenever you deploy your website:

```powershell
npm run api:url -- https://your-website.com
```

It updates `EXPO_PUBLIC_API_URL` in `.env.local` and every EAS build profile in `eas.json`. It also synchronizes Android HTTP access: enabled for the temporary HTTP website, disabled when switching to HTTPS. Use the website origin without `/api`, credentials, or query parameters. To see the current address, run `npm run api:url` with no URL. Use this command when changing the address so local development and cloud builds stay in sync; no application code changes are needed.

For local development, restart Expo with `npm start -- --clear`. For an installed app, rebuild and distribute it with the new address; editing configuration does not change an APK that is already installed. The EAS build profiles explicitly include the URL because the ignored `.env.local` is not uploaded to the cloud build.

For a standalone Android APK to test NFC on your phone, run from the app folder:

```powershell
npx eas-cli build --platform android --profile preview --clear-cache
```

Install the newly built APK. Keep the website running on the computer and connect the phone to the same Wi-Fi. The temporary backend is `http://192.168.254.198:3000`; a cloud build can embed that address, but the installed phone still needs LAN access to the computer. NFC testing uses the native APK, not Expo Go.

To switch back to the temporary local website:

```powershell
npm run api:url -- http://192.168.254.198:3000
```

## Reused and added APIs

| Endpoint | Integration |
| --- | --- |
| `POST /api/auth/login` | Existing email/password login |
| `GET /api/business/customers` | Existing customer and available-balance listing, paginated |
| `GET /api/modules/rewards` | Existing reward catalog |
| `GET /api/business/customers/points` | Existing transaction history used for lifetime totals |
| `GET /api/modules/loyalty-config` | Existing earning rate |
| `GET /api/modules/profile` | Existing signed-in staff profile |
| `POST /api/loyalty/cards` | Existing active-card lookup and link/replace |
| `POST /api/auth/refresh` | Added session refresh using Supabase's existing Auth service |
| `POST /api/auth/logout` | Added revocation of the current session's refresh token |
| `POST /api/loyalty/mobile` | Added missing PIN registration/verification and PIN/card-validated earn/redeem operations; reuses the existing card and points database functions |

All private requests send `Authorization: Bearer <access_token>`. Native session tokens are stored with Expo SecureStore; web previews keep tokens in memory. The client refreshes expired access tokens, shares concurrent refreshes, and clears local tokens and private app state on logout/session expiry. No Supabase secret/service-role key is stored in the phone app. Server logout cannot immediately invalidate an already issued JWT before its expiry, which follows Supabase's session behavior.

## Customer and card behavior

- New app registrations store a bcrypt-hashed four-digit PIN in a separate database table denied to anonymous and authenticated direct reads. Raw PINs and hashes are not returned in customer APIs. PIN verification locks after five failed attempts for 15 minutes; phone-based mutations validate the PIN again on the server.
- Cards must first be provisioned by a KONEK platform card operator for the same business and be active. Business staff can then link them through the app. An arbitrary blank NFC tag is rejected. The reader extracts only the case-sensitive card key from the NDEF URL/text. Full links and hardware UIDs are not sent as card keys. Apply the customer-page migration after the mobile migration to update installed card functions.
- Existing website customers have no mobile PIN because the website schema had none. They can use their linked NFC card. This integration does not assign default PINs or change the UI to add a PIN-reset screen.
- Earning follows the website's current amount-per-point setting, including the preview label. Available balance includes expiry rules; lifetime earned/redeemed totals come from the ledger.
- Multi-item redemption runs in one database transaction. Any insufficient balance or unavailable reward rolls back all items. Repeating an identical request reference returns its original result. The client retains request references for retries during the current app session.
- The website reward schema has no stock column. Demo stock values were removed; no inventory enforcement is fabricated. Existing reward status, schedules, expiry, and point prices are checked by the database.
- The app uses the same earliest accessible workspace selection as the website. Workspace switching and automatic POS-payment queue handling are separate features; this app retains its existing manual order-total flow.

## Validation

`npm run typecheck` passes for both projects. `npm test` passes 22 backend groups and 7 app API/NFC groups. The website production build and Android Metro/Hermes bundle export pass. Seven HTTP smoke checks verify invalid login/refresh input and rejection of unauthenticated private requests. Existing style/color definitions are unchanged.

The local database tests substitute only the crypto primitive because PGlite does not provide pgcrypto; production uses the migration's bcrypt implementation. Live Supabase login, production pgcrypto execution, secure native storage on hardware, and a physical NFC tap still require a staging/device smoke test after applying the migration. No live database, users, or card records were changed during development.

References: [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [Supabase token refresh](https://supabase.com/docs/reference/javascript/auth-refreshsession), [Supabase sign-out](https://supabase.com/docs/reference/javascript/auth-signout).

## Customer portal

The customer page opens at `/<businessUuid>` for customers with or without a card. NFC entry at `/<businessUuid>/<card_key>` verifies the card server-side, creates an encrypted 15-minute HttpOnly read session, and redirects to the clean business URL. The card key is not stored in browser storage or customer-page data. Run `supabase/customer-page-migration.sql`, then `supabase/customer-access-migration.sql` last, and configure server email delivery for Forgot PIN. See the website's `supabase/customer-page-guide.md` for the APIs and full setup. New cashier registrations require email, phone number, and a four-digit PIN. The customer uses their phone/PIN to sign in and confirm redemption; email verifies PIN recovery.


## NFC alerts and owner workspace update

Apply the website supabase/nfc-card-alerts-migration.sql after your existing migrations. Restart the website, reload the app, and sign out/in. Owner workspace selection now prefers the owned business and app requests bind to that authorized workspace. Unknown NFC cards show the registration alert; inactive or other-business cards keep the business-specific warning. No UI layout was changed.


## Cashier challenges and discount vouchers

Deploy the website and apply its `supabase/cashier-challenges-vouchers-migration.sql` before distributing this app update. Rebuild the Android APK (or deliver through your established compatible Expo update workflow); the already-installed binary does not include these JavaScript changes automatically. No new native module or permission is added.

The points modal now reviews a checkout through `/api/loyalty/checkout`: `context` loads challenges/vouchers, `preview` computes changes without persisting them, and `commit` records the reviewed order once. Daily manual approvals use Asia/Manila calendar days. Quantity goals accumulate across orders; single-order goals reject partial quantities. Automatic goals have no confirmation controls. Unused vouchers stay in the customer's rewards. Only one discount voucher may be applied per order; it requires the customer's PIN. QR discount vouchers open the customer's checkout instead of marking the code collected.

The cashier enters the original total, confirms qualifying manual quantities, reviews the amount to collect and points, and either selects a voucher or saves it. Re-review after changing a voucher. Record the order only after payment. Normal purchase points use the net amount paid; an owner may exclude purchase points on orders that earn or use the voucher. The original total is used for the voucher minimum. The app does not control an external POS or payment terminal: apply the same discount in that system. Actual item quantity and cash received remain cashier-attested without a POS integration.

Tests cover duplicate submission, uncertain-network retries using the same order reference, PIN confirmation, voucher routing and existing NFC behavior. Physical device checkout and real backend smoke tests remain necessary after deployment.


## Permanent counter codes — current POS setup

The web dashboard’s POS counters module now shows a permanent `KNC-...` code for each non-Shopify counter. The POS configures that code in `POST /api/integrations/v1/pos/sales` with an authorized business API key; the phone enters or scans the SAME counter code while signed in to that business and branch. No separate POS connector pairing screen is assumed.

In the KONEK app, open **Connect to a counter**, enter the code or scan its counter QR, name the phone, then tap **Connect phone**. Scanning fills the form; it does not automatically connect. The paired screen shows the branch, counter and permanent code. Only that counter’s purchases are loaded through its protected device token and scoped realtime updates.

The permanent code never bypasses sign-in, branch access or the API key. A second phone cannot take over an occupied counter using the permanent code. Its owner/admin can disconnect the old phone, or the assigned branch manager can issue a one-use temporary replacement phone code. That explicit replacement invalidates the previous phone connection.

Deploy the web update and apply `supabase/pos-counter-code-migration.sql` AFTER `pos-automatic-registration-migration.sql`. Distribute a rebuilt Android APK or your established compatible update; an already-installed binary does not get these source edits automatically. No new native module or permission is needed. See the web project’s `POS-COUNTER-SETUP.md` for the payload and rollout instructions.
