# Kilocode — Hide Additional Features (per-feature flags)

- **Task:** LLMAPI-388 — "Kilocode hide additional features"
- **Date:** 2026-06-11
- **Status:** Approved design
- **Package:** `packages/kilo-vscode` (the "new" Kilo Code panel)

## Problem

The new Kilo Code panel ships several Kilo-specific extras that the LLMAPI whitelabel
build should not expose: **KiloClaw**, **Agent Manager**, **Marketplace**, and the
**Worktree** session actions. They must be hideable per feature, default-hidden in this
build, and unreachable through every entry point — not just the top toolbar icons.

The toolbar icons are native VS Code `view/title` menu contributions (not React), so they
can only be hidden via `when` context keys. The in-webview entry points (Settings "Browse
Marketplace", ChatView worktree/agent-manager buttons) are React and are gated separately.
A single source of truth prevents the two halves from drifting (icon hidden but a button
left behind).

## Scope

In scope — four feature flags:

| Flag | Hides |
|------|-------|
| `agentManager` | Toolbar icon, Cmd+Shift+M keybinding, command-palette entry, ChatView `openAgentManager` button |
| `kiloClaw` | Toolbar icon, command-palette entry (no webview entry points) |
| `marketplace` | Toolbar icon, command-palette entry, 3× "Browse Marketplace" buttons in Settings → Agent Behaviour |
| `worktree` | ChatView "New Worktree" split button + Configure, "Move to Worktree" button |

Out of scope: Profile/Account, Feedback & Support, prompt-bar controls (model / mode /
auto-approve / enhance / speech), indexing (already flag-gated). "Show Changes" stays
(not a worktree feature).

## Architecture

Single source of truth → two delivery channels. One source eliminates native/webview drift.

```
configFeatures() [src/features.ts]   ← env override, default = hidden (false)
        │
        ├─► extension.ts: setContext("kilocode.feature.<flag>", value)
        │        └─► package.json `when` clauses (native UI: view/title, editor/title,
        │            commandPalette, keybindings)
        │
        └─► configLoaded / configUpdated messages → FeatureFlags
                 └─► webview useConfig().features → <Show when={features().<flag>}>
```

### Flag definitions

Default `false`. Build-time override via env, inlined by esbuild `define`:

| Flag | Env override |
|------|--------------|
| `agentManager` | `KILOCODE_FEATURE_AGENT_MANAGER` |
| `kiloClaw` | `KILOCODE_FEATURE_KILOCLAW` |
| `marketplace` | `KILOCODE_FEATURE_MARKETPLACE` |
| `worktree` | `KILOCODE_FEATURE_WORKTREE` |

Env semantics: unset → default (`false`); `"true"` → enabled; anything else → disabled.

Files changed for the flag plumbing:
- `src/features.ts` — extend `Features` type and `configFeatures()`; add env helper and an
  `isFeatureEnabled(name)` helper so the extension side reads the same values it pushes via
  `setContext`.
- `webview-ui/src/types/messages/config.ts` (~L146) — extend `FeatureFlags` interface.
- `webview-ui/src/context/config.tsx` (~L51) — extend the default `features` signal so the
  flags are `false` until `configLoaded` arrives.
- `esbuild.js` — add `define` entries for the four env vars if not already inlined.

The existing `configLoaded` / `configUpdated` messages already carry `features`
(`KiloProvider.ts`), so no new message type is needed.

## Channel 1 — Native (package.json + extension.ts)

- **setContext**: at activation in `src/extension.ts`, near the toolbar command
  registration (~L323), set all four `kilocode.feature.<flag>` context keys from
  `configFeatures()`.
- **view/title icons** (`package.json` L469–L481): append to each `when`:
  - `agentManagerOpen` → `view == kilo-code.SidebarProvider && kilocode.feature.agentManager`
  - `kiloClawOpen` → `... && kilocode.feature.kiloClaw`
  - `marketplaceButtonClicked` → `... && kilocode.feature.marketplace`
- **editor/title** duplicates of the same commands (~L520–L527) — gate identically.
- **commandPalette** (`package.json` ~L440–L455): give the real commands
  `kilo-code.new.agentManagerOpen`, `kilo-code.new.kiloClawOpen`,
  `kilo-code.new.marketplaceButtonClicked` a `when: "kilocode.feature.<flag>"`. Currently
  only the `sidebarTitle.*` wrapper commands are hidden (`when: false`); the underlying
  commands are still palette-reachable.
- **keybinding** Cmd+Shift+M (`package.json` ~L597) → `when` gains
  `&& kilocode.feature.agentManager`.

## Channel 2 — Webview (`<Show>`)

- **Marketplace** — `webview-ui/src/components/settings/AgentBehaviourTab.tsx`, the three
  "Browse Marketplace" buttons (~L328 Agents, ~L584 MCP, ~L811 Skills): wrap each in
  `<Show when={features().marketplace}>`.
- **Agent Manager** — `webview-ui/src/components/chat/ChatView.tsx` `openAgentManager`
  button (~L144): gate with `features().agentManager`.
- **Worktree** — `ChatView.tsx`:
  - New Worktree split button + Configure (~L230–L274): condition becomes the existing
    `canStartWorktree()` guard **AND** `features().worktree`.
  - Move to Worktree button (~L275–L292): gate with `features().worktree`.
  - Show Changes (~L294–L313): **unchanged**.
- **KiloClaw** — no in-webview entry points.

## Defensive guards

Even with UI hidden, the commands/messages still exist and can be invoked
programmatically. Add an early `return` when the feature is disabled (reading
`isFeatureEnabled(...)` from `features.ts`):

- Command handlers in `src/extension.ts` (L351–L359): `agentManagerOpen`,
  `marketplaceButtonClicked`, `kiloClawOpen`.
- Message routers: `openMarketplacePanel` in `src/KiloProvider.ts` (~L881–L883),
  `openAgentManager` in `src/kilo-provider/sidebar-worktree.ts` (~L37–L38).

## Testing

1. `bun run build` in `packages/kilo-vscode` — must pass type-check; `FeatureFlags`
   (webview) and `Features` (extension) stay in sync.
2. Dev-host (default build, all flags off): confirm the three toolbar icons are gone,
   Cmd+Shift+M does nothing, Settings → Agent Behaviour shows no "Browse Marketplace"
   buttons, and the worktree session-action buttons are hidden.
3. `KILOCODE_FEATURE_MARKETPLACE=true bun run build` → Marketplace returns through **both**
   channels (toolbar icon reappears AND the Settings buttons reappear) — proves the single
   source drives native + webview together.

## Risks / notes

- Worktree is conceptually tied to Agent Manager (parallel agents each in a worktree) but
  gets its own flag per the per-feature requirement. Hiding `agentManager` while leaving
  `worktree` on is allowed but produces a worktree UI with no agent-manager surface; the
  default (both off) avoids this.
- Agent Manager has many companion worktree commands registered in `package.json`
  (newWorktree, openWorktree, closeWorktree, advancedWorktree, jumpTo1–9). These live in the
  Agent Manager panel, which is itself unreachable when `agentManager` is off, so they need
  no separate gating for this task.
