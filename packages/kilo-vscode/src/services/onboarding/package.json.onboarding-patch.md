# `package.json` patch — onboarding wizard wiring

Add the following entries to `packages/kilo-vscode/package.json`. None
of these conflict with existing keys — they only extend the
`activationEvents`, `contributes.commands`, and
`contributes.configuration` blocks.

## 1. New activation event

Append to the `activationEvents` array:

```json
"onCommand:kilocode.runOnboardingWizard",
"onCommand:kilocode.testHubConnection"
```

> Note: `onStartupFinished` should already be present — the wizard
> auto-fires 2 s after activation when `daveai.onboarded !== true`,
> so no other activation event is needed for first-run.

## 2. New commands (Command Palette)

Append to `contributes.commands`:

```json
{
  "command": "kilocode.runOnboardingWizard",
  "title": "KiloCode: Run Onboarding Wizard",
  "category": "KiloCode"
},
{
  "command": "kilocode.testHubConnection",
  "title": "KiloCode: Test Hub Connection",
  "category": "KiloCode"
}
```

## 3. Re-orderable settings (filled by the wizard, user-overridable)

Append to `contributes.configuration.properties`. These map 1:1 to the
`daveai.*` globalState keys but are also exposed in `settings.json` so
power users can override per-workspace.

```json
"daveai.deploymentMode": {
  "type": "string",
  "enum": ["hub", "standalone"],
  "default": "hub",
  "description": "Run KiloCode against a central DaveAI Hub or fully local. Set by the onboarding wizard; override here only if you know what you're doing.",
  "order": 1
},
"daveai.hub.baseUrl": {
  "type": "string",
  "default": "https://hermes.daveai.tech",
  "description": "Base URL of the DaveAI Hub. Auto-detected by the onboarding wizard.",
  "order": 2
},
"daveai.autoUpdate.mode": {
  "type": "string",
  "enum": ["off", "prompt", "silent"],
  "default": "prompt",
  "description": "How VSIX updates are delivered. Set during onboarding.",
  "order": 3
},
"daveai.autoUpdate.channel": {
  "type": "string",
  "enum": ["stable", "canary", "dev"],
  "default": "stable",
  "description": "Release channel. Stable = default; canary = ~10% early-access cohort; dev = bleeding edge.",
  "order": 4
},
"daveai.routing.defaultModel": {
  "type": "string",
  "enum": ["claude", "minimax", "multi"],
  "default": "claude",
  "description": "Default model for daily coding sessions. Set during onboarding; overridable per-task.",
  "order": 5
}
```

## 4. Wiring `extension.ts`

In the extension activate function (typically
`packages/kilo-vscode/src/extension.ts`):

```ts
import { registerOnboarding } from "./services/onboarding"

export function activate(context: vscode.ExtensionContext) {
  registerOnboarding(context)   // <-- BEFORE registerAutoUpdate
  registerAutoUpdate(context)
  // ...rest of activation
}
```

The order matters: `registerOnboarding` runs `migrateFromLegacy` before
`registerAutoUpdate` reads `daveai.autoUpdate.mode`, so the legacy keys
are already in their new home by the time auto-update wakes up.
