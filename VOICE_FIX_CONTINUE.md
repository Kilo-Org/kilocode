# Voice Fix - Continue After Reboot

**Branch:** `feat/azure-voice-studio`  
**Repo:** `g:\Github\kilocode-Azure2`  
**Last updated:** 2026-04-16

---

## Status: Build Blocked by openai Dependency Corruption

Code changes are **complete**. The build fails because `node_modules` has `openai@4.104.0` but `bun.lock` pins `openai@4.77.0` (conflicting nested deps from gitlab-ai-provider). Need a clean reinstall.

---

## Step 1 — Fix Dependencies (run in PowerShell from repo root)

```powershell
cd g:\Github\kilocode-Azure2
Remove-Item -Recurse -Force node_modules
bun install --force
```

---

## Step 2 — Build the Extension

```powershell
cd g:\Github\kilocode-Azure2\packages\kilo-vscode
bun run compile
```

---

## Step 3 — Package VSIX for Testing

```powershell
cd g:\Github\kilocode-Azure2\packages\kilo-vscode
npx vsce package --no-dependencies -o ..\..\build-release\kilo-voice-fix.vsix
```

Install in VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..." → select `build-release\kilo-voice-fix.vsix`

---

## What Was Fixed

### 1. `KiloProvider.ts` ~line 2188 — Provider Smart Default
- Uses `s.inspect("provider")` to detect if user explicitly set the provider
- If **not** explicitly set + Azure API key present → defaults to `"azure"` instead of `"browser"`
- Prevents the April 13 multi-provider refactor from silently switching to browser speech

### 2. `SpeechTab.tsx` — Draft-Based Save System
- All changes are now **buffered** (not auto-saved)
- A **Save/Discard bar** slides in at the bottom when there are unsaved changes
- `saveSpeechSettings()` diffs original vs current settings and only writes changed fields via `updateSetting` messages
- `discardSpeechSettings()` restores original settings without writing

### 3. `App.tsx` — Auto-Speak Reliability
- Fallback retry if `speechSettingsLoaded` not received within 3 seconds
- Also retries on `extensionDataReady` event
- Interrupt on typing (only printable chars, Backspace, Enter)
- Stops speech on session switch

---

## Remaining Issues (still need fixing after build works)

### A. Voice stopping mid-reply (PRIORITY)
**File:** `packages/kilo-vscode/webview-ui/src/App.tsx` ~line 281  
**Problem:** The inner `createEffect` is created inside `on(session.status, ...)` — a new reactive scope spawns on every `busy→idle` transition. This can create duplicate subscribers and cause unexpected stops.  
**Fix needed:** Restructure so `lastSpokenMessageId` is tracked with a signal and the effect is at the top level, only firing when both status is idle AND settings are loaded.

### B. voiceId hardcoded to azure even for other providers
**File:** `packages/kilo-vscode/webview-ui/src/App.tsx` line 326  
```ts
voiceId: settings.azure.voiceId,  // BUG: should be provider-aware
```
**Fix:** Use a helper that resolves voiceId per provider.

---

## Settings Already in VS Code (no action needed)

```json
"kilo-code.new.speech.provider": "azure",
"kilo-code.new.speech.enabled": true,
"kilo-code.new.speech.autoSpeak": true,
"kilo-code.new.speech.azure.apiKey": "<set>",
"kilo-code.new.speech.azure.region": "westus",
"kilo-code.new.speech.azure.voiceId": "en-GB-MaisieNeural"
```

---

## Tell Cascade to Continue

Paste this when resuming:

> "Continue voice fix from VOICE_FIX_CONTINUE.md — clean reinstall deps, fix the inner createEffect voice-stopping bug in App.tsx, fix voiceId provider resolution, then build the VSIX"
