# Plan: Claude Code skills + commands by default, with two IDE toggles, a "claude" source tag, and an in-session per-repo prompt

## Goal

In **both IDEs** (VS Code + JetBrains):

1. Read Claude Code **skills** (`.claude/skills`) **and commands** (`.claude/commands`) **by default**.
2. Split the single `claudeCodeCompat` switch into **two independent toggles**:
   - **"Claude Code skills & commands"** — default **ON**.
   - **"Claude Code instructions" (CLAUDE.md)** — default **OFF**.
3. Add support for reading Claude **commands** (new capability; the CLI does not read `.claude/commands` today).
4. Show a **"claude" source tag** in the slash-command menu for entries that come from Claude (skills or commands). Kilo-native entries get **no** tag.
5. Add an **in-session, per-repo "Claude context detected" prompt**: when the current repo contains Claude Code files, inform the user in the session and let them turn "skills & commands" and "instructions (CLAUDE.md)" on/off **for that repo**, remembered per-repo so it never re-asks on the same repo.

Do **not** change the bare CLI/TUI defaults (skills + prompt already default-on there). Commands are net-new, so the CLI/TUI will also gain `.claude/commands` reading by default — this is intended and consistent.

## Key decisions (resolved)

- **Two toggles, granular env vars.** Stop sending the broad `KILO_DISABLE_CLAUDE_CODE` from the IDEs. Use per-area env vars instead:
  - skills+commands toggle OFF → set `KILO_DISABLE_CLAUDE_CODE_SKILLS=true` **and** `KILO_DISABLE_CLAUDE_CODE_COMMANDS=true`
  - instructions toggle OFF → set `KILO_DISABLE_CLAUDE_CODE_PROMPT=true`
  - Defaults (skills+commands ON, instructions OFF) → IDEs send only `KILO_DISABLE_CLAUDE_CODE_PROMPT=true`.
- **Instructions default OFF preserves the two closed bugs.** #8128 (CLAUDE.md overriding custom-mode identity) and #8187 (CLAUDE.md/skills auto-injected, agent aware of Claude hooks) are both caused by **CLAUDE.md prompt auto-injection** (`instruction.ts:67,71`). Keeping instructions OFF by default keeps both fixed.
  - Skills default ON only re-advertises skill name+description in the system prompt (`system.ts:145-155`); full skill body loads only when the model calls the `skill` tool. Mild; touches the soft half of #8187 but not the identity/hook harm.
  - Commands default ON has **zero** regression risk: commands never inject into the prompt; they run only when the user types `/name`.
- **Origin/tag model.** Add an optional `origin` field (`"claude"`, extensible) to the CLI `Command.Info`, propagate through the `/command` endpoint → SDK → both IDE UIs. Render a "claude" badge when `origin === "claude"`. No `origin` = Kilo-native = no badge. Scope: **claude only** for now (MCP and `.agents` intentionally untagged).
- **Settings placement:** both toggles move into a **new "Compatibility" subtab under Agent Behaviour** in both IDEs (not the current Rules subtab). Name is future-proofed to hold other external-tool interop later; the individual toggles stay explicitly labeled "Claude Code skills & commands" and "Claude Code instructions". Remove the old single toggle from Rules.
- **Command discovery lives in a Kilo-owned module** (`packages/opencode/src/kilocode/command/claude.ts`) to minimize upstream merge conflicts; `command/index.ts` gets one small `kilocode_change` hook to merge results.
- **Precedence:** Kilo built-ins + config commands + MCP prompts + skills all win. Claude commands only fill names not already taken (`if (commands[name]) continue`). Claude skills already merge with the same rule.
- **Naming:** reuse `configEntryNameFromPath(relative, ["commands/","command/"])`, so `.claude/commands/frontend/component.md` → `frontend/component` (consistent with Kilo commands; not Claude's `:` convention).
- **Command discovery scope:** read **both** global `~/.claude/commands` and project `.claude/commands` (walking up to worktree), matching skills and Kilo's own project commands. See the `!bash` security note in Risks.
- **Apply UX:** toggles set spawn-time env vars, so a change needs a backend restart. On toggle change, **prompt the user to reload** with a one-click action (VS Code: `workbench.action.reloadWindow`; JetBrains: a restart/notification action). Do not auto-tear-down the shared backend. Keep a "requires reload" hint in the description too.
- **Annotation markers:** `runtime-flags.ts` is a shared upstream file (Claude flags were re-applied in a "kilo compat" merge commit), so the new `disableClaudeCodeCommands` flag **must** carry a `kilocode_change` marker even though the neighboring `disableClaudeCodePrompt`/`disableClaudeCodeSkills` lack theirs (pre-existing inconsistency — do not rely on it). `command/index.ts` edits also need markers. Discovery code stays in `src/kilocode/command/` (no markers needed there).
- **JetBrains slash tag:** in `KiloPromptCompletionProvider.server()`, show `"claude"` as the row's type text when `origin == "claude"`; otherwise keep the current `withTypeText(source)` behavior unchanged. (VS Code shows no source text today, so it only gains the new claude badge.)
- **Migration:** legacy `claudeCodeCompat === true` → new **instructions** toggle defaults ON (preserve prior opt-in). skills+commands default ON regardless. Do not attempt to detect an explicit legacy `false` opt-out.

### In-session prompt (feature 5)

- **Per-repo override.** The in-session choice applies only to the current repo and is stored client-side keyed by the workspace/repo root (VS Code `workspaceState` via a `SandboxPreference`-style store; JetBrains `PropertiesComponent.getInstance(project)`). The **effective** flag for each area = per-repo override if set, else the global Compatibility-subtab default. The IDE computes the CLI env vars from the effective value; enabling CLAUDE.md here is an informed **per-repo opt-in** and does **not** change the global default (global stays OFF). Applying a change requires a backend reload (reuse the reload prompt).
- **Coverage = two controls.** The banner shows up to two per-repo controls: "Claude Code skills & commands" and "Claude Code instructions (CLAUDE.md)". It triggers when the repo has **any** of: project/global `CLAUDE.md`, `.claude/skills`, `.claude/commands`. Only render the control(s) relevant to what the detection endpoint reports present (e.g. if only `CLAUDE.md` exists, show just the instructions control); if nothing is present, no banner.
- **Detection.** Add a small **Kilo-owned** endpoint (e.g. `GET /config/claude-context`, under `src/kilocode/server/`) reporting filesystem presence for the request directory of: `CLAUDE.md` (project + global `~/.claude/CLAUDE.md`), `.claude/skills`, `.claude/commands`. Works regardless of toggle state (needed because when a toggle is OFF the items won't appear in `/command` or `/skill`). Alternative: extend the existing `/config/rules` endpoint (already reports CLAUDE.md), but a dedicated endpoint avoids overloading "rules".
- **Ask-once semantics.** The banner shows only when Claude files are present **and** no per-repo decision is recorded. Any explicit action records `decided = true` so it never re-asks for that repo: changing a control writes an explicit per-repo override (+ reload prompt); dismissing / "don't ask again" records `decided` with **no** override (the repo keeps following the global default). Changing the global setting later does not clear per-repo decisions (per-repo wins).
- **Keying.** Key the per-repo record by the primary workspace folder / repo root so Agent Manager worktrees (same repo) share the decision and the one shared backend's env reflects it.

## Out of scope / noted

- TUI slash-menu badge (user asked for "both IDEs"). The CLI change means the TUI will list Claude commands+skills without a badge — acceptable.
- Tagging `.agents` external skills or MCP prompts.
- Changing bare-CLI defaults.

### Codex support (analysis — deliberately out of scope)

Codex shares the open `AGENTS.md` + `.agents/skills` conventions Kilo/opencode already implement, so most "Codex context" needs **no new work**:

- **Project instructions** = `AGENTS.md` → already Kilo's **native** instruction file (always read; no toggle).
- **Skills** = repo `.agents/skills/` + `~/.agents/skills/` → **already read by default** (`skill/index.ts:211`, `AGENTS_EXTERNAL_DIR = ".agents"`; gated by the general `disableExternalSkills`).
- **Custom commands** = `~/.codex/prompts/*.md` → **removed by Codex in codex-cli 0.117.0 (2026)** and replaced by skills. There is **no Codex commands analog to build** (unlike Claude).

Genuinely Codex-specific gaps, intentionally **not** in this plan (small, and one is bug-risky):
- Global `~/.codex/AGENTS.md` (analog to `~/.claude/CLAUDE.md`; same auto-injection risk as #8128/#8187 → would belong behind the instructions toggle, default OFF).
- `~/.codex/skills/` alternate personal skills dir; `AGENTS.override.md` + full AGENTS.md concatenation-chain semantics (Kilo reads the first project match, Codex concatenates root→cwd).

Tagging note: do **not** tag `.agents/skills` as "codex" — `.agents` is a **cross-tool** convention (Codex, Amp, etc.), not Codex-specific. The `origin` field stays a free string so a generic "external" tag could be added later without rework.

---

## Task list

### A. CLI core (`packages/opencode/`) — shared upstream files, use `kilocode_change` markers

1. **Add `disableClaudeCodeCommands` flag** in `src/effect/runtime-flags.ts` mirroring `disableClaudeCodeSkills` (lines 29-32):
   - `Config.all({ broad: bool("KILO_DISABLE_CLAUDE_CODE"), direct: bool("KILO_DISABLE_CLAUDE_CODE_COMMANDS") })` → `broad || direct`.
   - Add a `// kilocode_change` marker (shared upstream file — required; see Key decisions).
2. **New Kilo-owned discovery module** `src/kilocode/command/claude.ts` (no markers needed — path contains `kilocode`):
   - Scan global `~/.claude/commands/**/*.md` and project `.claude/commands/**/*.md` walking up from `directory` to `worktree` (+ `primaryPaths` fallback), mirroring the external-dir logic in `src/skill/index.ts:208-238`.
   - Parse each file with `ConfigMarkdown.parse` + `ConfigCommandV1.Info` (reuse `config/command.ts` approach), preserving trust/`fileScope`/`sourceScope` so project commands stay confined to the project root (mirror `skill/index.ts` `add()`), and capturing warnings.
   - Return command `Info`s with `origin: "claude"` and `source: "command"`, keyed by `configEntryNameFromPath`.
   - Gate the whole scan behind `!disableClaudeCodeCommands`.
3. **Extend `Command.Info` schema** in `src/command/index.ts` (line 30-42) with `origin: Schema.optional(Schema.String)` (`kilocode_change`).
4. **Merge Claude commands** in `src/command/index.ts` `init()` (`kilocode_change` block, after the skills merge at line 159-162):
   - Call the Kilo-owned loader; for each, `if (commands[name]) continue; commands[name] = { ...info, origin: "claude" }`.
   - Thread `disableClaudeCodeCommands` from `RuntimeFlags` into the `Command` layer (add to `layer`/`node` provides like `Skill` does).
5. **Tag Claude skills** in `fromSkill()` (`src/command/index.ts:65-75`): set `origin: "claude"` when `item.location` is under a `.claude/` path (normalize `/` vs `\`). This keeps the change confined to `command/index.ts` and avoids touching `Skill.Info`. (Alternative if preferred: add `origin` to `Skill.Info` at discovery in `skill/index.ts` where `CLAUDE_EXTERNAL_DIR` is scanned.)
6. **Regenerate the SDK**: run `./script/generate.ts` from repo root so `Command.Info.origin` reaches `@kilocode/sdk`.

### B. VS Code extension (`packages/kilo-vscode/`) — no `kilocode_change` markers needed

7. **Settings** in `package.json` (replace `kilo-code.new.claudeCodeCompat` at line 1039):
   - `kilo-code.new.claudeCodeSkillsCommands` — boolean, default `true`.
   - `kilo-code.new.claudeCodeInstructions` — boolean, default `false`.
   - Keep the old key readable for one-time migration (see task 12).
8. **Server env** in `src/services/cli-backend/server-manager.ts` (lines 89-90, 150): stop sending `KILO_DISABLE_CLAUDE_CODE`. Compute the **effective** value for each area = per-repo override (from the workspace-keyed store, task 21) if set, else the global setting; then set:
   - `...(!skillsCommands && { KILO_DISABLE_CLAUDE_CODE_SKILLS: "true", KILO_DISABLE_CLAUDE_CODE_COMMANDS: "true" })`
   - `...(!instructions && { KILO_DISABLE_CLAUDE_CODE_PROMPT: "true" })`
   - Key the override lookup by the spawn cwd / primary workspace folder.
9. **New "Compatibility" subtab** in `webview-ui/src/components/settings/AgentBehaviourTab.tsx`:
   - Add `"compatibility"` to `SubtabId` (line 24) and a `subtabs` entry (line 31-37) with label key `settings.agentBehaviour.subtab.compatibility`.
   - Add a `renderCompatibilitySubtab()` and wire it into `renderSubtabContent()` (line 1084-1096). Place it after Rules/before Skills or at the end — pick a sensible order.
   - Move the two toggles here (out of `renderRulesSubtab`, lines 1060-1080): two `SettingsRow` toggles — "Claude Code skills & commands" (default ON) and "Claude Code instructions" (default OFF) — with two signals.
   - Update the `requestClaudeCompatSetting`/`claudeCompatSettingLoaded` round-trip to carry both booleans; update `src/KiloProvider.ts` (lines 1351-1352, 3834-3838) and message types in `webview-ui/src/types/messages/{extension-messages,webview-messages}.ts`.
10. **Reload prompt** in `src/KiloProvider.ts` `handleUpdateSetting` (line 3730): when the changed key is either Claude toggle, after writing the config show `vscode.window.showInformationMessage(..., "Reload Window")` and, if chosen, run `vscode.commands.executeCommand("workbench.action.reloadWindow")`. (Do not restart the shared backend directly.)
11. **i18n**: add `settings.agentBehaviour.subtab.compatibility`, the two toggle blocks (skills&commands, instructions — each heading/title/description, description includes a "requires reload" note), and the reload-prompt string, across all locale files under `webview-ui/src/i18n/` (en + the other 17). Keep English authoritative; other locales can start as English fallback if translation isn't available.
12. **Migration**: if new keys are unset but legacy `claudeCodeCompat === true`, default the **instructions** toggle to ON (preserve prior opt-in). skills+commands defaults ON regardless. Read the legacy value via `getConfiguration().inspect()` globalValue.
13. **Slash badge**:
    - `webview-ui/src/types/messages/agents.ts`: add `origin?: string` to `SlashCommandInfo` (line 11-16).
    - `src/kilo-provider/commands.ts`: forward `origin` in the `commandsLoaded` mapping (line 16-21).
    - `webview-ui/src/components/chat/PromptInput.tsx`: in the server-commands rows (lines 1315-1332) render a small badge (`<span class="slash-command-source">claude</span>`) when `cmd.origin === "claude"`.
    - Add a `.slash-command-source` style in the chat CSS (small, muted, right-aligned, matching existing menu styling).

### C. JetBrains plugin (`packages/kilo-jetbrains/`)

14. **Settings holder** `backend/.../cli/KiloClaudeCompatSettings.kt`: split into two persisted booleans — `kilo.claudeCodeSkillsCommands` (default `true`) and `kilo.claudeCodeInstructions` (default `false`). One-time migration: legacy `kilo.claudeCodeCompat === true` → instructions default true.
15. **Env** `backend/.../cli/KiloBackendCliManager.kt` (line ~602, in `buildKiloCliEnv`): replace the single broad `KILO_DISABLE_CLAUDE_CODE` line with granular vars matching task 8, using the **effective** value (per-project override from task 24 if set, else the app-level setting).
16. **RPC** `shared/.../rpc/KiloAgentBehaviorRpcApi.kt` + `backend/.../rpc/KiloAgentBehaviorRpcApiImpl.kt` + `frontend/.../app/KiloAgentBehaviorService.kt`: expose two getters/setters instead of `claudeCodeCompat()`.
17. **New "Compatibility" child configurable** under Agent Behavior:
    - Create `CompatibilityConfigurable` + `CompatibilitySettingsUi` under `frontend/.../settings/` (mirror `RulesConfigurable`/`SkillsConfigurable` structure), holding the two toggles ("Claude Code skills & commands" default ON, "Claude Code instructions" default OFF).
    - Register it in `AgentBehaviorConfigurable.kt` child list (lines 27-30) with display name key `settings.agentBehavior.compatibility.displayName`.
    - Remove the compat toggle from `RulesSettingsUi.kt` (line ~84).
    - Add the display-name + toggle strings to the JetBrains `KiloBundle` `*.properties` files.
18. **Apply prompt**: after either toggle changes (in the RPC setter path / settings apply), surface a restart/reload affordance for the CLI backend (JetBrains notification or restart action), since the env is read at `kilo serve` spawn. Match the VS Code reload-prompt intent.
19. **Slash badge**:
    - `shared/.../rpc/dto/CommandDto.kt`: add `origin: String?`.
    - `backend/.../workspace/KiloWorkspaceState.kt` `CommandInfo`: add `origin`.
    - `backend/.../cli/KiloCliDataParser.kt` `parseCommands` (line ~635): read `origin`.
    - `backend/.../rpc/KiloWorkspaceDtoMapper.kt` (line ~56): map `origin`.
    - `frontend/.../session/ui/prompt/KiloPromptCompletionProvider.kt` `server()` (lines 236-242): when `command.origin == "claude"`, show a "claude" tag (e.g. via `withTypeText("claude")` or a `LookupElementRenderer`); otherwise keep current behavior.

### D. In-session per-repo "Claude context detected" prompt (feature 5)

20. **Detection endpoint (Kilo-owned CLI)**: add `GET /config/claude-context` under `src/kilocode/server/` (mirror `config-rules.ts`), returning for the request directory: `{ instructions: { present }, skills: { present }, commands: { present } }` based on filesystem existence of project/global `CLAUDE.md`, `.claude/skills`, `.claude/commands`. Uses `InstanceState.context` directory/worktree; accepts `directory` like `/config/rules`. Regenerate the SDK. (No `kilocode_change` markers — path contains `kilocode`.)

#### VS Code
21. **Per-repo store**: add a `workspaceState`-backed, directory-keyed store (mirror `src/services/sandbox-preference.ts`) holding `{ decided: boolean, skillsCommands?: boolean, instructions?: boolean }` keyed by the primary workspace folder. Expose read/write + used by `server-manager.ts` (task 8) to compute effective env.
22. **Banner UI**: add a dismissible in-chat banner (reuse the `StartupErrorBanner`/`KiloNotifications` pattern; render in the chat view, e.g. `ChatView.tsx` input dock or `MessageList` header). Show only when `claude-context` reports any present **and** `!decided` for this repo. Two toggle controls (skills & commands; instructions/CLAUDE.md) reflecting the current effective values, an apply/confirm, and a "Don't ask again" dismiss.
23. **Wiring**: on session/workspace ready, fetch `claude-context` (new HTTP client method + `KiloProvider` fetch-and-send + webview message types, following the extension↔webview feature pattern). On apply: write the per-repo override + `decided=true`; if any effective value changed, show the reload prompt (reuse task 10). On dismiss: set `decided=true` with no override. Optional: a `kilo-code.new` command to reset per-repo Claude decisions (mirror the notifications-reset pattern).

#### JetBrains
24. **Per-project store**: persist `{ decided, skillsCommands?, instructions? }` via `PropertiesComponent.getInstance(project)` (mirror `KiloSettingsSelection`); used by `KiloBackendCliManager` (task 15) to compute effective env.
25. **Detection RPC**: expose `claude-context` to the frontend (backend calls the new endpoint; add DTO + RPC method following the workspace-state/DtoMapper pattern).
26. **Banner UI**: reuse the `LoginRequiredView`/`RevertBanner` inline-card pattern wired via `SessionMessageListPanel` in `SessionUi.kt` — show a dismissible card with two toggles + Apply + Dismiss when Claude files present and `!decided`. On apply: write per-project override + `decided`; surface the restart/reload affordance (task 18). On dismiss: `decided` with no override.

---

## Risks / edge cases

- **#8128 / #8187 regression**: guarded by instructions default OFF. Do not let any code path re-introduce the broad `KILO_DISABLE_CLAUDE_CODE` absence that would enable the prompt by default in the IDEs. Add an env test asserting `KILO_DISABLE_CLAUDE_CODE_PROMPT=true` is present under defaults.
- **Merge-conflict surface**: keep discovery in `src/kilocode/command/claude.ts`; only `runtime-flags.ts` and `command/index.ts` touch shared files, each behind `kilocode_change`. Run `bun run script/check-opencode-annotations.ts --worktree`.
- **Claude frontmatter fields** (`allowed-tools`, `argument-hint`, `disable-model-invocation`): silently dropped by `ConfigCommandV1.Info` (excess props ignored). `allowed-tools` is **not** enforced — acceptable gap; note in changeset.
- **Claude `model:` values** (e.g. `claude-3-5-haiku`) may not resolve to a Kilo provider and could fail `Provider.parseModel` at execution (`prompt.ts:2051`). Ignore/drop the `model` field for Claude-sourced commands to avoid execution errors.
- **Name collisions**: Kilo wins; Claude entries are skipped. Confirm both Claude commands and Claude skills follow this.
- **Project command shell execution (security)**: a project-level `.claude/commands/*.md` can contain `` !`bash` `` that runs (no permission prompt) during template expansion when the user invokes the slash command (`prompt.ts:2035-2046`). Reading `.claude/commands` by default means any cloned repo's committed commands appear in the slash menu and can run embedded shell on explicit invocation. This is the **same risk class** as today's Kilo project commands (`.kilo`/`.kilocode`/`.opencode`), but exposure broadens because `.claude/` is widespread. Keep parity with existing project-command trust handling (untrusted project sources still confine `{file:}`/`{env:}`/`@` refs); document in the changeset. A broader "confirm before running project-command shell" gate would apply to all project commands and is out of scope here.
- **Apply requires reload**: env vars are read at `kilo serve` spawn; toggling either setting takes effect only after a backend restart. Handled via the reload prompt (VS Code task 10, JetBrains task 18) plus a "requires reload" hint in the descriptions.
- **Legacy setting migration**: users who explicitly set `claudeCodeCompat=false` will now get skills+commands ON (intended product change). Users who set it `true` keep instructions ON via migration.
- **Per-repo override precedence (feature 5)**: per-repo override wins over the global Compatibility setting; changing the global setting does not clear per-repo decisions. Document so users aren't confused when a repo differs from the global toggle. Consider the optional reset command.
- **Detection when a toggle is OFF**: the banner must detect Claude files via the filesystem endpoint (task 20), not the `/command`//`/skill` lists (which are empty when disabled).
- **No-noise**: banner must never appear for repos without any Claude files, and never re-appear once `decided` for that repo. Multi-root workspaces key off the primary folder (edge case — note only).

## Validation

- **CLI** (`packages/opencode/`, `bun test`):
  - New tests in `test/kilocode/` for `.claude/commands` discovery: global-only, project walk-up, precedence vs Kilo commands/skills, `origin: "claude"` set, and gating by `disableClaudeCodeCommands` / broad `KILO_DISABLE_CLAUDE_CODE`.
  - Extend `test/effect/runtime-flags.test.ts` for `disableClaudeCodeCommands` (default false; reads `KILO_DISABLE_CLAUDE_CODE_COMMANDS`; inherits `KILO_DISABLE_CLAUDE_CODE`).
  - Assert `fromSkill` sets `origin: "claude"` for `.claude` skills and leaves Kilo skills untagged.
  - `bun run typecheck`.
- **VS Code** (`packages/kilo-vscode/`): `bun run typecheck`, `bun run lint`, `bun run test:unit`. Extend `tests/unit/use-slash-command*.test.ts` for `origin` passthrough. Add/extend a server-manager env test asserting default env = `KILO_DISABLE_CLAUDE_CODE_PROMPT=true` only. `bun run knip`. `bun run compile`.
- **JetBrains** (`packages/kilo-jetbrains/`): `./gradlew typecheck && ./gradlew test`. Update `KiloBackendCliManagerEnvTest` for the new granular env vars under each toggle combination; add a `CompatibilitySettingsUi` test (fake-RPC) for the two toggles and update/trim `RulesSettingsUiTest` now that the compat toggle moved out of Rules; add a `parseCommands` origin test.
- **In-session prompt (feature 5)**:
  - CLI: test `/config/claude-context` presence detection (CLAUDE.md / `.claude/skills` / `.claude/commands` present vs absent; project + global) under `test/kilocode/`.
  - VS Code: unit-test the effective-value resolution (per-repo override ?? global) that feeds env; test the per-repo store `decided`/override read-write; test banner gating (shows when present && !decided, hidden otherwise, never re-shows after decide/dismiss).
  - JetBrains: test the per-project store + effective env resolution in `KiloBackendCliManagerEnvTest`; a `BasePlatformTestCase` for banner visibility gating and toggle→persist behavior.
- **Cross-cutting**: `bun run script/check-opencode-annotations.ts --worktree`; `bun run script/extract-source-links.ts` if any URLs changed; SDK regen committed.
- **Changeset**: add a user-facing `minor` changeset describing the two toggles, default-on skills+commands, new Claude command support, the "claude" tag, and the in-session per-repo Claude-context prompt.

## Open (minor, non-blocking) decisions

- **Final English copy**: exact heading/title/description wording for the two toggles and the "Compatibility" subtab/page label. Proposed keys and defaults are fixed above; only the human strings are left for the implementer to draft.

## Implementation note

This plan requires source edits across three packages plus an SDK regen and Gradle/Kotlin changes. Switch to an implementation-capable agent to execute it.
