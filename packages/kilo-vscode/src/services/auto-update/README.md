# `services/auto-update`

KiloCode VSIX OTA / auto-update client. Implements
[`HUB_OTA_UPDATE_SPEC.md`](../../../../../docs/HUB_OTA_UPDATE_SPEC.md) §4
(KiloCode client behaviour).

## Why this exists

The DaveAI ecosystem ships under a server-driven update model: the Hub
at `hermes.daveai.tech` is the single source of truth for "what version
each client should be running". This service is the KiloCode side of
that contract. It polls the Hub on extension activate, prompts the user
when a newer VSIX is published, optionally installs it silently, and
reports back to the Hub via the `/api/updates/ack` telemetry endpoint
(§2.4 — wired in a follow-up).

It is the first of four planned auto-update phases (see spec §10):

1. **Phase 1 — KiloCode banner** ← this module
2. Phase 2 — CI publish + signed installer
3. Phase 3 — WebUI banner + settings UI
4. Phase 4 — Canary channel + 24 h soak gate

## Wiring

A single line in `extension.ts`:

```typescript
import { registerAutoUpdate } from "./services/auto-update"

export function activate(context: vscode.ExtensionContext) {
  registerAutoUpdate(context)
}
```

`registerAutoUpdate` is idempotent — calling it twice returns the same
instance. Other modules can grab the live service via:

```typescript
import { getAutoUpdateService } from "./services/auto-update"
const svc = getAutoUpdateService()
svc?.checkNow()
```

## Settings keys this module owns

All under `vscode.ExtensionContext.globalState`:

| Key                                | Type             | Default     |
|------------------------------------|------------------|-------------|
| `daveai.autoUpdate.channel`        | `UpdateChannel`  | `"stable"`  |
| `daveai.autoUpdate.mode`           | `UpdateMode`     | `"prompt"`  |
| `daveai.autoUpdate.skippedVersions`| `string[]`       | `[]`        |
| `daveai.autoUpdate.lastCheckedAt`  | `string` (ISO-8601) | `null`   |
| `daveai.autoUpdate.pinnedVersion`  | `string \| null` | `null`      |

Plus two SecretStorage keys:

| Key                           | Purpose                              |
|-------------------------------|--------------------------------------|
| `daveai.autoUpdate.clientId`  | UUID v4, generated on first access   |
| `daveai.autoUpdate.authToken` | Reserved (write-endpoint Bearer)     |

VS Code config is read once at registration:

| Config                              | Default                        |
|-------------------------------------|--------------------------------|
| `daveai.hub.baseUrl`                | `http://localhost:8082`        |
| `daveai.hub.adminToken`             | (none)                         |
| `daveai.autoUpdate.pollSeconds`     | `3600` (1 h, min `60`)         |

## Commands registered

| Command id                       | Purpose                       |
|----------------------------------|-------------------------------|
| `daveai.autoUpdate.checkNow`     | Manually trigger a poll       |
| `daveai.autoUpdate.setChannel`   | Quick-pick channel selection  |
| `daveai.autoUpdate.setMode`      | Quick-pick mode selection     |

## Public API

```typescript
class AutoUpdateService {
  start(): void
  dispose(): void
  checkNow(): Promise<UpdateInfo | null>
  installUpdate(info: UpdateInfo): Promise<void>
  // settings:
  getChannel(): UpdateChannel
  setChannel(c: UpdateChannel): Promise<void>
  getMode(): UpdateMode
  setMode(m: UpdateMode): Promise<void>
  getSkippedVersions(): string[]
  addSkippedVersion(version: string): Promise<void>
  isVersionSkipped(v: string): boolean
  getCurrentVersion(): string
  getClientId(): Promise<string>
  // events:
  readonly onUpdateAvailable: vscode.Event<UpdateInfo>
}
```

## Local testing against a mock Hub

1. Spin up a local Hub:
   ```bash
   cd contract-kit-v17
   uvicorn src.webui.hub.main:app --host 0.0.0.0 --port 8082
   ```
2. Seed `artifacts/updates/manifest.stable.json` with a version one
   patch above the VSIX you have installed (e.g. `2.1.4` if you're on
   `2.1.3`).
3. Set VS Code config:
   ```json
   { "daveai.hub.baseUrl": "http://localhost:8082" }
   ```
4. Reload the window. The notification banner should appear within a
   few seconds.
5. Click **Skip This Version** — confirm the banner stays gone for
   the rest of the session and reappears only when the manifest bumps
   to a different version.

## Running unit tests

The tests use `bun test` with an in-memory `vscode` stub:

```bash
cd packages/kilo-vscode
bun test src/services/auto-update/__tests__/AutoUpdateService.test.ts
```

Or via the existing workspace script:

```bash
bun run test:unit
```

## What this module deliberately does NOT do

- **Ed25519 signature verification.** Deferred to a sibling
  `signatureVerifier.ts` (spec §4.1) — the manifest's `signature` field
  is plumbed through `UpdateInfo.manifest.signature` for that consumer.
- **sha256 verification of the downloaded VSIX.** Deferred to the same
  module; `installUpdate` will hand the staged file off once the
  verifier lands.
- **`/api/updates/ack` telemetry POST.** Deferred to `telemetry.ts`
  (spec §4.1, §2.4). The data this module maintains
  (`clientId`, `lastCheckedAt`, install result) is the input for that
  module.
- **Forced-downgrade handling.** When `manifest.forceDowngrade === true`
  the service still fires the event, but `installUpdate` will need the
  signature verifier to confirm the older release before swapping.
