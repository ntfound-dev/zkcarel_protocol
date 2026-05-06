# Frontend Internal Audit — CAREL Protocol
**Scope:** All source files under `frontend/` (Next.js 16, React, TypeScript)
**Date completed:** 2026-05-06
**Author:** Internal

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Security Findings](#2-security-findings)
   - [2.1 Cryptographic secrets in localStorage](#21-cryptographic-secrets-in-localstorage)
   - [2.2 window.noirInputsProvider injection vector](#22-windownoirinputsprovider-injection-vector)
   - [2.3 Full Garaga privacy payload in localStorage](#23-full-garaga-privacy-payload-in-localstorage)
   - [2.4 Auth JWT in localStorage](#24-auth-jwt-in-localstorage)
   - [2.5 No HTTP security headers](#25-no-http-security-headers)
   - [2.6 TypeScript build errors suppressed](#26-typescript-build-errors-suppressed)
   - [2.7 Dev Garaga autofill flag reachable in production build](#27-dev-garaga-autofill-flag-reachable-in-production-build)
3. [Signing and Auth Flow Review](#3-signing-and-auth-flow-review)
4. [Wallet Adapter Review](#4-wallet-adapter-review)
5. [Hide Mode Frontend Flow](#5-hide-mode-frontend-flow)
6. [Technical Debt](#6-technical-debt)
7. [Pre-Mainnet Checklist](#7-pre-mainnet-checklist)

---

## 1. Executive Summary

Files reviewed: `lib/api/index.ts`, `lib/privacy/privacy-relayer.ts`, `lib/privacy/noir-inputs.ts`, `lib/onchain/onchain-trade.ts`, `lib/wallet/adapters/starknet-adapter.ts`, `lib/trade/trading-utils.ts`, `hooks/wallet/use-wallet.tsx`, `hooks/trade/use-garaga-privacy-payload.ts`, `hooks/trade/use-hide-actions.ts`, `components/navigation/wallet-connect-dialog.tsx`, `components/ui/chart.tsx`, `next.config.mjs`.

**Summary of findings:**

| Category | Count |
|---|---|
| Security — High | 2 |
| Security — Medium | 3 |
| Security — Low / Info | 4 |
| Technical debt | 9 |

**No XSS via dangerouslySetInnerHTML on user data.** The only `dangerouslySetInnerHTML` usage (`chart.tsx`) injects developer-defined CSS variable names and colors, not user input. No `eval()` calls found.

**Signing and auth flow is correct.** Login message includes a Unix timestamp; backend validates within a 300-second TTL. Starknet signing uses EIP-712-style typed data. EVM uses `personal_sign` (EIP-191). BTC uses BIP-322. No private keys are handled in the frontend.

**Primary risk area: localStorage persistence of cryptographic material.** The `note_secret`, full Garaga proof payload, and auth JWT all persist in browser localStorage. Any XSS exploit or malicious browser extension on the same origin can read all of this.

---

## 2. Security Findings

### 2.1 Cryptographic secrets in localStorage

**Severity: High**
**File:** `lib/privacy/noir-inputs.ts`

`resolveNoirInputs` caches resolved noir inputs — including `note_secret` — in browser `localStorage` under the key `noir_inputs:<commitment_or_nullifier>`:

```ts
// noir-inputs.ts
window.localStorage.setItem(
  `noir_inputs:${cacheKey}`,
  JSON.stringify(sanitized)
)
```

`note_secret` is the cryptographic secret that authorizes spending a shielded note. Storing it in localStorage means:
- Any XSS vulnerability on the same origin can extract all stored secrets
- Browser extensions with `storage` permission can read it
- It persists indefinitely across browser sessions until explicitly cleared

**Fix:** Store `note_secret` in sessionStorage (scoped to tab lifetime) or derive it ephemerally from a wallet signature at spend time rather than caching it. At minimum, clear the key immediately after the proof is generated.

---

### 2.2 window.noirInputsProvider injection vector

**Severity: High**
**File:** `lib/privacy/noir-inputs.ts`

`resolveNoirInputs` checks `window.noirInputsProvider` and `window.NOIR_INPUTS_PROVIDER` as a source strategy before falling back to other methods:

```ts
const providerFn = (window as any).noirInputsProvider
  ?? (window as any).NOIR_INPUTS_PROVIDER
if (typeof providerFn === "function") {
  const result = await providerFn(context)
  // result used as noir inputs for proof generation
}
```

Any script running on the same page — including third-party scripts, browser extensions, or an injected XSS payload — can set `window.noirInputsProvider` to return arbitrary inputs. This allows an attacker to substitute real proof inputs with attacker-controlled values before the backend generates the Garaga proof. The backend then generates a valid proof over attacker-controlled public inputs (nullifier, commitment, root), bypassing the privacy invariant.

**Fix:** Remove `window.noirInputsProvider` before mainnet. If testnet flexibility is required, add an allowlist check (e.g., only accept this override if `NODE_ENV !== "production"` and `NEXT_PUBLIC_ALLOW_WINDOW_NOIR_INPUTS === "true"`).

---

### 2.3 Full Garaga privacy payload in localStorage

**Severity: Medium**
**File:** `lib/trade/trading-utils.ts`

The full Garaga privacy payload — including `proof`, `public_inputs`, `nullifier`, `commitment`, `root`, and `noir_inputs` — is stored in localStorage under `trade_privacy_garaga_payload_v4`:

```ts
export const TRADE_PRIVACY_PAYLOAD_KEY = "trade_privacy_garaga_payload_v4"
export const TRADE_PRIVACY_PENDING_NOTES_KEY = "trade_privacy_pending_notes_v4"

window.localStorage.setItem(TRADE_PRIVACY_PAYLOAD_KEY, JSON.stringify(normalizedPayload))
```

`TRADE_PRIVACY_PENDING_NOTES_KEY` additionally stores the full list of pending hide notes with nullifiers, commitments, and deposit tx hashes — enough to reconstruct linkability between deposit and spend.

**Fix:** Clear payload from localStorage immediately after the trade is submitted on-chain. Pending notes list is necessary for UX continuity but `noir_inputs` within each record should not be persisted — remove that field from stored note records.

---

### 2.4 Auth JWT in localStorage

**Severity: Medium**
**File:** `hooks/wallet/use-wallet.tsx`

The JWT returned by the backend after wallet authentication is stored in localStorage:

```ts
window.localStorage.setItem(STORAGE_KEYS.token, auth.token)  // "auth_token"
```

Storing session tokens in localStorage is [explicitly warned against by OWASP](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) because localStorage is accessible to all JavaScript on the same origin. A stored XSS would immediately grant full account access to an attacker.

The Sumo Login OAuth token is stored in `sessionStorage` (better — cleared on tab close). The JWT should follow the same pattern.

**Fix:** Migrate `auth_token` from localStorage to sessionStorage. Accept the UX tradeoff that users re-authenticate on new tabs. Alternatively, use an `httpOnly` cookie served by the backend, which is immune to JavaScript access.

---

### 2.5 No HTTP security headers

**Severity: Medium**
**File:** `next.config.mjs`

`next.config.mjs` has no `headers()` configuration. The following headers are absent:

| Header | Risk if absent |
|---|---|
| `Content-Security-Policy` | XSS exploits run without script-src restriction |
| `X-Frame-Options` | Application can be embedded in iframes (clickjacking) |
| `Strict-Transport-Security` | No HTTPS enforcement — MITM on first request |
| `Referrer-Policy` | Wallet address or token in URL may leak to third parties |
| `Permissions-Policy` | Camera/mic/geolocation access not restricted |

**Fix:** Add `headers()` to `next.config.mjs` before mainnet. At minimum, set CSP with `script-src 'self'`, `X-Frame-Options: DENY`, and `Strict-Transport-Security`.

---

### 2.6 TypeScript build errors suppressed

**Severity: Low**
**File:** `next.config.mjs:9`

```js
typescript: {
  ignoreBuildErrors: true,
}
```

TypeScript errors are silently ignored during `next build`. This means type coercion bugs, unsafe property access on `unknown`, or mismatched contract types can ship without any build failure. In security-critical paths (noir inputs, calldata construction, proof binding), these are the exact bugs that cause security regressions.

**Fix:** Remove `ignoreBuildErrors: true`. Fix all TypeScript errors before mainnet. Run `npx tsc --noEmit` as a CI gate.

---

### 2.7 Dev Garaga autofill flag reachable in production build

**Severity: Low**
**File:** `lib/trade/trading-utils.ts:27–29`, `hooks/trade/use-garaga-privacy-payload.ts:228–238`

`DEV_AUTO_GARAGA_PAYLOAD_ENABLED` is true when both `NODE_ENV !== "production"` AND `NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL === "true"`. If a production deployment sets this env var, `createDevTradePrivacyPayload()` is called instead of the real Garaga proof pipeline:

```ts
if (DEV_AUTO_GARAGA_PAYLOAD_ENABLED) {
  const generated = createDevTradePrivacyPayload()  // returns mock proof
  persistTradePrivacyPayload(generated)
  // ... user proceeds with fake proof
}
```

The backend will reject the dummy payload (it checks `proof[0] !== "0x1"`), so this is not exploitable for fund theft on its own. However, a misconfigured production build would silently generate mock proofs, confuse users, and mask real proving failures.

**Fix:** Add an explicit guard: if `ENVIRONMENT === "production"` (backend-side env), this flag must be `false`. Add this to the production startup check alongside `GARAGA_ALLOW_STATEMENT_OVERRIDE`.

---

## 3. Signing and Auth Flow Review

**Result: No bugs found. Flow is correct.**

### Login message construction

```ts
const message = `Carel Protocol login at ${Math.floor(Date.now() / 1000)}`
```

- Timestamp prevents replay: backend validates timestamp within ±300 seconds
- Starknet: signed as EIP-712-style typed data via `wallet_signTypedData` / `account.signMessage`
- EVM (MetaMask): `personal_sign` / fallback param order — both tried
- Referral code read from URL (`?ref=...`) or localStorage; validated server-side; cleared after successful auth

### Sumo Login

`connectWithSumo(sumoToken, address)` calls `connectWallet` with `signature: ""` and `message: ""` — no signature required for Sumo flow. The backend trusts the `sumo_login_token` JWT from the OAuth provider. This is by design (Sumo Login issues its own JWT). Stub in testnet — requires real OAuth integration for mainnet.

The Sumo token is stored in `sessionStorage` (correct — scoped to tab lifetime).

### Chain validation

- Starknet: `ensureStarknetSepolia()` called before `execute_calls`; throws if chain is wrong
- EVM: `ensureEvmSepolia()` called before signing; validates chain ID equals `11155111`
- Chain ID included in typed data domain — binds signature to network

---

## 4. Wallet Adapter Review

**Result: Robust implementation. Several minor notes.**

### starknet-adapter.ts

- `getInjectedStarknet()` resolves the provider by checking `window.starknet_argentX`, `window.starknet_braavos`, `window.starknet`, in priority order — correct
- `requestStarknet()` tries both `type` and `method` field variants to handle inconsistent wallet API implementations — defensive
- `readStarknetChainId()` exhaustively tries 10+ request variants across both RPC methods and object fields — overly defensive but correct; handles all known wallet quirks
- `signStarknetMessage()` uses typed data with correct domain separation (`name: "Carel Protocol"`, `chainId` from wallet)

**Note:** `normalizeProviderHint()` strips all non-alphanumeric characters before ID matching — this prevents false positive matches (e.g., "argent-x" vs "argentx") and is the correct approach.

### onchain-trade.ts

- `invokeStarknetCallsFromWallet()` normalizes calldata entries to hex-felt format via `toHexFelt()` before submission — prevents field overflow
- Tries multiple call shape formats (camelCase, snake_case, `to`/`contract_address`) to handle wallet API fragmentation — defensive
- Chain check happens before any execution attempt

**Note:** The u128 split (`decimalToU256Parts`) for amounts is correct — Starknet u256 is represented as two u128 fields.

---

## 5. Hide Mode Frontend Flow

**Result: Logic is correct. localStorage persistence is the main risk (§2.1, §2.3).**

### Flow

```
User selects Hide Mode
        │
        ▼
useGaragaPrivacyPayload()
        │
        ├── Check localStorage for cached payload (trade_privacy_garaga_payload_v4)
        │   └── Reuse if token/amount match and mixing window passed
        │
        ├── resolveNoirInputs() — fetches or constructs noir circuit inputs
        │   ├── Strategy 1: window.noirInputsProvider (RISK: §2.2)
        │   ├── Strategy 2: NEXT_PUBLIC_NOIR_INPUTS_URL fetch
        │   ├── Strategy 3: localStorage cache (RISK: note_secret persisted §2.1)
        │   └── Strategy 4: passed-in existing inputs
        │
        ├── autoSubmitPrivacyAction() → backend generates Garaga proof
        │
        ├── Validate returned payload: nullifier/commitment match locked note
        │
        └── persistTradePrivacyPayload() → localStorage (RISK: §2.3)
```

### Positive observations

- Payload reuse is gated on token/amount match AND mixing window elapsed (`spendable_at_unix`)
- Returned payload is validated against the locked note: nullifier mismatch → error thrown
- `hasCompleteHideSpendPayload()` checks that proof and public inputs are non-empty and non-mock before allowing execution
- Mock payload (`proof[0] === "0x1"`) is detected and rejected during load from localStorage

### Missing

- After on-chain submit succeeds, the proof payload is NOT cleared from localStorage — it remains permanently until the next payload replaces it
- `noir_inputs` are embedded in the persisted payload and in pending note records

---

## 6. Technical Debt

| # | Item | Severity | File |
|---|---|---|---|
| TD-FE-001 | `ignoreBuildErrors: true` — TypeScript errors silently ignored in production build | High | `next.config.mjs` |
| TD-FE-002 | No HTTP security headers — CSP, X-Frame-Options, HSTS, Referrer-Policy absent | High | `next.config.mjs` |
| TD-FE-003 | `window.noirInputsProvider` escape hatch — must be removed or gated before mainnet | High | `lib/privacy/noir-inputs.ts` |
| TD-FE-004 | `note_secret` cached in localStorage under `noir_inputs:<key>` — persist to sessionStorage or derive ephemerally | Medium | `lib/privacy/noir-inputs.ts` |
| TD-FE-005 | Full Garaga payload (proof, nullifier, commitment, noir_inputs) persisted in localStorage — not cleared after trade submit | Medium | `lib/trade/trading-utils.ts` |
| TD-FE-006 | Auth JWT stored in localStorage (`auth_token`) — migrate to sessionStorage or httpOnly cookie | Medium | `hooks/wallet/use-wallet.tsx` |
| TD-FE-007 | `DEV_AUTO_GARAGA_PAYLOAD_ENABLED` reachable in production if env var set — add production startup gate | Low | `lib/trade/trading-utils.ts` |
| TD-FE-008 | Error and notification messages mixed in Indonesian and English throughout hide mode and noir-inputs paths | Low | `hooks/trade/use-garaga-privacy-payload.ts`, `lib/privacy/noir-inputs.ts` |
| TD-FE-009 | Sumo Login integration is stub in testnet — no real OAuth JWT validation; requires full integration before mainnet | Low | `hooks/wallet/use-wallet.tsx` |

---

## 7. Pre-Mainnet Checklist

**Must fix before mainnet:**

- [ ] Remove `window.noirInputsProvider` / `window.NOIR_INPUTS_PROVIDER` escape hatch (TD-FE-003)
- [ ] Migrate `note_secret` from localStorage to sessionStorage or ephemeral derivation (TD-FE-004)
- [ ] Clear Garaga proof payload from localStorage immediately after on-chain submit (TD-FE-005)
- [ ] Migrate auth JWT from localStorage to sessionStorage or httpOnly cookie (TD-FE-006)
- [ ] Add CSP and security headers to `next.config.mjs` (TD-FE-002)
- [ ] Remove `ignoreBuildErrors: true` and fix all TypeScript errors (TD-FE-001)
- [ ] Complete Sumo Login OAuth integration (TD-FE-009)

**Recommended before mainnet:**

- [ ] Add production startup guard for `NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL` (TD-FE-007)
- [ ] Audit all notification/error messages and standardize to English (TD-FE-008)
- [ ] Verify chart.tsx `dangerouslySetInnerHTML` CSS injection uses only developer-controlled data (no user-supplied color strings)
