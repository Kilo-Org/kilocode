# KiloCode v7.2.14+ Master Roadmap

> **Branch:** feat/azure-voice-studio
> **Last updated:** 2026-04-18
> **Status:** Phase 2 core complete, Phase 3 debug mode complete, verification passed

---

## Phase 1: Wiring Integrity (COMPLETED)

All 8 V4 subsystem tabs were visual-only — buttons rendered but clicked nothing. Root cause: 20+ message contract mismatches between webview tabs and KiloProvider handlers.

### Completed Fixes
- [x] Training: launch, GPU detect, compare, export, register, validate — all property name mismatches fixed
- [x] Memory: write, recall, permission — response shape mismatches fixed
- [x] Governance: ALL handlers (setTier, approve, reject, addAction, state wrapping)
- [x] Routing: routingSetMode overload dispatching (mode, privacyMode, costThreshold)
- [x] ZeroClaw: submit spread-vs-object mismatch
- [x] SSH: event bridge (5 event types), openTerminal, browseFiles
- [x] VPS: add/update detection
- [x] RoutingService: real API key storage in VS Code SecretStorage
- [x] RoutingService: real HTTP health checks for cloud providers
- [x] ZeroClawService: real git-based rollback (git checkout on changed files)
- [x] WorkstationProfile: real hardware detection (os.cpus, os.totalmem, nvidia-smi, model directory scanning)

### Verification
- TypeScript passes across all 17 packages
- esbuild production build: 5 bundles clean
- VSIX packaged: kilo-code-7.2.14.vsix (65MB, 137 files)
- Pushed to github.com/AiDave71/kilocode.git

---

## Phase 2: Auto-Discovery & Onboarding (COMPLETED — core services)

### Completed
- [x] OnboardingDiscoveryService: auto-detect Ollama, LM Studio, GPU, SSH config, hardware, Hermes
- [x] Governance defaults pre-seeded: 8 dangerous actions, risk behaviors, seedDefaults on init
- [x] SSH config auto-import from ~/.ssh/config
- [x] Discovery wired into extension activation (background, non-blocking)
- [x] Governance snapshot enrichment (checklist, releaseReadiness, rollbackReady)
- [x] SSH browse double-send fix (event relay handles sshFilesListed)
- [x] 4-agent independent verification: all 8 tabs fully wired

### Remaining (for full wizard UX)
- [ ] One-click onboarding wizard UI
- [ ] Speech voice enumeration (browser speechSynthesis)
- [ ] Hermes/Shiba auto-detect integration

### Principle
Tabs should auto-populate with real detected data on first open. Users should never face blank forms when the system can discover the information automatically. Only ask for what can't be detected.

### Architecture

#### OnboardingDiscoveryService
New service that runs on extension activation:

```
OnboardingDiscoveryService
├── discoverLocalProviders()     → ping Ollama + LM Studio
├── detectGPU()                  → nvidia-smi / Win32_VideoController
├── importSSHConfig()            → parse ~/.ssh/config
├── enumerateVoices()            → browser speechSynthesis.getVoices()
├── detectHermesConfig()         → check Hermes/Shiba local config
├── classifyCapabilities()       → what can each tab auto-fill?
└── getDiscoveryResult()         → structured result for all tabs
```

#### SecureProfileService
Strict split between secrets and config:

| Storage | What goes here | API |
|---------|---------------|-----|
| `context.secrets` | API keys, passwords, tokens, sensitive endpoints | SecretStorage.store/get/delete |
| `globalState` | Provider selections, role matrix, UI preferences | ExtensionContext.globalState |
| `workspaceState` | Project-specific settings, last detection results | ExtensionContext.workspaceState |
| VS Code config | Non-sensitive endpoints, labels, voice selections | workspace.getConfiguration |

### Per-Tab Auto-Discovery

#### 2.1 Provider Routing
- **Auto-detect:** Ollama at localhost:11434, LM Studio at localhost:1234
- **Auto-populate:** Provider status (healthy/offline), available local models
- **Ask user:** Cloud API keys (Claude, MiniMax, SiliconFlow) — only when enabled
- **Store:** Keys in SecretStorage, selections in config

#### 2.2 Speech
- **Auto-detect:** Browser/system voices via speechSynthesis.getVoices()
- **Auto-populate:** Voice list, default voice, locale suggestions
- **Ask user:** Azure TTS key (optional, for cloud voices)
- **Store:** Azure key in SecretStorage, voice preferences in config

#### 2.3 SSH & Remote
- **Auto-detect:** Parse ~/.ssh/config for hosts, identities, jump hosts
- **Auto-populate:** SSH profiles from config, connection status
- **Ask user:** Passwords (only if key auth isn't available), confirmation before testing
- **Store:** Passwords in SecretStorage, profiles in workspaceState

#### 2.4 VPS & Infra
- **Auto-detect:** From SSH profiles — run safe read-only inventory commands
- **Auto-populate:** Server name, distro, uptime, CPU, RAM, disk, Docker, services
- **Ask user:** Nothing if SSH profiles work; confirmation before first scan
- **Store:** Server inventory in workspaceState

#### 2.5 Memory (Shiba)
- **Auto-detect:** Hermes/Shiba local config, endpoint, connection state
- **Auto-populate:** Connection status, project scope, recent history
- **Ask user:** Custom endpoint if not auto-detected
- **Store:** Endpoint in config, tokens in SecretStorage

#### 2.6 Training & GPU
- **Auto-detect:** GPU via nvidia-smi, VRAM, CUDA, local model paths
- **Auto-populate:** GPU summary, recommended training mode, safe presets
- **Ask user:** Nothing for local training; remote GPU credentials if needed
- **Store:** Detection cache in workspaceState

#### 2.7 Governance
- **Auto-detect:** Nothing (policy-driven, not hardware-driven)
- **Pre-seed:** Default authority tiers, default dangerous actions, approval thresholds
- **Ask user:** Customization only
- **Store:** Governance state in workspaceState

#### 2.8 ZeroClaw
- **Auto-detect:** Git availability, workspace scope
- **Pre-seed:** Default task limits, default policies
- **Ask user:** Task details only when submitting
- **Store:** Execution history in workspaceState

### Onboarding Wizard Flow

```
Step 1: Local Discovery (automatic, ~5 seconds)
  → Detect Ollama, LM Studio, GPU, SSH config, browser voices

Step 2: Review Screen
  → "Here's what we found" — each item: Accept / Edit / Skip

Step 3: Missing Secrets (only if user enables cloud providers)
  → Claude key, MiniMax key, SiliconFlow key, Azure TTS key

Step 4: Save Securely
  → Secrets → context.secrets
  → Everything else → config/globalState/workspaceState

Step 5: Automated Connection Tests
  → Provider health checks, SSH test, Shiba ping, GPU detect

Step 6: Auto-Populate Tabs
  → Tabs open with real data, not empty scaffolds
```

---

## Phase 3: Debug Mode & External Tool Integration (PARTIALLY COMPLETED)

### Debug Mode Toggle (COMPLETED)
- [x] KiloLogger: centralized structured logging service
- [x] VS Code OutputChannel "KiloCode V4" for all V4 subsystem logs
- [x] `kilo-code.v4.debugMode` setting — verbose logging for all services
- [x] `kilo-code.v4.messageTracing` setting — logs every webview↔extension message
- [x] "KiloCode V4: Toggle Debug Mode" command (palette + programmatic)
- [x] Per-service timing via log.time() for performance tracking
- [x] All 8 V4 services + KiloProvider + OnboardingDiscovery integrated
- [x] Auto-reveals Output channel when debug mode enabled

### External Tool Integration
Enable Claude Desktop, Windsurf, and other AI agents to connect to KiloCode for:
- Real-time code editing via MCP
- Debug data streaming
- Service health monitoring
- Governance audit access

---

## Phase 4: E2E Proof Workflows

### Workflow 1: Zero-Config Local Bring-Up
Fresh install → auto-detect Ollama + LM Studio + GPU + browser voices → Providers, Speech, and Training tabs show real data without any manual input.

### Workflow 2: Minimal Secret Onboarding
User pastes one cloud API key → SecretStorage stores it → provider health validates → route matrix becomes live.

### Workflow 3: SSH/VPS Import
User approves SSH config import → system tests connections → VPS inventory auto-populates.

### Workflow 4: Memory Attach
Hermes/Shiba config discovered → Memory tab shows connected state, recall works, write history populates.

### Workflow 5: Full Operational Test
User requests a small project → routing selects provider → execution runs → memory writes → speech announces result → governance logs the action.

---

## Implementation Priority

| Priority | Component | Effort | Impact |
|----------|-----------|--------|--------|
| 1 | OnboardingDiscoveryService | Medium | All tabs auto-populate |
| 2 | Provider auto-discovery (Ollama/LM Studio) | Low | Routing tab works immediately |
| 3 | GPU auto-detect on Training tab open | Low | Training tab shows real GPU |
| 4 | SSH config import | Medium | SSH + VPS tabs work from existing config |
| 5 | Governance defaults pre-seed | Low | Governance tab usable immediately |
| 6 | Speech voice enumeration | Low | Speech tab shows real voices |
| 7 | One-click onboarding wizard | High | First-time UX transformation |
| 8 | Debug mode toggle | Medium | Developer experience |
| 9 | External tool integration | High | Cross-tool ecosystem |
| 10 | Full E2E proof | Medium | Release confidence |

---

## Commits

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
