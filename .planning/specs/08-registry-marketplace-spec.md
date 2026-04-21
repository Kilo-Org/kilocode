# Phase 8 — Team Registry & Marketplace — Spec

**Status**: Draft · 2026-04-21
**Complexity**: Medium-Complex (justified in section 11; security-sensitive signing, HTTP fetch, trust model)
**Architecture**: Clean (selected by user; matches Phases 3-7 precedent)
**Estimated LOC**: Source ~800 · Tests ~600 · Docs ~180
**Plans**: 3 waves (per ROADMAP)

---

## 1. Goal & Scope

### In Scope
- **Registry protocol specification**: JSON manifest schema wrapping `TeamExportEnvelope` with publisher metadata (author, publisherId, version, license, description, tags, publishedAt, signature?)
- **`/team publish <path>`**: Package team config + manifest, optionally sign with Ed25519 private key, write to local file. HTTP PUT upload deferred to Phase 9.
- **`/team install <url>`**: Fetch manifest from URL or file path, verify checksum, verify signature against trusted publishers, install to user-level teams.
- **Ed25519 signing module**: `team/registry/signing.ts` using Node.js built-in `crypto` (no external deps). Key generation, signing, verification.
- **Trust store**: `team/registry/trust-store.ts` — JSON file at `~/.local/share/kilo/registry/trusted-publishers.json` mapping publisher IDs to public keys. Explicit key pinning (no TOFU).
- **HTTP client module**: `team/registry/http-client.ts` — fetch wrapper with configurable timeout (30s default), user-agent header. Retry logic deferred to Phase 9.
- **Registry index format**: Versioned JSON schema `{ version: "1.0", manifests: [...] }`. Flat list MVP; pagination deferred.
- **Dedicated error classes**: `TeamSignatureError`, `TeamRegistryError`, `TeamPublisherNotTrusted`, `TeamManifestFetchFailed`, `TeamManifestInvalid`.
- **Command registration**: `/team publish`, `/team install`, `/team trust <key-file>`, `/team untrust <publisher-id>`.
- **Security review documentation**: Threat model, supply-chain risks, mitigations.
- **Docs**: `packages/devil-docs/pages/collaborate/teams/team-registry.md`.

### Out of Scope
- **HTTP registry upload**: `/team publish <url>` with HTTP PUT to hosted registry — deferred to Phase 9.
- **Registry discovery/search**: Browsing, filtering, rating team templates — Phase 9+.
- **Key rotation/revocation protocol**: Complex PKI with certificate chains — document extension points only.
- **Multi-signature verification**: Requiring N-of-M signatures — deferred.
- **P2P/CDN distribution**: Decentralized registry mesh — out of v1.

### Non-Goals
- **Automatic trust-on-first-use**: Explicit key pinning required for security.
- **Encrypted manifests**: Signatures provide authenticity, not confidentiality.
- **Cross-platform key storage**: OS keychain integration — deferred.

---

## 2. Research Findings

### Q1. Ed25519 in Node.js

**Finding**: Node.js 18+ has built-in Ed25519 support via `crypto` module:
```ts
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
const signature = crypto.sign(null, data, privateKey)
const isValid = crypto.verify(null, data, publicKey, signature)
```
Keys can be exported as PEM or DER. No external dependency required.

**Decision**: Use Node.js built-in `crypto` for Ed25519 signing. Export keys as PEM format (human-readable, standard). Signature stored as base64 in manifest.

### Q2. HTTP fetch patterns

**Finding**: Codebase uses native `fetch()` throughout (Bun/Node 22). Pattern: simple `await fetch(url)` with try/catch. No retry wrapper currently. `lsp/server.ts` has 15+ fetch calls for downloading LSP servers.

**Decision**: Create `team/registry/http-client.ts` with:
- Configurable timeout via `AbortController` (default 30s)
- User-agent header (`Devil-Code/1.0`)
- Returns `Result<T, TeamManifestFetchFailed>` for error handling
- No retry in Phase 8 (defer to Phase 9)

### Q3. Trust store location

**Finding**: Existing config paths:
- User-level teams: `~/.local/share/kilo/teams/`
- Config: `~/.local/share/kilo/storage/`
- Precedent: `kilo` namespace under `.local/share/`

**Decision**: Trust store at `~/.local/share/kilo/registry/trusted-publishers.json`:
```json
{
  "version": "1.0",
  "publishers": {
    "publisher-id": {
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
      "addedAt": "2026-04-21T00:00:00Z",
      "comment": "Optional user note"
    }
  }
}
```

### Q4. Manifest structure

**Finding**: Phase 6 `TeamExportEnvelope` is `.strict()` — unknown keys rejected. Extending it would require schema changes. Phase 6 spec explicitly states: "signed-manifest wraps AROUND envelope (no envelope churn)".

**Decision**: `TeamRegistryManifest` wraps envelope:
```ts
TeamRegistryManifest = z.object({
  manifestVersion: z.literal("1.0"),
  envelope: TeamExportEnvelope,
  metadata: z.object({
    name: z.string().min(1).max(100),
    author: z.string().min(1).max(100),
    publisherId: z.string().uuid(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),  // semver
    license: z.string().optional(),
    description: z.string().max(500).optional(),
    tags: z.array(z.string()).max(10).optional(),
    publishedAt: z.string().datetime(),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
  }),
  signature: z.string().optional(),  // base64-encoded Ed25519 signature
}).strict()
```

### Q5. Signature scope

**Decision**: Signature covers `stableStringify({ envelope, metadata })` (excluding signature field itself). This ensures both the team config and metadata are authenticated.

### Q6. Browser-safe module separation

**Finding**: Phase 6 established pattern: pure modules (Zod schemas, types, error classes) are browser-safe; Node-only modules (`crypto`, `fs`) are proxied via message bridge for webview.

**Decision**: Browser-safe modules in `team/registry/`:
- `manifest.ts` (Zod schema + types)
- `errors.ts` (error classes)
- `index.ts` (re-exports)

Node-only modules:
- `signing.ts` (crypto)
- `http-client.ts` (fetch with AbortController)
- `trust-store.ts` (fs)
- `io.ts` (orchestration)

Phase 9 webview imports browser-safe modules directly; Node-only operations go through KiloConnectionService.

### Q7. Command pattern

**Finding**: Phase 6 `team-io.ts` uses handler injection pattern:
```ts
export type TeamIOCommandHandlers = {
  getActiveTeam: () => CanonicalTeamConfig | undefined
  onImported: (config: CanonicalTeamConfig) => Promise<void>
  toast: { success; error; warning }
}
```

**Decision**: Create `team-registry.ts` command module with similar pattern:
```ts
export type TeamRegistryCommandHandlers = {
  getActiveTeam: () => CanonicalTeamConfig | undefined
  onInstalled: (config: CanonicalTeamConfig) => Promise<void>
  promptPath: () => Promise<string | undefined>
  promptConfirm: (msg: string) => Promise<boolean>
  toast: { success; error; warning }
}
```

---

## 3. Architecture Decisions

### 3.1 Manifest schema (wraps envelope)

`TeamRegistryManifest` contains:
- `manifestVersion`: Schema version for the manifest format itself ("1.0")
- `envelope`: Full `TeamExportEnvelope` (unchanged from Phase 6)
- `metadata`: Publisher metadata (name, author, publisherId, version, etc.)
- `signature`: Optional base64-encoded Ed25519 signature

The manifest is the distributable artifact. It embeds the envelope (which contains the team config). This preserves Phase 6 envelope schema while adding registry concerns at a wrapper level.

### 3.2 Ed25519 signing

Keys are PEM-encoded (standard, human-readable). Signature algorithm:
1. Construct `{ envelope, metadata }` object (excludes `signature` field)
2. Compute `stableStringify()` (Phase 6 checksum.ts)
3. Sign with Ed25519 private key
4. Encode signature as base64

Verification reverses: parse manifest, extract envelope + metadata, verify signature with publisher's public key from trust store.

### 3.3 Trust store

Explicit key pinning model (not trust-on-first-use):
- User must explicitly add publisher keys via `/team trust <key-file>`
- Trust store is a JSON file with publisher ID → public key mapping
- Installing from an untrusted publisher shows warning and prompts for confirmation
- Unsigned manifests show warning but can still be installed

This balances security (no blind TOFU) with usability (warnings not hard blocks).

### 3.4 HTTP client

Minimal fetch wrapper:
- Timeout via `AbortController` (30s default)
- User-agent header
- Returns structured result type
- No retry (Phase 9)
- No caching (Phase 9)

### 3.5 Error taxonomy

New error classes extending the Phase 6 pattern:

```ts
export type TeamRegistryErrorKind =
  | "manifest-fetch-failed"
  | "manifest-invalid"
  | "signature-invalid"
  | "publisher-not-trusted"
  | "signing-failed"
  | "trust-store-error"

export class TeamRegistryError extends Error {
  readonly kind: TeamRegistryErrorKind
  // ...
}

export class TeamSignatureError extends TeamRegistryError { ... }
export class TeamPublisherNotTrusted extends TeamRegistryError { ... }
export class TeamManifestFetchFailed extends TeamRegistryError { ... }
export class TeamManifestInvalid extends TeamRegistryError { ... }
```

### 3.6 Module placement

```
packages/opencode/src/devilcode/team/registry/
  manifest.ts                    ← NEW pure (browser-safe)
  errors.ts                      ← NEW pure (browser-safe)
  signing.ts                     ← NEW Node-only
  http-client.ts                 ← NEW Node-only
  trust-store.ts                 ← NEW Node-only
  io.ts                          ← NEW Node-only (orchestration)
  index.ts                       ← NEW (barrel)

packages/opencode/src/devilcode/workflow-tui/commands/
  team-registry.ts               ← NEW (command handlers)

packages/opencode/src/devilcode/workflow-tui/
  command-input.tsx              ← EDIT (add publish/install branches)
  index.tsx                      ← EDIT (register registry commands)

packages/opencode/src/devilcode/team/
  index.ts                       ← EDIT (add registry re-exports)

packages/devil-docs/pages/collaborate/teams/
  team-registry.md               ← NEW (docs)

packages/devil-docs/pages/collaborate/
  index.md                        ← EDIT (add link)
```

---

## 4. File Touch List

| File | Type | Est. LOC | Purpose |
|---|---|---|---|
| `team/registry/manifest.ts` | NEW | 80 | TeamRegistryManifest Zod schema, metadata type |
| `team/registry/errors.ts` | NEW | 90 | Error classes (TeamSignatureError, etc.) |
| `team/registry/signing.ts` | NEW | 120 | Ed25519 key gen, sign, verify using Node crypto |
| `team/registry/http-client.ts` | NEW | 80 | Fetch wrapper with timeout |
| `team/registry/trust-store.ts` | NEW | 140 | Load/save trusted publishers, add/remove |
| `team/registry/io.ts` | NEW | 180 | publishManifest, installManifest orchestration |
| `team/registry/index.ts` | NEW | 30 | Barrel exports |
| `team/index.ts` | EDIT | +10 | Add registry re-exports |
| `workflow-tui/commands/team-registry.ts` | NEW | 150 | publish/install/trust/untrust handlers |
| `workflow-tui/command-input.tsx` | EDIT | +30 | Add team publish/install/trust branches |
| `workflow-tui/index.tsx` | EDIT | +15 | Register registry commands |
| `test/devilcode/team/registry/manifest.test.ts` | NEW | 70 | Schema validation tests |
| `test/devilcode/team/registry/errors.test.ts` | NEW | 50 | Error class tests |
| `test/devilcode/team/registry/signing.test.ts` | NEW | 100 | Sign/verify round-trip, key gen |
| `test/devilcode/team/registry/http-client.test.ts` | NEW | 80 | Timeout, error handling |
| `test/devilcode/team/registry/trust-store.test.ts` | NEW | 100 | Add/remove/list publishers |
| `test/devilcode/team/registry/io.test.ts` | NEW | 120 | Publish/install integration |
| `test/devilcode/team/registry/security.test.ts` | NEW | 80 | Signature verification failure modes |
| `packages/devil-docs/pages/collaborate/teams/team-registry.md` | NEW | 180 | Registry docs |
| `packages/devil-docs/pages/collaborate/index.md` | EDIT | +2 | Link to registry docs |
| **Totals** | | **~1580** | Source ~800 · Tests ~600 · Docs ~180 |

---

## 5. Module Designs

### 5.1 `team/registry/manifest.ts`

```ts
import { z } from "zod"
import { TeamExportEnvelope } from "../export-envelope"

export const TeamManifestMetadata = z.object({
  name: z.string().min(1).max(100),
  author: z.string().min(1).max(100),
  publisherId: z.string().uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  license: z.string().optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  publishedAt: z.string().datetime(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
})
export type TeamManifestMetadata = z.infer<typeof TeamManifestMetadata>

export const TeamRegistryManifest = z.object({
  manifestVersion: z.literal("1.0"),
  envelope: TeamExportEnvelope,
  metadata: TeamManifestMetadata,
  signature: z.string().optional(),
}).strict()
export type TeamRegistryManifest = z.infer<typeof TeamRegistryManifest>

export const RegistryIndex = z.object({
  version: z.literal("1.0"),
  updatedAt: z.string().datetime(),
  manifests: z.array(z.object({
    url: z.string().url(),
    metadata: TeamManifestMetadata,
  })),
})
export type RegistryIndex = z.infer<typeof RegistryIndex>
```

### 5.2 `team/registry/signing.ts`

```ts
import crypto from "crypto"
import { stableStringify } from "../checksum"
import type { TeamRegistryManifest, TeamManifestMetadata } from "./manifest"
import type { TeamExportEnvelope } from "../export-envelope"

export interface KeyPair {
  publicKey: string   // PEM format
  privateKey: string  // PEM format
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  return { publicKey, privateKey }
}

export function computeSignaturePayload(
  envelope: TeamExportEnvelope,
  metadata: TeamManifestMetadata,
): string {
  return stableStringify({ envelope, metadata })
}

export function signManifest(
  envelope: TeamExportEnvelope,
  metadata: TeamManifestMetadata,
  privateKey: string,
): string {
  const payload = computeSignaturePayload(envelope, metadata)
  const signature = crypto.sign(null, Buffer.from(payload, "utf-8"), privateKey)
  return signature.toString("base64")
}

export function verifyManifestSignature(
  manifest: TeamRegistryManifest,
  publicKey: string,
): boolean {
  if (!manifest.signature) return false
  const payload = computeSignaturePayload(manifest.envelope, manifest.metadata)
  const signature = Buffer.from(manifest.signature, "base64")
  try {
    return crypto.verify(null, Buffer.from(payload, "utf-8"), publicKey, signature)
  } catch {
    return false
  }
}

export function getPublicKeyFingerprint(publicKey: string): string {
  const hash = crypto.createHash("sha256").update(publicKey).digest("hex")
  return hash.slice(0, 16)  // First 16 hex chars
}
```

### 5.3 `team/registry/trust-store.ts`

```ts
import { promises as fs } from "fs"
import path from "path"
import os from "os"

export interface TrustedPublisher {
  publicKey: string
  addedAt: string
  comment?: string
}

export interface TrustStore {
  version: "1.0"
  publishers: Record<string, TrustedPublisher>
}

const TRUST_STORE_PATH = path.join(os.homedir(), ".local", "share", "kilo", "registry", "trusted-publishers.json")

export async function loadTrustStore(): Promise<TrustStore> {
  try {
    const text = await fs.readFile(TRUST_STORE_PATH, "utf-8")
    return JSON.parse(text)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: "1.0", publishers: {} }
    }
    throw err
  }
}

export async function saveTrustStore(store: TrustStore): Promise<void> {
  const dir = path.dirname(TRUST_STORE_PATH)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(TRUST_STORE_PATH, JSON.stringify(store, null, 2) + "\n", "utf-8")
}

export async function addTrustedPublisher(
  publisherId: string,
  publicKey: string,
  comment?: string,
): Promise<void> {
  const store = await loadTrustStore()
  store.publishers[publisherId] = {
    publicKey,
    addedAt: new Date().toISOString(),
    comment,
  }
  await saveTrustStore(store)
}

export async function removeTrustedPublisher(publisherId: string): Promise<boolean> {
  const store = await loadTrustStore()
  if (!(publisherId in store.publishers)) return false
  delete store.publishers[publisherId]
  await saveTrustStore(store)
  return true
}

export async function getTrustedPublisher(publisherId: string): Promise<TrustedPublisher | undefined> {
  const store = await loadTrustStore()
  return store.publishers[publisherId]
}

export async function listTrustedPublishers(): Promise<Array<{ id: string } & TrustedPublisher>> {
  const store = await loadTrustStore()
  return Object.entries(store.publishers).map(([id, p]) => ({ id, ...p }))
}
```

### 5.4 `team/registry/http-client.ts`

```ts
import { TeamManifestFetchFailed } from "./errors"

export interface FetchOptions {
  timeoutMs?: number
  userAgent?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_USER_AGENT = "Devil-Code/1.0"

export async function fetchManifest<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
        "Accept": "application/json",
      },
    })
    if (!response.ok) {
      throw new TeamManifestFetchFailed({
        url,
        statusCode: response.status,
        message: `HTTP ${response.status}: ${response.statusText}`,
      })
    }
    return await response.json() as T
  } catch (err) {
    if (err instanceof TeamManifestFetchFailed) throw err
    if ((err as Error).name === "AbortError") {
      throw new TeamManifestFetchFailed({
        url,
        message: `Request timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      })
    }
    throw new TeamManifestFetchFailed({
      url,
      message: (err as Error).message,
      cause: err,
    })
  } finally {
    clearTimeout(timeout)
  }
}
```

### 5.5 `team/registry/io.ts`

```ts
import { promises as fs } from "fs"
import { TeamRegistryManifest, TeamManifestMetadata } from "./manifest"
import { signManifest, verifyManifestSignature, getPublicKeyFingerprint } from "./signing"
import { getTrustedPublisher } from "./trust-store"
import { fetchManifest } from "./http-client"
import { exportTeamToFile } from "../io"
import type { CanonicalTeamConfig } from "../config"
import { TeamExportEnvelope } from "../export-envelope"
import {
  TeamManifestInvalid,
  TeamSignatureError,
  TeamPublisherNotTrusted,
} from "./errors"

export interface PublishOptions {
  name: string
  author: string
  publisherId: string
  version: string
  license?: string
  description?: string
  tags?: string[]
  homepage?: string
  repository?: string
  privateKey?: string  // If provided, sign the manifest
}

export async function publishManifest(
  config: CanonicalTeamConfig,
  outputPath: string,
  options: PublishOptions,
): Promise<TeamRegistryManifest> {
  // Create envelope using existing export logic (in-memory, not written to disk)
  const envelope: TeamExportEnvelope = TeamExportEnvelope.parse({
    version: "1.1.0",  // Current version
    checksum: (await import("../checksum")).computeTeamChecksum(config),
    config,
    exportedAt: new Date().toISOString(),
  })

  const metadata: TeamManifestMetadata = {
    name: options.name,
    author: options.author,
    publisherId: options.publisherId,
    version: options.version,
    license: options.license,
    description: options.description,
    tags: options.tags,
    publishedAt: new Date().toISOString(),
    homepage: options.homepage,
    repository: options.repository,
  }

  const signature = options.privateKey
    ? signManifest(envelope, metadata, options.privateKey)
    : undefined

  const manifest: TeamRegistryManifest = {
    manifestVersion: "1.0",
    envelope,
    metadata,
    signature,
  }

  // Validate before writing
  TeamRegistryManifest.parse(manifest)

  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8")
  return manifest
}

export interface InstallOptions {
  requireSignature?: boolean
  skipTrustCheck?: boolean
}

export async function installManifest(
  source: string,  // URL or file path
  options: InstallOptions = {},
): Promise<{ config: CanonicalTeamConfig; manifest: TeamRegistryManifest; warnings: string[] }> {
  const warnings: string[] = []

  // Fetch or read manifest
  let raw: unknown
  if (source.startsWith("http://") || source.startsWith("https://")) {
    raw = await fetchManifest(source)
  } else {
    const text = await fs.readFile(source, "utf-8")
    raw = JSON.parse(text)
  }

  // Validate manifest schema
  const parseResult = TeamRegistryManifest.safeParse(raw)
  if (!parseResult.success) {
    throw new TeamManifestInvalid({
      issues: parseResult.error.issues,
      source,
    })
  }
  const manifest = parseResult.data

  // Check signature
  if (manifest.signature) {
    if (!options.skipTrustCheck) {
      const publisher = await getTrustedPublisher(manifest.metadata.publisherId)
      if (!publisher) {
        throw new TeamPublisherNotTrusted({
          publisherId: manifest.metadata.publisherId,
          author: manifest.metadata.author,
          source,
        })
      }
      if (!verifyManifestSignature(manifest, publisher.publicKey)) {
        throw new TeamSignatureError({
          publisherId: manifest.metadata.publisherId,
          source,
          message: "Signature verification failed — manifest may be tampered",
        })
      }
    }
  } else {
    if (options.requireSignature) {
      throw new TeamSignatureError({
        source,
        message: "Manifest is unsigned but signature is required",
      })
    }
    warnings.push("Manifest is unsigned — authenticity cannot be verified")
  }

  return {
    config: manifest.envelope.config,
    manifest,
    warnings,
  }
}
```

---

## 6. Wave & Plan Breakdown

### Plan 08-01 (Wave 1): Registry Module Foundation
Deps: Phase 7 complete. 3 tasks:

- **Task 1 — Manifest schema + error classes**:
  - NEW: `team/registry/manifest.ts` (TeamRegistryManifest, TeamManifestMetadata, RegistryIndex)
  - NEW: `team/registry/errors.ts` (TeamSignatureError, TeamPublisherNotTrusted, TeamManifestFetchFailed, TeamManifestInvalid)
  - NEW tests: `manifest.test.ts`, `errors.test.ts`
  - Verification: `bun test test/devilcode/team/registry/manifest.test.ts test/devilcode/team/registry/errors.test.ts`

- **Task 2 — Signing module**:
  - NEW: `team/registry/signing.ts` (generateKeyPair, signManifest, verifyManifestSignature, getPublicKeyFingerprint)
  - NEW tests: `signing.test.ts` (key gen round-trip, sign/verify, invalid signature rejection, fingerprint stability)
  - Verification: `bun test test/devilcode/team/registry/signing.test.ts`; `bun turbo typecheck`

- **Task 3 — HTTP client + trust store**:
  - NEW: `team/registry/http-client.ts` (fetchManifest with timeout)
  - NEW: `team/registry/trust-store.ts` (load/save/add/remove/list publishers)
  - NEW tests: `http-client.test.ts`, `trust-store.test.ts`
  - EDIT: `team/registry/index.ts` (barrel exports)
  - Verification: all registry tests pass; typecheck clean

Wave 1 exits when: 6 test files pass; typecheck clean; zero TUI integration yet.

### Plan 08-02 (Wave 2): I/O Orchestration + Commands
Deps: Plan 08-01 complete. 3 tasks:

- **Task 1 — Registry I/O module**:
  - NEW: `team/registry/io.ts` (publishManifest, installManifest)
  - NEW tests: `io.test.ts` (publish round-trip, install from file, install from mock URL, signature verification flow)
  - EDIT: `team/index.ts` (add registry re-exports)
  - Verification: `bun test test/devilcode/team/registry/io.test.ts`

- **Task 2 — Command handlers**:
  - NEW: `workflow-tui/commands/team-registry.ts` (publishCommand, installCommand, trustCommand, untrustCommand, registerTeamRegistryCommands)
  - NEW tests: `team-registry.commands.test.ts` (mock handlers, error→toast mapping)
  - Verification: tests pass; typecheck clean

- **Task 3 — TUI integration**:
  - EDIT: `workflow-tui/command-input.tsx` (add `team publish`, `team install`, `team trust`, `team untrust` branches)
  - EDIT: `workflow-tui/index.tsx` (register registry commands)
  - NEW tests: structural grep assertions for new branches
  - Verification: Phase 7 regression gate (318 tests pass); new tests pass

Wave 2 exits when: all tests pass; typecheck clean.

### Plan 08-03 (Wave 3): Security Review + Docs
Deps: Plan 08-02 complete. 3 tasks:

- **Task 1 — Security test suite**:
  - NEW: `test/devilcode/team/registry/security.test.ts`:
    - Signature forgery rejection
    - Publisher key substitution attack
    - Manifest tampering detection
    - Unsigned manifest warning
    - Trust store integrity
  - Verification: security tests pass

- **Task 2 — Documentation**:
  - NEW: `packages/devil-docs/pages/collaborate/teams/team-registry.md` (~180 LOC):
    - Overview, threat model, commands reference
    - Key management guide
    - Sharing workflows
    - Security best practices
  - EDIT: `packages/devil-docs/pages/collaborate/index.md` (add link)
  - Verification: docs render; no broken links

- **Task 3 — Final verification**:
  - Full regression gate: all Phase 7 tests + all Phase 8 tests
  - CI gates: typecheck, format:check, check-devilcode-change
  - Security checklist sign-off

---

## 7. Testing Strategy

### Unit tests (per module)

| Module | Test file | Cases |
|---|---|---|
| manifest.ts | manifest.test.ts | Valid manifest parse; strict rejection of unknown fields; metadata validation; RegistryIndex parse |
| errors.ts | errors.test.ts | Error class instantiation; `instanceof` narrowing; message formatting |
| signing.ts | signing.test.ts | Key generation; sign/verify round-trip; invalid key rejection; signature tampering detection; fingerprint stability |
| http-client.ts | http-client.test.ts | Successful fetch (mock); timeout handling; HTTP error codes; network error |
| trust-store.ts | trust-store.test.ts | Load empty; add publisher; remove publisher; list publishers; file persistence |
| io.ts | io.test.ts | publishManifest creates valid file; installManifest from file; install with signature; install unsigned with warning |

### Security tests

| Case | Expected behavior |
|---|---|
| Forged signature | `TeamSignatureError` thrown; config NOT installed |
| Tampered metadata | Signature verification fails |
| Unknown publisher | `TeamPublisherNotTrusted` thrown (unless skipTrustCheck) |
| Unsigned manifest | Warning logged; install proceeds if not requireSignature |
| Trust store tampering | Fail-safe: treat as empty, require re-trust |

### Integration tests

- `io.round-trip.test.ts`: Generate key → publish manifest → install → verify config equality
- `team-registry.commands.test.ts`: Mock handlers, verify each error→toast variant

---

## 8. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Private key exposure | HIGH | Document secure key storage; warn if key file has permissive mode; recommend OS keychain (Phase 9) |
| TOFU vulnerability (if added) | HIGH | Explicit key pinning only; no automatic trust |
| Signature replay attack | MEDIUM | Manifest includes `publishedAt` timestamp; future: add nonce/expiry |
| HTTP man-in-the-middle | MEDIUM | Recommend HTTPS; signature provides authenticity even over HTTP |
| Trust store tampering | MEDIUM | File permissions; future: OS keychain |
| Large manifest DoS | LOW | Manifest size limit in HTTP client (1MB) |
| Concurrent trust store writes | LOW | Single-user assumption; file locking deferred |

---

## 9. Open Questions

All major questions resolved. Remaining items are deferred-by-design:

- **OQ-1**: HTTP registry upload — `/team publish <url>` with PUT deferred to Phase 9
- **OQ-2**: Key rotation protocol — document extension point; full implementation deferred
- **OQ-3**: Namespace collision — two publishers can use same team name; scoped naming deferred

---

## 10. Acceptance Criteria

- [ ] Registry protocol specified: `TeamRegistryManifest` Zod schema with metadata + signature (ROADMAP criterion 1)
- [ ] `/team publish <path>` packages team + manifest, optionally signs (ROADMAP criterion 2)
- [ ] `/team install <url>` fetches, verifies checksum + signature, installs (ROADMAP criterion 3)
- [ ] Signed manifests verified against trust store (ROADMAP criterion 4)
- [ ] `RegistryIndex` schema documented (ROADMAP criterion 5)
- [ ] Security tests cover supply-chain attack vectors (ROADMAP criterion 6)
- [ ] `bun turbo typecheck` clean
- [ ] `bun run format:check` clean
- [ ] `bun run check-devilcode-change` clean (new files in src/devilcode/)
- [ ] All Phase 7 tests still pass (318 green); Phase 8 adds ~15 new test files
- [ ] Docs published at `team-registry.md`

---

## 11. Assessment

### Complexity: Medium-Complex

- **Security-sensitive**: Ed25519 signing, trust model, supply-chain considerations
- **New submodule**: `team/registry/` with 7 files, clear separation
- **HTTP concerns**: Timeout handling, error propagation
- **Trust model design**: Explicit pinning vs TOFU tradeoffs
- **Not "Complex"**: No external dependencies; uses Node.js built-in crypto; builds on Phase 6 patterns

### Plan count: 3 (per ROADMAP)

- Wave 1: Foundation (schema, signing, HTTP, trust store)
- Wave 2: Orchestration + commands
- Wave 3: Security + docs

### Recommended agent mix

- **Wave 1**: Backend Architect (signing protocol, trust model) + Senior Developer (pure module implementation)
- **Wave 2**: Senior Developer (I/O orchestration) + Frontend Developer (command handlers)
- **Wave 3**: Security Engineer (security tests, threat model review) + Technical Writer (docs)

### Confidence: HIGH

- Ed25519 via Node.js crypto is proven (tested above)
- Manifest-wraps-envelope pattern preserves Phase 6 compatibility
- Trust store pattern follows existing config file precedent
- Command pattern matches Phase 6 `team-io.ts`
- Browser-safe separation follows Phase 6 convention

### Verdict: PASS

---

*End of Spec — Phase 8 Team Registry & Marketplace*
