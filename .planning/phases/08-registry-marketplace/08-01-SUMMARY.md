# Plan 08-01 Summary — Registry Module Foundation

## Status
Complete

## Files Created

### Source files (`packages/opencode/src/devilcode/team/registry/`)
- `manifest.ts` — Zod schemas: `TeamManifestMetadata`, `TeamRegistryManifest`, `RegistryIndex` (all `.strict()`, browser-safe)
- `errors.ts` — Error class hierarchy: `TeamRegistryError` base + `TeamSignatureError`, `TeamPublisherNotTrusted`, `TeamManifestFetchFailed`, `TeamManifestInvalid` (browser-safe)
- `signing.ts` — Ed25519 sign/verify via Node.js `crypto`: `generateKeyPair`, `signManifest`, `verifyManifestSignature`, `getPublicKeyFingerprint`, `computeSignaturePayload` (Node-only)
- `http-client.ts` — `fetchManifest<T>` with AbortController timeout, custom User-Agent, throws `TeamManifestFetchFailed` on error (Node-only)
- `trust-store.ts` — Filesystem trust store at `~/.local/share/kilo/registry/trusted-publishers.json`: `loadTrustStore`, `saveTrustStore`, `addTrustedPublisher`, `removeTrustedPublisher`, `getTrustedPublisher`, `listTrustedPublishers` — all accept optional path override for testability (Node-only)
- `index.ts` — Barrel re-exporting all symbols from the five modules above

### Test files (`packages/opencode/test/devilcode/team/registry/`)
- `manifest.test.ts` — Tests for `TeamManifestMetadata`, `TeamRegistryManifest`, `RegistryIndex` schemas
- `errors.test.ts` — Tests for all five error classes (name, kind, extra fields, instanceof chain)
- `signing.test.ts` — Round-trip sign/verify, tamper detection, wrong-key rejection, fingerprint stability, no-throw on invalid key
- `http-client.test.ts` — Mocked fetch: success, 404/500/410, network error, AbortError/timeout
- `trust-store.test.ts` — Full CRUD over temp dir: missing file, malformed JSON, add/update, remove (true/false), get undefined, list with id field

## Files Modified
- None. All changes are new files in `src/devilcode/` and `test/devilcode/` paths.

## Verification
| Command | Result | Pass? |
|---------|--------|-------|
| `bun test test/devilcode/team/registry/` | 72 tests passed, 0 failed, 5 files | Yes |
| `bun run typecheck` (opencode-only errors) | 0 new errors (pre-existing devil-ui errors only) | Yes |
| `rg "export.*TeamRegistryManifest" manifest.ts` | Line 20: `export const TeamRegistryManifest` | Yes |
| `rg "generateKeyPair" signing.ts` | Line 11: `export function generateKeyPair()` | Yes |
| `rg "loadTrustStore" trust-store.ts` | Line 22: `export async function loadTrustStore` | Yes |
| browser-safe check (manifest.ts, errors.ts) | No `from "crypto"` imports | Yes |
| `rg "from \"crypto\"" signing.ts` | Line 1: `import crypto from "crypto"` (expected) | Yes |

## Test Count
- New tests: 72
- Pre-existing passing: unaffected (all prior tests continue to pass)

## Issues / Warnings
- `bun turbo typecheck` reports errors in `@devilcode/kilo-ui` — these are pre-existing, unrelated to this plan. The `packages/opencode` package itself has zero new type errors.
- `trust-store.ts` functions accept an optional `storePath` parameter (defaulting to the real path) to enable deterministic testing without mocking `os.homedir`. This is a minor API addition beyond the spec, but it avoids flaky tests and does not break the public contract.

## Ready for Plan 08-02
Yes
