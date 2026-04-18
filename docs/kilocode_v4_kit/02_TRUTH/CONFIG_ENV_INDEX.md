# Configuration Paths and Environment Variables Index

Date: 2026-04-17
Phase: 07 — Index config paths and env vars

---

## VS Code Extension Settings (package.json `contributes.configuration`)

All settings live under the `kilo-code.new` namespace in `packages/kilo-vscode/package.json`.

### Core

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.language` | string (enum) | `""` (auto) | Override UI language (en, zh, de, ja, etc.) | Core |
| `kilo-code.new.showTaskTimeline` | boolean | `true` | Show the task timeline graph in the chat header | Core UI |
| `kilo-code.new.claudeCodeCompat` | boolean | `false` | Load CLAUDE.md instructions and skills from Claude Code config dir | Core |

### Model Selection

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.model.providerID` | string | `"kilo"` | Default model provider ID for new sessions | Model |
| `kilo-code.new.model.modelID` | string | `"kilo-auto/free"` | Default model ID for new sessions | Model |

### Autocomplete

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.autocomplete.enableAutoTrigger` | boolean | `true` | Enable automatic inline completion suggestions | Autocomplete |
| `kilo-code.new.autocomplete.enableSmartInlineTaskKeybinding` | boolean | `false` | Enable smart inline task keybinding | Autocomplete |
| `kilo-code.new.autocomplete.enableChatAutocomplete` | boolean | `false` | Enable chat textarea autocomplete | Autocomplete |

### Browser Automation

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.browserAutomation.enabled` | boolean | `false` | Enable browser automation powered by Playwright | Browser |
| `kilo-code.new.browserAutomation.useSystemChrome` | boolean | `true` | Use system Chrome instead of downloading Chromium | Browser |
| `kilo-code.new.browserAutomation.headless` | boolean | `false` | Run browser automation in headless mode | Browser |

### Notifications

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.notifications.agent` | boolean | `true` | Show notification when agent completes a task | Notifications |
| `kilo-code.new.notifications.permissions` | boolean | `true` | Show notification on permission requests | Notifications |
| `kilo-code.new.notifications.errors` | boolean | `true` | Show notification on errors | Notifications |

### Sounds

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.sounds.agent` | string (enum) | `"default"` | Sound on agent completion (`default` / `none`) | Sounds |
| `kilo-code.new.sounds.permissions` | string (enum) | `"default"` | Sound on permission requests | Sounds |
| `kilo-code.new.sounds.errors` | string (enum) | `"default"` | Sound on errors | Sounds |

### Speech — General

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.enabled` | boolean | `true` | Enable text-to-speech for assistant replies | Speech |
| `kilo-code.new.speech.autoSpeak` | boolean | `true` | Automatically speak assistant replies on completion | Speech |
| `kilo-code.new.speech.volume` | number | `80` | Speech output volume level (0-100) | Speech |
| `kilo-code.new.speech.interactionMode` | string (enum) | `"assist"` | Voice response mode: `assist` / `conversation` / `minimal` | Speech |
| `kilo-code.new.speech.interruptOnType` | boolean | `true` | Stop speech when user starts typing | Speech |
| `kilo-code.new.speech.debugMode` | boolean | `false` | Show verbose speech engine logs in dev console | Speech |
| `kilo-code.new.speech.sentimentIntensity` | number | `70` | Pitch/rate shift intensity for emotional tone (0-100) | Speech |
| `kilo-code.new.speech.multiVoiceMode` | boolean | `false` | Each AI agent speaks in a distinct voice | Speech |
| `kilo-code.new.speech.provider` | string (enum) | `"browser"` | Active speech provider: `browser` / `azure` / `google` / `openai` / `elevenlabs` / `polly` | Speech |
| `kilo-code.new.speech.presets` | array | `[]` | Saved voice + tuning presets | Speech |

### Speech — Azure Provider

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.azure.apiKey` | string | `""` | Azure Cognitive Services Speech API key | Speech/Azure |
| `kilo-code.new.speech.azure.region` | string | `"westus"` | Azure Speech resource region | Speech/Azure |
| `kilo-code.new.speech.azure.voiceId` | string | `"en-GB-MaisieNeural"` | Azure Neural TTS voice ID | Speech/Azure |

### Speech — Google Provider

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.google.apiKey` | string | `""` | Google Cloud TTS API key | Speech/Google |

### Speech — OpenAI Provider

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.openai.apiKey` | string | `""` | OpenAI API key for TTS | Speech/OpenAI |

### Speech — ElevenLabs Provider

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.elevenlabs.apiKey` | string | `""` | ElevenLabs API key | Speech/ElevenLabs |

### Speech — Amazon Polly Provider

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.polly.accessKeyId` | string | `""` | AWS access key ID for Amazon Polly | Speech/Polly |
| `kilo-code.new.speech.polly.secretAccessKey` | string | `""` | AWS secret access key for Amazon Polly | Speech/Polly |
| `kilo-code.new.speech.polly.region` | string | `"us-east-1"` | AWS region for Amazon Polly | Speech/Polly |

### Speech — Voice Tuning

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.tuning.pitch` | number | `0` | Voice pitch adjustment (-50% to +50%) | Speech/Tuning |
| `kilo-code.new.speech.tuning.rate` | number | `1` | Speech rate/speed (0.5x to 2.0x) | Speech/Tuning |
| `kilo-code.new.speech.tuning.volume` | number or null | `null` | Per-voice volume override (null = use global) | Speech/Tuning |
| `kilo-code.new.speech.tuning.style` | string | `"default"` | Speaking style (voice-dependent) | Speech/Tuning |
| `kilo-code.new.speech.tuning.styleDegree` | number | `1` | Style intensity (0.5x to 2.0x) | Speech/Tuning |
| `kilo-code.new.speech.tuning.sentencePause` | number | `250` | Silence between sentences in ms (0-2000) | Speech/Tuning |
| `kilo-code.new.speech.tuning.paragraphBreak` | number | `500` | Silence between paragraphs in ms (0-5000) | Speech/Tuning |
| `kilo-code.new.speech.tuning.emphasis` | string (enum) | `"moderate"` | Word emphasis: `none` / `reduced` / `moderate` / `strong` | Speech/Tuning |
| `kilo-code.new.speech.tuning.pronunciations` | array | `[]` | Custom pronunciation overrides for technical terms | Speech/Tuning |
| `kilo-code.new.speech.tuning.audioFormat` | string (enum) | `"audio-24khz-48kbitrate-mono-mp3"` | Audio output format and quality | Speech/Tuning |

### Speech — Favorites

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.speech.favorites.starredVoices` | array | `["en-GB-MaisieNeural"]` | Starred favorite voices | Speech/Favorites |
| `kilo-code.new.speech.favorites.order` | array | `["en-GB-MaisieNeural"]` | Display order of favorites | Speech/Favorites |

### Hermes Pipeline

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.hermes.enabled` | boolean | `false` | Route tasks through the Hermes orchestration pipeline | Hermes |
| `kilo-code.new.hermes.baseUrl` | string | `"http://187.77.30.206:18789"` | Hermes Bridge API base URL | Hermes |
| `kilo-code.new.hermes.approvalMode` | string (enum) | `"auto-low"` | Risk tier auto-approval: `auto-all` / `auto-low` / `manual` | Hermes |
| `kilo-code.new.hermes.workspaceScopeOnly` | boolean | `true` | Restrict Hermes execution to current workspace folder | Hermes |

---

## Planned VS Code Settings

Settings to be added in future phases for new subsystems. These do not exist in package.json yet.

### SSH / VPS (Phases 17-26)

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.ssh.enabled` | boolean | `false` | Enable SSH remote execution panel | SSH |
| `kilo-code.new.ssh.profilesPath` | string | `""` | Path to SSH profiles YAML (or use built-in) | SSH |
| `kilo-code.new.ssh.agentForwarding` | boolean | `false` | Allow SSH agent forwarding (security risk) | SSH |
| `kilo-code.new.ssh.strictHostKeyChecking` | boolean | `true` | Enforce known_hosts verification | SSH |
| `kilo-code.new.ssh.transcriptCapture` | boolean | `true` | Record SSH session transcripts to evidence/ | SSH |

### ZeroClaw Execution (Phases 35-44)

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.zeroclaw.sandboxType` | string (enum) | `"container"` | Sandbox type: `container` / `vm` / `chroot` / `none` | ZeroClaw |
| `kilo-code.new.zeroclaw.networkPolicy` | string (enum) | `"deny_all"` | Default network policy for task execution | ZeroClaw |
| `kilo-code.new.zeroclaw.autoSnapshot` | boolean | `true` | Auto-snapshot workspace before write operations | ZeroClaw |
| `kilo-code.new.zeroclaw.maxArtifactSizeMb` | number | `25` | Maximum artifact size in MB | ZeroClaw |

### Provider Routing (Phases 45-52)

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.routing.enabled` | boolean | `false` | Enable multi-provider routing | Routing |
| `kilo-code.new.routing.strategy` | string (enum) | `"priority"` | Routing strategy: `priority` / `round_robin` / `cost_optimized` | Routing |
| `kilo-code.new.routing.budgetAlertUsd` | number | `10.00` | Budget alert threshold in USD | Routing |
| `kilo-code.new.routing.dailyCapUsd` | number | `50.00` | Daily spending cap in USD | Routing |

### Memory / Shiba (Phases 53-58)

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.memory.enabled` | boolean | `true` | Enable Shiba memory integration | Memory |
| `kilo-code.new.memory.endpoint` | string | `"http://localhost:8600/api"` | Shiba memory API endpoint | Memory |
| `kilo-code.new.memory.projectIsolation` | string (enum) | `"strict"` | Memory isolation: `strict` / `shared` / `inherit` | Memory |
| `kilo-code.new.memory.crossAgentSharing` | boolean | `true` | Allow cross-agent memory recall | Memory |

### Training / GPU (Phases 59-66)

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.training.enabled` | boolean | `false` | Enable training/fine-tuning panel | Training |
| `kilo-code.new.training.gpuTarget` | string (enum) | `"prefer_local"` | GPU target: `prefer_local` / `prefer_remote` / `cost_optimized` | Training |
| `kilo-code.new.training.datasetsPath` | string | `"datasets/"` | Path to dataset registry | Training |
| `kilo-code.new.training.checkpointsPath` | string | `"checkpoints/"` | Path to training checkpoints | Training |

### Governance / Release (Phases 67-72)

| Key | Type | Default | Description | Subsystem |
|-----|------|---------|-------------|-----------|
| `kilo-code.new.governance.authorityTier` | string (enum) | `"operator"` | Current user authority tier: `viewer` / `operator` / `admin` / `owner` | Governance |
| `kilo-code.new.governance.approvalTimeout` | number | `300` | Auto-deny timeout for approval modals in seconds | Governance |
| `kilo-code.new.governance.requireAdversarialAudit` | boolean | `true` | Require adversarial audit before release | Governance |

---

## Environment Variables -- Current

Environment variables actively read by the codebase in `packages/kilo-vscode/src/`.

### Hermes API Key Fallback Chain

Resolved in `src/services/hermes/secrets.ts`. SecretStorage is checked first; these are fallbacks in order.

| Variable | Required | Description | Used By |
|----------|----------|-------------|---------|
| `HERMES_API_KEY` | No | Hermes Bridge API key (first env fallback) | `services/hermes/secrets.ts` |
| `KILOCODE_API_KEY` | No | KiloCode universal API key (second fallback) | `services/hermes/secrets.ts` |
| `MINIMAX_API_KEY` | No | MiniMax API key (third fallback) | `services/hermes/secrets.ts` |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude API key (fourth fallback) | `services/hermes/secrets.ts` |

### CLI Backend Server Environment

Set by the extension when spawning the CLI backend in `src/services/cli-backend/server-manager.ts`.

| Variable | Required | Description | Used By |
|----------|----------|-------------|---------|
| `KILO_SERVER_PASSWORD` | Auto | Auth password for CLI backend IPC | `server-manager.ts` (auto-generated) |
| `KILO_CLIENT` | Auto | Client identifier, always `"vscode"` | `server-manager.ts` |
| `KILO_ENABLE_QUESTION_TOOL` | Auto | Enable question tool, always `"true"` | `server-manager.ts` |
| `KILOCODE_FEATURE` | Auto | Feature flag, always `"vscode-extension"` | `server-manager.ts` |
| `KILO_TELEMETRY_LEVEL` | Auto | Telemetry level: `"all"` or `"off"` (from VS Code setting) | `server-manager.ts` |
| `KILO_APP_NAME` | Auto | Application name, always `"kilo-code"` | `server-manager.ts` |
| `KILO_EDITOR_NAME` | Auto | VS Code app name (e.g. `"Visual Studio Code"`) | `server-manager.ts` |
| `KILO_PLATFORM` | Auto | Platform identifier, always `"vscode"` | `server-manager.ts` |
| `KILO_MACHINE_ID` | Auto | VS Code machine ID for telemetry | `server-manager.ts` |
| `KILO_APP_VERSION` | Auto | Extension version from package.json | `server-manager.ts` |
| `KILO_VSCODE_VERSION` | Auto | VS Code version string | `server-manager.ts` |
| `KILOCODE_EDITOR_NAME` | Auto | Combined editor name + version | `server-manager.ts` |
| `KILO_DISABLE_CLAUDE_CODE` | Auto | Set to `"true"` when claudeCodeCompat is off | `server-manager.ts` |

### Shell / System Environment

| Variable | Required | Description | Used By |
|----------|----------|-------------|---------|
| `PATH` | Yes | System path; patched at startup for GUI-launched VS Code | `agent-manager/shell-env.ts` |
| `SHELL` | No | User's default shell (fallback: `/bin/zsh` on macOS, `/bin/bash` on Linux) | `agent-manager/shell-env.ts` |
| `GIT_SSH_COMMAND` | No | Custom SSH command for git; if unset, overridden to `ssh -o BatchMode=yes` | `agent-manager/GitOps.ts` |
| `XDG_CONFIG_HOME` | No | XDG config directory; fallback: `~/.config` | `services/marketplace/paths.ts` |

### Build / CI / Publish

Used only in `script/` build tooling, not in the runtime extension.

| Variable | Required | Description | Used By |
|----------|----------|-------------|---------|
| `KILO_VERSION` | No | Override version string in builds and envelope metadata | `script/build.ts`, `services/hermes/HermesPipeline.ts` |
| `KILO_PRE_RELEASE` | No | Set to `"true"` to build/publish as prerelease | `script/build.ts`, `script/publish.ts` |
| `CLI_DIST_DIR` | No | Path to opencode CLI dist directory | `script/build.ts` |
| `VSCODE_EXEC_PATH` | No | Path to VS Code executable for dev scripts | `script/launch.ts`, `script/dev-snapshot.ts` |
| `OPENVSX_TOKEN` | No | Open VSX publish token | `script/publish.ts` |
| `CI` | No | CI environment flag (affects Playwright retries/workers) | `playwright.config.ts` |
| `PLAYWRIGHT_WORKERS` | No | Override Playwright test worker count | `playwright.config.ts` |

---

## Environment Variables -- Planned

Variables for new subsystems defined in `docs/kilocode_v4_kit/09_CONFIG/` YAML specs.

### Provider Routing (providers.yaml)

| Variable | Required | Description | Used By |
|----------|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Yes (for Claude) | Claude / Anthropic API authentication | Provider Routing (claude lane) |
| `MINIMAX_API_KEY` | Yes (for MiniMax) | MiniMax API authentication | Provider Routing (minimax lane) |
| `SILICONFLOW_API_KEY` | Yes (for SiliconFlow) | SiliconFlow API authentication | Provider Routing (siliconflow lane) |

### SSH / VPS (ssh_profiles.yaml)

| Variable | Required | Description | Used By |
|----------|----------|-------------|---------|
| `SSH_PROD_PASSPHRASE` | No | SSH key passphrase for production hosts | SSH profile auth |
| `SSH_BASTION_PASSPHRASE` | No | SSH key passphrase for bastion/jump hosts | SSH profile auth |

### Memory / Shiba

| Variable | Required | Description | Used By |
|----------|----------|-------------|---------|
| `SHIBA_ENDPOINT` | No | Override Shiba memory API endpoint | Memory subsystem |

---

## YAML Config Files (`docs/kilocode_v4_kit/09_CONFIG/`)

| File | Subsystem | Schema Reference | Phases |
|------|-----------|-----------------|--------|
| `providers.yaml` | Provider Routing | `03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md` | 45-52 |
| `ssh_profiles.yaml` | SSH / VPS | `03_SPECS/KILOCODE_SSH_VPS_COMPLETE_SPEC.md` | 17-26 |
| `execution.yaml` | ZeroClaw Execution | `03_SPECS/KILOCODE_ZEROCLAW_COMPLETE_SPEC.md` | 35-44 |
| `memory.yaml` | Memory / Shiba | `03_SPECS/KILOCODE_MEMORY_COMPLETE_SPEC.md` | 53-58 |
| `training.yaml` | Training / GPU | `03_SPECS/KILOCODE_TRAINING_GPU_COMPLETE_SPEC.md` | 59-66 |
| `governance.yaml` | Governance / Release | `03_SPECS/KILOCODE_GOVERNANCE_RELEASE_COMPLETE_SPEC.md` | 67-72 |

---

## Config Resolution Order

How configuration values are resolved at runtime, highest precedence first:

1. **VS Code workspace settings** (`<workspace>/.vscode/settings.json`) -- per-project overrides
2. **VS Code user settings** (global `settings.json`) -- user-level defaults
3. **VS Code SecretStorage** -- for sensitive keys (e.g. `kilo-code.new.hermes.apiKey`)
4. **Environment variables** -- fallback chain for API keys and system paths
5. **YAML config files** -- planned subsystem configuration (loaded from `09_CONFIG/` or user-specified paths)
6. **Hardcoded defaults** -- values in `package.json` `contributes.configuration` and TypeScript source constants

### Reading patterns in source

| Pattern | Location | Config Scope |
|---------|----------|--------------|
| `vscode.workspace.getConfiguration("kilo-code.new")` | `KiloProvider.ts` | Root namespace |
| `vscode.workspace.getConfiguration("kilo-code.new.speech")` | `KiloProvider.ts` | Speech subsystem |
| `vscode.workspace.getConfiguration("kilo-code.new.autocomplete")` | `AutocompleteServiceManager.ts` | Autocomplete |
| `vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")` | `browser-automation-service.ts` | Browser |
| `vscode.workspace.getConfiguration("kilo-code.new.notifications")` | `KiloProvider.ts` | Notifications |
| `vscode.workspace.getConfiguration("kilo-code.new.sounds")` | `KiloProvider.ts` | Sounds |
| `vscode.workspace.getConfiguration("kilo-code.new.hermes")` | `HermesStatusService.ts` | Hermes pipeline |
| `vscode.workspace.getConfiguration("kilo-code.new.model")` | `KiloProvider.ts` | Model selection |

---

## Secret Management

### Sensitive Settings (stored in VS Code settings -- plain text on disk)

These are API keys stored in `settings.json` as `contributes.configuration` entries. They are readable by any extension and persisted as plain text. This is the current state; migration to SecretStorage is recommended for all of these.

| Setting Key | Sensitivity | Current Storage | Recommended Storage |
|-------------|------------|-----------------|---------------------|
| `kilo-code.new.speech.azure.apiKey` | HIGH | VS Code settings (plaintext) | SecretStorage |
| `kilo-code.new.speech.google.apiKey` | HIGH | VS Code settings (plaintext) | SecretStorage |
| `kilo-code.new.speech.openai.apiKey` | HIGH | VS Code settings (plaintext) | SecretStorage |
| `kilo-code.new.speech.elevenlabs.apiKey` | HIGH | VS Code settings (plaintext) | SecretStorage |
| `kilo-code.new.speech.polly.accessKeyId` | HIGH | VS Code settings (plaintext) | SecretStorage |
| `kilo-code.new.speech.polly.secretAccessKey` | CRITICAL | VS Code settings (plaintext) | SecretStorage |

### Properly Secured Secrets

| Secret | Storage | Resolution |
|--------|---------|------------|
| Hermes API key (`kilo-code.new.hermes.apiKey`) | VS Code SecretStorage | SecretStorage > env var fallback chain |
| `KILO_SERVER_PASSWORD` | Auto-generated per session | Never persisted; ephemeral IPC auth |

### Environment Variable Secrets

| Variable | Sensitivity | Notes |
|----------|------------|-------|
| `HERMES_API_KEY` | HIGH | Used as fallback when SecretStorage is empty |
| `KILOCODE_API_KEY` | HIGH | Universal key fallback |
| `MINIMAX_API_KEY` | HIGH | Provider API key |
| `ANTHROPIC_API_KEY` | HIGH | Provider API key |
| `OPENVSX_TOKEN` | HIGH | Publish token (CI only) |
| `SSH_PROD_PASSPHRASE` | CRITICAL | Planned -- SSH key passphrase |
| `SSH_BASTION_PASSPHRASE` | CRITICAL | Planned -- SSH key passphrase |

### Filesystem Paths with Sensitive Data

| Path | Content | Access |
|------|---------|--------|
| `~/.config/kilo/kilo.json` | Global config (may contain keys) | User-readable only |
| `<workspace>/.kilo/kilo.json` | Project-scoped config | Workspace-readable |
| `evidence/ssh_transcripts/` | Planned SSH session recordings | Should be gitignored |
| `evidence/approval_audit/` | Planned governance audit logs | Should be gitignored |
| `.kilocode/memory_cache/` | Planned local memory cache | Should be gitignored |

---

## Total Counts

| Category | Count |
|----------|-------|
| Existing VS Code settings keys | 46 |
| Planned VS Code settings keys | 16 |
| Current environment variables (runtime) | 4 (Hermes fallback) + 13 (CLI server) + 4 (shell/system) |
| Current environment variables (build/CI) | 7 |
| Planned environment variables | 5 |
| YAML config files | 6 |
| Secrets requiring migration to SecretStorage | 6 |
