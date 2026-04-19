# KiloCode v7.2.14+ Master Roadmap — Auto-Population Engine

> **Branch:** feat/azure-voice-studio
> **Last updated:** 2026-04-18
> **Status:** Phase 2 in progress — building the filler system that populates every tab
> **Remotes in sync:** local ↔ Ghenghis/kilocode ↔ AiDave71/kilocode at `f01fad53f`

---

## Core Insight

**"You built the destination tabs, but not the system that fills them."**

Every tab (Providers, SSH, VPS, Training, Memory, ZeroClaw, Governance, Speech) is a destination UI.
The missing system is the **Auto-Population + Discovery Orchestrator** that:

1. Runs on startup and probes every local service, config file, and hardware device
2. Caches everything it finds in `workspaceState`
3. Pushes results into each V4 service so tabs open *already filled*
4. Asks the user only for what can't be detected (API keys, passwords)
5. Validates every populated value with a real connection test

---

## The 12 Gaps (full inventory)

### Gap 1: First-run Discovery Service ✅ IN PROGRESS
**Status:** `OnboardingDiscoveryService` exists, covers providers/GPU/SSH/hardware. Still missing: speech voices, Hermes, Shiba, ZeroClaw endpoints, CLI backend health, known_hosts.

### Gap 2: Setup Wizard / Onboarding Flow ⏳ PENDING
**Status:** Backend handlers exist (`requestDiscoveryResult`, `triggerDiscovery`), but no wizard UI component. Tabs never display "Here's what we found" review screen.

### Gap 3: Secure Secret/Profile Layer ⚠️ PARTIAL
**Status:** `RoutingService` uses `context.secrets` for API keys. Still missing: dedicated `SecureProfileService` that owns the split, unified across SSH passwords, cloud keys, Azure TTS key, Hermes tokens, etc.

### Gap 4: Real Provider Auto-Detection ✅ COMPLETED
**Status:** `f01fad53f` — initial health check 1s after startup, background re-check on tab open, 15-second safety timeout on "Testing…" state. Ollama/LM Studio now show "healthy" automatically.

### Gap 5: Real GPU Detection ✅ COMPLETED
**Status:** `f01fad53f` — `trainingGetJobs` auto-triggers `detectGPUs()` on tab mount if cache is empty. `trainingDetectGPU` now wrapped in try/catch with error recovery. "Detecting…" always clears.

### Gap 6: SSH Config Import ✅ COMPLETED
**Status:** `f01fad53f` — `requestSSHProfiles` lazy-imports from `~/.ssh/config` if profile list is empty. `extension.ts` also calls it after discovery. Still missing: `known_hosts` parser, Hermes remote info, server inventory import.

### Gap 7: VPS Safe Inventory Probe ⏳ PENDING
**Status:** Backend `VPSService.addOrUpdate` exists, but no "probe on SSH connect" pipeline. Needs a safe read-only command set to auto-collect hostname, distro, uptime, CPU, RAM, disk, Docker, services, public IP.

### Gap 8: Memory Auto-Attach (Hermes/Shiba) ⏳ PENDING
**Status:** `OnboardingDiscoveryService.detectHermes()` reads `.kilo/hermes.json`. Missing: automatic endpoint ping, connect-on-discovery, prefill endpoint/state/history, import known agent IDs.

### Gap 9: ZeroClaw Context Bootstrap ⏳ PENDING
**Status:** `ZeroClawService.submit()` works but tab form is blank. Missing: auto-fill current workspace path, default scope, task templates, detected safe defaults, previously used presets.

### Gap 10: Governance Default Seeding ✅ COMPLETED
**Status:** `788d918db` — 8 dangerous actions pre-seeded (vps_deploy, ssh_root_access, training_launch, etc.), 3 default risk behaviors, `seedDefaults()` runs on init. Still missing: release checklist template, rollback template, authority tier pre-population.

### Gap 11: CLI Backend Health Recovery ⏳ PENDING
**Status:** About page shows "CLI Server: Error". `KiloConnectionService` exists but has no auto-recovery logic. Missing: health retry loop, status bar indicator, clear error messaging, auto-restart button.

### Gap 12: Migration-as-Onboarding ⏳ PENDING
**Status:** Export/Import/Legacy-migration UI exists. Missing: on first run, offer to import from these sources to pre-populate tabs.

---

## Architecture: The Auto-Population Engine

```
┌─────────────────────────────────────────────────────────────────┐
│                      Extension Activation                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│           EnvironmentProbeService (NEW)                         │
│  Ultra-fast synchronous probes (<100ms total):                  │
│  • Platform, arch, Node version, VS Code version                │
│  • CPU cores, RAM, free disk                                    │
│  • File existence: ~/.ssh/config, ~/.ssh/known_hosts            │
│  • File existence: .kilo/hermes.json, .kilo/shiba.json          │
│  • Workspace folder, git repo detected?                         │
│  • CLI backend running? (check connection state)                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│       OnboardingDiscoveryService (ENHANCED)                     │
│  Async network/process probes (<5s total):                      │
│  • Ollama ping localhost:11434 → list models                    │
│  • LM Studio ping localhost:1234 → list models                  │
│  • GPU via nvidia-smi (10s timeout, fallback to PowerShell)     │
│  • SSH config parse → profile list                              │
│  • known_hosts parse → server suggestions                       │
│  • Hermes endpoint probe → connection state                     │
│  • Shiba endpoint probe → connection state                      │
│  • ZeroClaw endpoint probe → connection state                   │
│  • Browser speech voices enumeration (webview side)             │
│  • Saved API keys load from SecretStorage                       │
│  • Cloud provider health ping if keys exist                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│       SecureProfileService (NEW)                                │
│  Unified secret/profile manager with strict split:              │
│  • SecretStorage: API keys, passwords, tokens                   │
│  • globalState: provider choices, role matrix, voice prefs      │
│  • workspaceState: per-project settings, discovery cache        │
│  • VS Code config: non-sensitive endpoints, labels              │
│  • Type-safe wrappers per subsystem                             │
│  • Migration handler from legacy KV store                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Tab Hydration Pipeline                       │
│  Results push into V4 services:                                 │
│  ✓ RoutingService.providers updated with health status          │
│  ✓ TrainingService.gpuCache populated                           │
│  ✓ SSHService.profiles hydrated from config                     │
│  ✓ VPSService queues probe for each reachable SSH host          │
│  ✓ MemoryService.connectionState = "connected"                  │
│  ✓ ZeroClawService.defaultScope = current workspace             │
│  ✓ GovernanceService.checklist = default template               │
│  ✓ SpeechService.voices = enumerated system voices              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Onboarding Wizard (NEW)                       │
│  First-run only — triggered if no globalState.onboardingDone:   │
│  Step 1: Show discovery results with Accept/Edit/Skip           │
│  Step 2: Prompt for missing API keys (only enabled providers)   │
│  Step 3: Confirm before any remote test (SSH, cloud)            │
│  Step 4: Store secrets in SecretStorage, rest in state          │
│  Step 5: Run validation tests, show green/red status            │
│  Step 6: Open Providers tab with live data                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase-by-Phase Implementation Plan

### Phase 1: Provider auto-discovery + secure keys ✅ DONE
- [x] Ollama/LM Studio background health probe
- [x] Initial health check on startup (1s after activation)
- [x] Lazy re-check when tab opens
- [x] Safety timeout on "Testing…" state
- [x] SecretStorage integration for cloud keys
- [ ] Cloud provider background ping if keys saved (pending)
- [ ] Unified `SecureProfileService` API (pending)

### Phase 2: GPU/workstation detection ✅ DONE
- [x] nvidia-smi with PowerShell fallback
- [x] Auto-detect on tab mount if cache empty
- [x] Workstation profile merge (os.cpus, os.totalmem)
- [x] Model directory scanning
- [ ] CUDA availability check (partial — driver version parsed)
- [ ] Local training capability detection (pending)

### Phase 3: SSH import + VPS inventory probe ⚠️ PARTIAL
- [x] ~/.ssh/config parser with deduplication
- [x] Lazy import on tab open
- [x] Startup import after discovery
- [ ] `~/.ssh/known_hosts` parser
- [ ] VPS safe-probe pipeline (hostname, distro, uptime, CPU, RAM, disk, Docker)
- [ ] Auto-run inventory when SSH profile connects successfully

### Phase 4: Hermes/Shiba/ZeroClaw auto-attach ⏳ TODO
- [ ] Hermes config discovery (`.kilo/hermes.json`, env vars, default ports)
- [ ] Shiba endpoint probe with fallback ports
- [ ] ZeroClaw endpoint probe
- [ ] Auto-connect on discovery success
- [ ] Import known agent IDs from Hermes
- [ ] ZeroClaw default scope = current workspace
- [ ] Task templates pre-seeded

### Phase 5: Governance default seeding ✅ DONE
- [x] 8 dangerous actions pre-seeded
- [x] 3 risk behaviors (auto-execute, with-logging, block-until-approved)
- [x] `seedDefaults()` idempotent backfill
- [ ] Release checklist template (pending)
- [ ] Rollback checklist template (pending)
- [ ] Authority tier pre-population (pending)

### Phase 6: One-click onboarding wizard ⏳ TODO
- [ ] `OnboardingWizard.tsx` multi-step component
- [ ] `firstRun` flag in globalState
- [ ] Auto-open on activation if flag unset
- [ ] Step 1: Discovery results review
- [ ] Step 2: Missing secrets prompt
- [ ] Step 3: Validation tests with live status
- [ ] Step 4: Tab hydration completion
- [ ] Manually triggerable from command palette

### Phase 7: CLI Backend Health Recovery ⏳ TODO
- [ ] `CLIHealthService`: monitors connection, exposes state
- [ ] Status bar indicator (green/yellow/red)
- [ ] Auto-retry with exponential backoff
- [ ] Clear error messaging (not just "Error")
- [ ] "Restart Backend" command
- [ ] About page shows diagnostic info

### Phase 8: Migration-as-Onboarding ⏳ TODO
- [ ] First-run wizard offers "Import from previous version"
- [ ] Parse legacy KV store for providers, SSH, routing
- [ ] Import Export/Import bundles during onboarding
- [ ] Migration path from `kilo.old.json` to new SecureProfileService

---

## Data Models

### DiscoveryResult (enhanced)
```typescript
interface DiscoveryResult {
  timestamp: number
  environment: {
    platform: string
    arch: string
    nodeVersion: string
    vscodeVersion: string
    workspaceRoot: string
    gitRepo: boolean
  }
  providers: {
    ollama: { available: boolean; models: string[]; version?: string; port: number }
    lmstudio: { available: boolean; models: string[]; apiBase: string }
    claude: { keyConfigured: boolean; healthy?: boolean; lastCheck?: number }
    minimax: { keyConfigured: boolean; healthy?: boolean; lastCheck?: number }
    siliconflow: { keyConfigured: boolean; healthy?: boolean; lastCheck?: number }
  }
  gpu: {
    detected: boolean
    count: number
    devices: Array<{ name: string; vramGb: number; cudaVersion?: string; driverVersion?: string }>
  }
  hardware: {
    cpu: { model: string; cores: number; tier: string }
    ramGb: number
    diskFreeGb?: number
  }
  ssh: {
    configFound: boolean
    knownHostsFound: boolean
    profiles: SSHProfileSuggestion[]
    knownHosts: string[]
  }
  memory: {
    hermes: { configFound: boolean; endpoint?: string; reachable?: boolean }
    shiba: { configFound: boolean; endpoint?: string; reachable?: boolean }
  }
  zeroClaw: {
    endpoint?: string
    reachable?: boolean
    defaultScope: string
  }
  speech: {
    browserVoicesAvailable: boolean
    voiceCount: number
    systemDefaultLocale?: string
  }
  cliBackend: {
    running: boolean
    pid?: number
    baseUrl?: string
    errorCount: number
    lastError?: string
  }
}
```

### SecureProfileService API
```typescript
class SecureProfileService {
  // Secrets (encrypted)
  async setApiKey(provider: string, key: string): Promise<void>
  async getApiKey(provider: string): Promise<string | undefined>
  async deleteApiKey(provider: string): Promise<void>
  async setSshPassword(profileName: string, password: string): Promise<void>
  async getSshPassword(profileName: string): Promise<string | undefined>
  async setToken(service: string, token: string): Promise<void>
  async getToken(service: string): Promise<string | undefined>

  // Non-secret profile data
  setProviderChoice(role: string, providerId: string): void
  getProviderChoice(role: string): string | undefined
  setVoicePreference(voiceId: string, favorite: boolean): void
  getVoicePreferences(): VoicePreferences
  setRoutingPreferences(prefs: RoutingPrefs): void
  getRoutingPreferences(): RoutingPrefs
  setWorkstationProfile(profile: WorkstationProfile): void
  getWorkstationProfile(): WorkstationProfile | undefined

  // Migration
  async migrateFromLegacy(): Promise<MigrationReport>
  async exportBundle(): Promise<EncryptedBundle>
  async importBundle(bundle: EncryptedBundle): Promise<void>

  // Masking for UI (never returns the actual secret)
  async getMaskedApiKey(provider: string): Promise<string>  // e.g. "sk-...abc1"
}
```

---

## E2E Test Matrix

### Workflow 1: Zero-Config Local Bring-Up ✅ NOW WORKING
1. Fresh install, no API keys saved
2. Ollama running locally on :11434
3. nvidia-smi available
4. `~/.ssh/config` has 2 hosts
5. **Expected:** Open Providers → Ollama shows "healthy" within 2s
6. **Expected:** Open Training → GPU Resources shows real GPU data
7. **Expected:** Open SSH & Remote → 2 imported profiles visible

### Workflow 2: Minimal Secret Onboarding ⏳ PARTIAL
1. User pastes Claude API key
2. Key stored in SecretStorage
3. **Expected:** Claude provider shows "healthy" after test (works)
4. **Expected:** Route matrix auto-enables Claude for Contract/Arch/Audit/Release roles (pending wizard)

### Workflow 3: SSH/VPS Import ⏳ PARTIAL
1. User approves SSH profiles import (works)
2. User clicks "Connect" on a profile (works)
3. **Expected:** VPS inventory auto-runs probe on successful connect (pending Phase 3)
4. **Expected:** VPS tab shows hostname, distro, uptime (pending)

### Workflow 4: Memory Attach ⏳ PENDING
1. Hermes config exists at `.kilo/hermes.json`
2. **Expected:** Memory tab shows "connected" state on open (pending Phase 4)
3. **Expected:** Recent write history auto-populated (pending)
4. **Expected:** Known agent IDs pre-listed (pending)

### Workflow 5: Full Operational Test ⏳ PENDING
1. User types "create a small Python script"
2. Routing selects Claude (contract role)
3. Execution dispatches to MiniMax
4. Memory writes the action
5. Speech announces completion
6. Governance logs the action
7. **Expected:** All 6 subsystems coordinate with zero manual config
8. **Required for release confidence** — pending all phases complete

---

## Implementation Priority

| Priority | Component | Phase | Estimated Effort | User Impact |
|----------|-----------|-------|------------------|-------------|
| 1 | SecureProfileService | 1 | Medium | Unifies all secrets, unblocks wizard |
| 2 | EnvironmentProbeService | 1 | Low | Fast startup data for wizard |
| 3 | OnboardingDiscoveryService enhancements (Speech, Hermes, Shiba, ZeroClaw) | 1+4 | Medium | Covers remaining tabs |
| 4 | VPS safe-probe pipeline | 3 | Medium | VPS tab becomes useful |
| 5 | Memory auto-attach | 4 | Low | Memory tab works out of box |
| 6 | ZeroClaw context bootstrap | 4 | Low | Task form pre-filled |
| 7 | CLI Backend health recovery | 7 | Medium | Fixes "CLI Server: Error" |
| 8 | Onboarding Wizard UI | 6 | High | First-run UX transformation |
| 9 | Migration-as-Onboarding | 8 | Medium | Smoother upgrade path |
| 10 | Governance checklist templates | 5 | Low | Release workflow readiness |

---

## Commits (chronological)

| Commit | Phase | Description |
|--------|-------|-------------|
| `68cdba96d` | 1 | Pass A: 12 structural defects fixed |
| `6c5d2d0fc` | 1 | Pass B: 6 runtime defects fixed |
| `b7ba97875` | 1 | Pass C: 11 failure-path defects fixed |
| `c16eed403` | 1 | Pass D: Integration gaps fixed |
| `14fb4e936` | 1 | 6-pass audit documented |
| `ed8a5dcfc` | 1 | 20+ message contract mismatches fixed |
| `2c9216797` | 1 | TypeScript cast fix |
| `788d918db` | 2 | OnboardingDiscoveryService, governance defaults, SSH import |
| `546feea50` | 2/3 | KiloLogger + debug mode toggle for all V4 subsystems |
| `a438fd8ae` | 2 | SSH browse double-send fix + governance snapshot enrichment |
| `0e49370d4` | 2 | Roadmap documentation update |
| `995ffd40f` | — | Merged 231 upstream commits (bedrock/vertex SDKs, Anthropic SDK 3.0.71, OpenCode v1.4.4) |
| `c331514d1` | — | Added missing onboarding/index.ts barrel export |
| `f01fad53f` | 1+2 | **AUTO-POPULATE FIX**: Ollama startup health check, GPU try/catch, SSH lazy-import, Testing timeout safety, discoveryComplete broadcast |

---

## What "Complete" Means

A tab is not complete when the UI exists. A tab is complete when:

1. ✅ It auto-discovers what it can
2. ✅ It asks for only the missing minimum
3. ✅ It stores sensitive data securely (SecretStorage)
4. ✅ It runs a real validation test
5. ✅ It displays real user data
6. ✅ It handles failure states honestly

**No tab should open empty when data exists to populate it.**
