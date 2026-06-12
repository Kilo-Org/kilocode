# Hide Additional Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ COMMIT POLICY (user instruction):** Do **NOT** run `git commit` or `git push` at any point. Leave all changes in the working tree. The user commits manually. Every task ends with a build/verify step instead of a commit.

**Goal:** Hide the KiloClaw, Agent Manager, Marketplace, and Worktree features in the `packages/kilo-vscode` panel behind four independent, default-off feature flags, unreachable through every entry point (toolbar icons, command palette, keybinding, in-webview buttons, message routes).

**Architecture:** One source of truth — `src/features.ts` (extension host, Node) — derives each flag from an env var with a default of `false`. It feeds two channels: (1) native VS Code `when` context keys set via `setContext` at activation, gating package.json menu/keybinding contributions; (2) the existing `FeatureFlags` payload on `configLoaded`/`configUpdated`, consumed by webview `<Show>` blocks. Defensive `return` guards in the command/message handlers stop programmatic invocation.

**Tech Stack:** TypeScript, VS Code Extension API, SolidJS (webview), esbuild, `bun:test` (unit tests in `tests/unit/`), `bun run build`.

**Spec:** `docs/superpowers/specs/2026-06-11-kilocode-hide-additional-features-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/kilo-vscode/src/features.ts` | Single source of truth: flag defaults + env override + `isFeatureEnabled` | Modify |
| `packages/kilo-vscode/tests/unit/features-flags.test.ts` | Unit test for env parsing / defaults | Create |
| `packages/kilo-vscode/src/extension.ts` | `setContext` at activation; defensive guards in 3 command handlers | Modify |
| `packages/kilo-vscode/package.json` | `when` clauses: view/title icons, commandPalette entries, keybinding | Modify |
| `packages/kilo-vscode/src/KiloProvider.ts` | Defensive guard on `openMarketplacePanel` message | Modify |
| `packages/kilo-vscode/src/kilo-provider/sidebar-worktree.ts` | Defensive guard on `openAgentManager` message | Modify |
| `packages/kilo-vscode/webview-ui/src/types/messages/config.ts` | Extend `FeatureFlags` interface | Modify |
| `packages/kilo-vscode/webview-ui/src/context/config.tsx` | Extend default `features` signal | Modify |
| `packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx` | Gate 3 "Browse Marketplace" buttons | Modify |
| `packages/kilo-vscode/webview-ui/src/components/chat/ChatView.tsx` | Fold `worktree` flag into worktree guard helpers | Modify |

All paths below are relative to repo root. All commands run from `packages/kilo-vscode/`.

---

## Task 1: Flag source of truth in `features.ts`

**Files:**
- Modify: `packages/kilo-vscode/src/features.ts`
- Test: `packages/kilo-vscode/tests/unit/features-flags.test.ts`

Current file:
```typescript
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

export type Features = {
  indexing: boolean
}

export function configFeatures(config?: ConfigLike | null): Features {
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []),
  }
}
```

- [ ] **Step 1: Write the failing test**

Create `packages/kilo-vscode/tests/unit/features-flags.test.ts`:
```typescript
import { afterEach, describe, expect, it } from "bun:test"
import { configFeatures, isFeatureEnabled, type UiFeature } from "../../src/features"

const ENV_KEYS = [
  "KILOCODE_FEATURE_AGENT_MANAGER",
  "KILOCODE_FEATURE_KILOCLAW",
  "KILOCODE_FEATURE_MARKETPLACE",
  "KILOCODE_FEATURE_WORKTREE",
] as const

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe("UI feature flags", () => {
  it("defaults all UI features to false when env is unset", () => {
    const features = configFeatures()
    expect(features.agentManager).toBe(false)
    expect(features.kiloClaw).toBe(false)
    expect(features.marketplace).toBe(false)
    expect(features.worktree).toBe(false)
  })

  it("enables a feature only when its env var is exactly \"true\"", () => {
    process.env.KILOCODE_FEATURE_MARKETPLACE = "true"
    process.env.KILOCODE_FEATURE_KILOCLAW = "1" // not "true" → stays off
    expect(configFeatures().marketplace).toBe(true)
    expect(configFeatures().kiloClaw).toBe(false)
  })

  it("isFeatureEnabled matches configFeatures for UI flags", () => {
    process.env.KILOCODE_FEATURE_AGENT_MANAGER = "true"
    const name: UiFeature = "agentManager"
    expect(isFeatureEnabled(name)).toBe(true)
    expect(isFeatureEnabled("worktree")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/features-flags.test.ts`
Expected: FAIL — `isFeatureEnabled`/`UiFeature` not exported, and `Features` has no `agentManager` etc.

- [ ] **Step 3: Rewrite `features.ts`**

Replace the entire contents of `packages/kilo-vscode/src/features.ts` with:
```typescript
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

/** UI features that can be hidden in this build via a per-feature flag. */
export type UiFeature = "agentManager" | "kiloClaw" | "marketplace" | "worktree"

export type Features = {
  indexing: boolean
  agentManager: boolean
  kiloClaw: boolean
  marketplace: boolean
  worktree: boolean
}

// Each UI feature is off by default and can be re-enabled by setting its env var
// to exactly "true" in the extension host process.
const UI_FEATURE_ENV: Record<UiFeature, string> = {
  agentManager: "KILOCODE_FEATURE_AGENT_MANAGER",
  kiloClaw: "KILOCODE_FEATURE_KILOCLAW",
  marketplace: "KILOCODE_FEATURE_MARKETPLACE",
  worktree: "KILOCODE_FEATURE_WORKTREE",
}

const UI_FEATURE_DEFAULT: Record<UiFeature, boolean> = {
  agentManager: false,
  kiloClaw: false,
  marketplace: false,
  worktree: false,
}

export function isFeatureEnabled(name: UiFeature): boolean {
  const raw = process.env[UI_FEATURE_ENV[name]]
  if (raw === undefined) return UI_FEATURE_DEFAULT[name]
  return raw === "true"
}

export function configFeatures(config?: ConfigLike | null): Features {
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []),
    agentManager: isFeatureEnabled("agentManager"),
    kiloClaw: isFeatureEnabled("kiloClaw"),
    marketplace: isFeatureEnabled("marketplace"),
    worktree: isFeatureEnabled("worktree"),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/features-flags.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify (no commit)**

Run: `bun test tests/unit/features-flags.test.ts`
Leave changes in the working tree. Do NOT commit.

---

## Task 2: Extend webview `FeatureFlags` type and default signal

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/types/messages/config.ts:146-148`
- Modify: `packages/kilo-vscode/webview-ui/src/context/config.tsx:51`

These keep the webview `FeatureFlags` in sync with the extension `Features` type so `configLoaded`/`configUpdated` deliver the new flags and the default signal stays `false` until the first message.

- [ ] **Step 1: Extend the `FeatureFlags` interface**

In `config.ts`, replace lines 146-148:
```typescript
export interface FeatureFlags {
  indexing: boolean
}
```
with:
```typescript
export interface FeatureFlags {
  indexing: boolean
  agentManager: boolean
  kiloClaw: boolean
  marketplace: boolean
  worktree: boolean
}
```

- [ ] **Step 2: Extend the default `features` signal**

In `config.tsx`, replace line 51:
```typescript
  const [features, setFeatures] = createSignal<FeatureFlags>({ indexing: false })
```
with:
```typescript
  const [features, setFeatures] = createSignal<FeatureFlags>({
    indexing: false,
    agentManager: false,
    kiloClaw: false,
    marketplace: false,
    worktree: false,
  })
```

- [ ] **Step 3: Type-check the webview**

Run: `bun run check-types`
Expected: PASS (no missing-property errors on `FeatureFlags`). If `check-types` is not a script, run `bun run build` and confirm no TS errors.

- [ ] **Step 4: Verify (no commit)**

Leave changes in the working tree. Do NOT commit.

---

## Task 3: Set native context keys at activation

**Files:**
- Modify: `packages/kilo-vscode/src/extension.ts` (top import + near L323, before the toolbar command registration)

This publishes the four flags as VS Code context keys (`kilocode.feature.*`) so the package.json `when` clauses (Task 4) can read them.

- [ ] **Step 1: Ensure `configFeatures` is imported**

At the top of `extension.ts`, confirm/add the import (check existing imports first to avoid a duplicate):
```typescript
import { configFeatures } from "./features"
```

- [ ] **Step 2: Set the context keys**

In the `activate(...)` function, immediately **before** the comment
`// Sidebar menus use wrapper commands ...` (around L313, just above `const track = ...`), insert:
```typescript
  // Publish per-feature flags as context keys so package.json `when` clauses can hide
  // disabled features (toolbar icons, command palette, keybindings).
  const features = configFeatures()
  for (const [key, value] of [
    ["agentManager", features.agentManager],
    ["kiloClaw", features.kiloClaw],
    ["marketplace", features.marketplace],
    ["worktree", features.worktree],
  ] as const) {
    void vscode.commands.executeCommand("setContext", `kilocode.feature.${key}`, value)
  }
```

- [ ] **Step 3: Build to verify it compiles**

Run: `bun run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Verify (no commit)**

Leave changes in the working tree. Do NOT commit.

---

## Task 4: Gate native contributions in `package.json`

**Files:**
- Modify: `packages/kilo-vscode/package.json` — `view/title` (L469-481), `commandPalette` (L427-455), `keybindings` (L596-600)

`when` clauses now require the matching context key. The commandPalette currently only hides the `sidebarTitle.*` wrapper commands; the real `kilo-code.new.*Open`/`*ButtonClicked` commands are still palette-visible, so add explicit entries for them.

- [ ] **Step 1: Gate the three view/title icons**

In the `view/title` array, update the three `when` values:

`kilo-code.new.sidebarTitle.agentManagerOpen` (L469-471):
```json
        {
          "command": "kilo-code.new.sidebarTitle.agentManagerOpen",
          "group": "navigation@2",
          "when": "view == kilo-code.SidebarProvider && kilocode.feature.agentManager"
        },
```
`kilo-code.new.sidebarTitle.kiloClawOpen` (L473-476):
```json
        {
          "command": "kilo-code.new.sidebarTitle.kiloClawOpen",
          "group": "navigation@3",
          "when": "view == kilo-code.SidebarProvider && kilocode.feature.kiloClaw"
        },
```
`kilo-code.new.sidebarTitle.marketplaceButtonClicked` (L478-481):
```json
        {
          "command": "kilo-code.new.sidebarTitle.marketplaceButtonClicked",
          "group": "navigation@4",
          "when": "view == kilo-code.SidebarProvider && kilocode.feature.marketplace"
        },
```
Leave `plusButtonClicked`, `historyButtonClicked`, `profileButtonClicked`, `settingsButtonClicked` unchanged.

- [ ] **Step 2: Hide the real commands from the command palette**

In the `commandPalette` array (after the existing `when: "false"` wrapper entries, before the closing `]` at L455-456), add three entries so the underlying commands are palette-gated by the flags:
```json
        ,
        {
          "command": "kilo-code.new.agentManagerOpen",
          "when": "kilocode.feature.agentManager"
        },
        {
          "command": "kilo-code.new.kiloClawOpen",
          "when": "kilocode.feature.kiloClaw"
        },
        {
          "command": "kilo-code.new.marketplaceButtonClicked",
          "when": "kilocode.feature.marketplace"
        }
```
(Note: the leading `,` joins the previous `settingsButtonClicked` entry — verify the resulting JSON has no trailing/double commas.)

- [ ] **Step 3: Gate the Agent Manager keybinding**

Update the `cmd+shift+m` keybinding (L596-600) to add a `when`:
```json
      {
        "command": "kilo-code.new.agentManagerOpen",
        "key": "ctrl+shift+m",
        "mac": "cmd+shift+m",
        "when": "kilocode.feature.agentManager"
      },
```

- [ ] **Step 4: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"`
Expected: prints `valid` (catches double/trailing commas from Step 2).

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: succeeds.

- [ ] **Step 6: Verify (no commit)**

Leave changes in the working tree. Do NOT commit.

---

## Task 5: Defensive guards in command/message handlers

**Files:**
- Modify: `packages/kilo-vscode/src/extension.ts:351-359` (3 command handlers)
- Modify: `packages/kilo-vscode/src/KiloProvider.ts:881-883` (`openMarketplacePanel`)
- Modify: `packages/kilo-vscode/src/kilo-provider/sidebar-worktree.ts:37-40` (`openAgentManager`)

Hidden UI does not unregister the commands/messages — they can still be triggered programmatically. Guard each with `isFeatureEnabled`.

- [ ] **Step 1: Import `isFeatureEnabled` where needed**

Confirm/add in each of the three files (check existing imports first):
- `extension.ts`: extend the existing `./features` import → `import { configFeatures, isFeatureEnabled } from "./features"`
- `KiloProvider.ts`: `import { isFeatureEnabled } from "./features"`
- `sidebar-worktree.ts`: `import { isFeatureEnabled } from "../features"`

- [ ] **Step 2: Guard the extension.ts command handlers**

Replace the three handlers at L351-359:
```typescript
    vscode.commands.registerCommand("kilo-code.new.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.marketplaceButtonClicked", (directory?: string | null) => {
      marketplacePanelProvider.openPanel(directory)
    }),
    vscode.commands.registerCommand("kilo-code.new.kiloClawOpen", () => {
      kiloClawProvider.openPanel()
    }),
```
with:
```typescript
    vscode.commands.registerCommand("kilo-code.new.agentManagerOpen", () => {
      if (!isFeatureEnabled("agentManager")) return
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.marketplaceButtonClicked", (directory?: string | null) => {
      if (!isFeatureEnabled("marketplace")) return
      marketplacePanelProvider.openPanel(directory)
    }),
    vscode.commands.registerCommand("kilo-code.new.kiloClawOpen", () => {
      if (!isFeatureEnabled("kiloClaw")) return
      kiloClawProvider.openPanel()
    }),
```

- [ ] **Step 3: Guard `openMarketplacePanel` in KiloProvider.ts**

Replace the case at L881-883:
```typescript
        case "openMarketplacePanel":
          vscode.commands.executeCommand("kilo-code.new.marketplaceButtonClicked", this.projectDirectory)
          break
```
with:
```typescript
        case "openMarketplacePanel":
          if (!isFeatureEnabled("marketplace")) break
          vscode.commands.executeCommand("kilo-code.new.marketplaceButtonClicked", this.projectDirectory)
          break
```

- [ ] **Step 4: Guard `openAgentManager` in sidebar-worktree.ts**

Replace the block at L37-40:
```typescript
  if (message.type === "openAgentManager") {
    await ctx.openAgentManager()
    return true
  }
```
with:
```typescript
  if (message.type === "openAgentManager") {
    if (!isFeatureEnabled("agentManager")) return true
    await ctx.openAgentManager()
    return true
  }
```

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: succeeds, no TS errors.

- [ ] **Step 6: Verify (no commit)**

Leave changes in the working tree. Do NOT commit.

---

## Task 6: Gate the "Browse Marketplace" buttons (webview)

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx:51, 328-330, 584-586, 811-813`

Three buttons (Agents, MCP Servers, Skills subtabs) call the shared `browse()` (L60 → posts `openMarketplacePanel`). Wrap each in `<Show when={features().marketplace}>`. The file already imports `useConfig` (L11) and destructures it at L51.

- [ ] **Step 1: Add `features` to the existing destructure**

Replace L51:
```typescript
  const { config, updateConfig } = useConfig()
```
with:
```typescript
  const { config, updateConfig, features } = useConfig()
```

- [ ] **Step 2: Confirm `Show` is imported**

Check the top of the file for `Show` from `solid-js`. If it is not already imported, add it to the existing `solid-js` import (e.g. `import { ..., Show } from "solid-js"`).

- [ ] **Step 3: Wrap the Agents subtab button (around L328-330)**

Current:
```tsx
            <Button variant="ghost" size="small" onClick={browse}>
              {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
            </Button>
```
Wrap it:
```tsx
            <Show when={features().marketplace}>
              <Button variant="ghost" size="small" onClick={browse}>
                {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
              </Button>
            </Show>
```

- [ ] **Step 4: Wrap the MCP Servers subtab button (around L584-586)**

Current:
```tsx
          <Button variant="secondary" size="small" onClick={browse}>
            {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
          </Button>
```
Wrap it:
```tsx
          <Show when={features().marketplace}>
            <Button variant="secondary" size="small" onClick={browse}>
              {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
            </Button>
          </Show>
```

- [ ] **Step 5: Wrap the Skills subtab button (around L811-813)**

Current:
```tsx
        <Button variant="secondary" size="small" onClick={browse}>
          {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
        </Button>
```
Wrap it:
```tsx
        <Show when={features().marketplace}>
          <Button variant="secondary" size="small" onClick={browse}>
            {language.t("settings.agentBehaviour.mcpBrowseMarketplace")}
          </Button>
        </Show>
```

- [ ] **Step 6: Build**

Run: `bun run build`
Expected: succeeds. (If indentation differs slightly in the file, match the surrounding code — the wrap is the only semantic change.)

- [ ] **Step 7: Verify (no commit)**

Leave changes in the working tree. Do NOT commit.

---

## Task 7: Gate the Worktree session actions (webview)

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/chat/ChatView.tsx:23-25 (imports), 43-46, 193, 195`

Fold `features().worktree` into the two guard helpers. This single change hides the New Worktree split button (`<Show when={canStartWorktree()}>` L230), the Move to Worktree button (`<Show when={canMoveToWorktree(hasChat)}>` L275), and drops them from the `canShowAnyAction` aggregate at L198. "Show Changes" (L294-313) is independent and stays.

- [ ] **Step 1: Import `useConfig`**

After the existing context imports (around L24, next to `import { useServer } from "../../context/server"`), add:
```typescript
import { useConfig } from "../../context/config"
```

- [ ] **Step 2: Call it in the component**

Near the other context hooks (around L43-46, next to `const worktreeMode = useWorktreeMode()`), add:
```typescript
  const { features } = useConfig()
```

- [ ] **Step 3: Fold the flag into `canStartWorktree` (L193)**

Replace:
```typescript
  const canStartWorktree = () => isSidebar() && server.gitInstalled()
```
with:
```typescript
  const canStartWorktree = () => features().worktree && isSidebar() && server.gitInstalled()
```

- [ ] **Step 4: Fold the flag into `canMoveToWorktree` (L195)**

Replace:
```typescript
  const canMoveToWorktree = (hasChat: boolean) => hasChat && canContinueInWorktree() && server.gitInstalled()
```
with:
```typescript
  const canMoveToWorktree = (hasChat: boolean) =>
    features().worktree && hasChat && canContinueInWorktree() && server.gitInstalled()
```

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: succeeds, no TS errors.

- [ ] **Step 6: Verify (no commit)**

Leave changes in the working tree. Do NOT commit.

---

## Task 8: Full build + manual verification in the dev host

**Files:** none (verification only)

- [ ] **Step 1: Full build + unit tests**

Run:
```bash
bun run build
bun test tests/unit/features-flags.test.ts
```
Expected: build clean, tests pass.

- [ ] **Step 2: Launch the Extension Development Host (default — all flags off)**

Launch the dev host per the repo workflow (F5 / the project's launch task). With no env vars set, verify in the Kilo Code panel:
- Top toolbar shows only: New Task (+), History, Profile, Settings. **Agent Manager, KiloClaw, Marketplace icons are gone.**
- Cmd+Shift+M does nothing (Agent Manager does not open).
- Command Palette: "Agent Manager", "KiloClaw", "Marketplace" Kilo commands are absent.
- Settings → Agent Behaviour → Agents / MCP Servers / Skills: **no "Browse Marketplace" button.**
- Chat session-actions row: **no "New Worktree" and no "Move to Worktree"** buttons; "Show Changes" still present when applicable.

- [ ] **Step 3: Re-launch with one flag on to prove the switch drives both channels**

Relaunch the dev host with `KILOCODE_FEATURE_MARKETPLACE=true` in the host process environment (set it in the launch config's `env`, or export it before launching VS Code). Verify:
- Marketplace toolbar icon reappears (native channel).
- "Browse Marketplace" buttons reappear in Settings → Agent Behaviour (webview channel).

This confirms the single `features.ts` source drives the native and webview channels together. Unset it again afterward.

- [ ] **Step 4: Final state**

All changes remain uncommitted in the working tree. Report the list of modified files to the user; the user will commit.

---

## Self-Review Notes

- **Spec coverage:** every spec item maps to a task — flags (T1), webview type/signal (T2), native context keys (T3), package.json `when` (T4), defensive guards (T5), marketplace webview (T6), worktree webview (T7), testing (T8). KiloClaw and Agent Manager have no live webview buttons, so they have no T6/T7 work — covered by native (T3/T4) + guards (T5), as the spec states.
- **Type consistency:** `Features` (T1) and `FeatureFlags` (T2) carry identical keys: `indexing, agentManager, kiloClaw, marketplace, worktree`. `isFeatureEnabled(name: UiFeature)` is used in T3/T5 with the literal keys defined in T1.
- **No esbuild `define`:** flags are read from `process.env` at runtime in the extension host (Node), so no build-time inlining is required. Webview never reads env — it gets flags via `configLoaded`/`configUpdated`.
