# `services/onboarding` — first-run setup wizard

## Why this exists

The original KiloCode settings flow asked a brand-new user to fill in
half-a-dozen URLs (Hub base URL, auto-update channel, update mode,
MiniMax API key, etc.) by hand — most of which we can detect, infer,
or default safely. That was the single biggest reason new installs got
abandoned in the first 5 minutes.

This module replaces that flow with a 5-question wizard that targets a
**under-2-minutes-to-fully-configured** experience for a brand-new
install of the KiloCode MAOS Edition VSIX.

## Detection heuristics (no user input needed)

Before the wizard asks a single question it runs `runDetection()`,
which probes:

| Source                                | What we extract                                        |
|---------------------------------------|--------------------------------------------------------|
| `https://hermes.daveai.tech/api/hub/health` (HTTP HEAD/GET) | Whether the production Hub is up; if so, auto-fills `hubBaseUrl` |
| `http://localhost:8095/api/hub/health`| Local-Hub fallback if production unreachable           |
| DNS lookup of `hermes.daveai.tech`    | Distinguishes "no internet" from "Hub is down"         |
| `process.env.MINIMAX_API_KEY`         | Imports straight to VS Code SecretStorage              |
| `process.env.ANTHROPIC_API_KEY`       | Same                                                   |
| `process.env.HF_TOKEN`                | Same                                                   |
| `~/.kilocode/secrets.json`            | Imports any of MINIMAX/ANTHROPIC/HF keys it contains   |

Probe timeout: 4 s per target. All probes run in parallel, so the worst
case is ~4 s before the first question appears.

## The 5 questions

Each picker uses smart defaults — the user can hit Enter on every step
and end up with a sensible config.

1. **"DaveAI Hub or Standalone?"**
   Default: Hub if probe returned 200; Standalone otherwise.
   Hub auto-fills every URL the rest of the system needs.

2. **"How do you want updates?"**
   Default: `prompt`. Options: `prompt` / `silent` / `off`.
   Maps to `kilocode.updates.mode` in storage.

3. **"Update channel?"**
   Default: `stable`. Options: `stable` / `canary` / `dev`.

4. **"Got a MiniMax key?"**
   Skipped entirely if the env-import already found one.
   Otherwise: paste-now / later / show-me-how (opens signup URL).

5. **"What language model do you prefer for daily coding?"**
   Default: `claude`. Options: `claude` / `minimax` / `multi`.
   Sets the routing default; user can still pick per-task in the chat UI.

## Re-running the wizard

- **Command Palette**: `KiloCode: Run Onboarding Wizard`
  (registered as `kilocode.runOnboardingWizard`).
- **Settings UI**: the `OnboardingWizard.tsx` Solid component exposes a
  "Re-run setup wizard" button that calls the same command.
- **Manual reset**: clear the `daveai.onboarded` globalState key.

## Where each setting lives after the wizard

All written to `vscode.ExtensionContext.globalState` under
`daveai.*` keys (so they sync across windows but not across machines —
deliberate, since URLs and channel preferences are device-local):

| Key                                | Source                       |
|------------------------------------|------------------------------|
| `daveai.onboarded`                 | `true` once the wizard finishes |
| `daveai.deploymentMode`            | `hub` or `standalone`        |
| `daveai.hub.baseUrl`               | Hub URL (null in standalone) |
| `daveai.autoUpdate.mode`           | `prompt` / `silent` / `off`  |
| `daveai.autoUpdate.channel`        | `stable` / `canary` / `dev`  |
| `daveai.routing.defaultModel`      | `claude` / `minimax` / `multi` |
| `daveai.onboarding.result`         | The full `OnboardingResult` blob (for the settings UI) |

Secrets (MiniMax, Anthropic, HF) live in
`vscode.ExtensionContext.secrets` (encrypted SecretStorage) under:

- `daveai.minimax.apiKey`
- `daveai.anthropic.apiKey`
- `daveai.hf.token`

## Connection test

After the user finishes, `testConnections()` fires a 1-shot probe against
the Hub's health, manifest, and bootstrap endpoints. Failures auto-retry
once. The user sees a green/red toast — and a "Re-run wizard" button if
anything came back red.
