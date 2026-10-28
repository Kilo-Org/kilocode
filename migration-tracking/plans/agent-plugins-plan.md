# Agent Plugins support on v2

Plan for a v2 plugin that loads [Agent Plugins](https://agent-plugins.org/specification) packages (spec 1.0.0) and contributes their skills and MCP servers to a Location. Status: PR 1 and PR 2 implemented on branch `agent-plugins`; PR 3 (RPC, TUI hint, docs) not started. See "Implementation notes" at the end.

## Goal

A Kilo v2 client that conforms to Agent Plugins 1.0.0 for both component types:

- Loads a plugin from a directory path (§11.1.1), validates the closed `plugin.json` (§5), and rejects the plugin on fatal errors.
- Finds skills in `skills/<dir>/SKILL.md`, one level deep only (§7.1), and adds them through `ctx.skill.transform`.
- Reads MCP servers from `mcp.json` (§7.2) and adds them through `ctx.mcp.transform`. It supports `stdio` and `streamable-http`, skips `sse` and reports it (the spec makes `sse` optional; core has no SSE client).
- Provides `PLUGIN_ROOT` and `PLUGIN_DATA` and expands `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` (§9).
- Keeps failures isolated (§11.3) and reports every invalid item.

Out of scope for this plan: install, update, uninstall and marketplace flows (unit U-E2-23 owns those), and component types outside v1 (commands, agents, hooks, rules). They can come later as a Kilo client extension (§8).

v1 Kilo has no Agent Plugins support (`git grep` on `origin/main` finds no `plugin.json` or `claude-plugin` loader). This is new behavior, so there are no progress-map cells to close and no v1 proof to compare against.

## Findings that shape the design

| Fact | Where | Consequence |
|---|---|---|
| The public plugin API has the editors needed: `SkillEditor.add` and `MCPEditor.set`, plus `reload()` | `packages/plugin/src/effect/skill.ts:6-17`, `mcp.ts:6-17` | Rung 1 is enough. No upstream seam is needed for the core feature. |
| `transform` callbacks run synchronously and are replayed on every rebuild. `reload()` only invalidates. | `packages/core/src/state.ts:160-252` | Load into closure state first, register one transform that reads it, then call `reload()` after a refresh. This is the same pattern as `ConfigCompatibilityPlugin` (`packages/core/src/config/plugin/compatibility.ts:39-75`). |
| The host decodes every `add` and `set` with `Schema.decodeUnknownSync` and throws on invalid input. A throwing transform disables the whole plugin group. | `packages/core/src/plugin/host.ts:384-412, 464-477`; `state.ts:179-184` | Validate everything before it reaches the editor. Do not let the transform throw. |
| `Skill.Info` is `{ id, name, description?, autoinvoke?, path, content }`. Skill resources resolve from `dirname(path)`. | `packages/schema/src/skill.ts:26-34`; `packages/core/src/skill.ts:36-74` | `scripts/`, `references/` and `assets/` work as long as `path` is the resolved `SKILL.md`. |
| Core's skill scan recurses up to 6 levels, and `SkillFile.parse` does not enforce Agent Skills name or description rules. | `packages/core/src/config/plugin/skill-scan.ts:11-46`; `skill-file.ts:38-62` | Do the one-level scan and the Agent Skills validation in our own code. Reuse neither. |
| `Mcp.LocalConfig` uses `command: string[]`, `cwd`, `environment`. A relative or missing `cwd` resolves against the **workspace**, not the plugin root. | `packages/schema/src/mcp.ts:26-39`; `packages/core/src/mcp/client.ts:247-259` | The plugin passes an absolute `cwd`, defaulting to `PLUGIN_ROOT`, and an absolute command for `./` paths. |
| The stdio spawner overlays `environment` on the base environment (`extendEnv: true`). Core does no `${...}` expansion for configs that come from plugins. | `packages/core/src/mcp/stdio.ts:84-93` | §9.1 ordering works if `environment = { ...expanded env, PLUGIN_ROOT, PLUGIN_DATA }`. |
| Remote MCP is streamable HTTP only. Leaving `oauth` unset gives client-managed OAuth. | `client.ts:261-293`; `packages/core/src/mcp/index.ts:176-228` | Map `streamable-http` to `{ type: "remote", url, headers }`. Skip `sse` and report it. |
| `ConfigMcpPlugin` runs in the internal **pre** phase and fills only names that are missing. Config skill plugins run in **post** and overwrite by id. | `packages/core/src/config/plugin/mcp.ts:53`; `packages/core/src/plugin/internal.ts:220-275` | Registered in `KiloPlugins` (no phase), the loader runs after config MCP and before config skills. Guard MCP `set` with `editor.get(name)`, so user config wins for both component types. |
| `Config.compatibility()` returns the `.agents` roots (`~/.agents` plus every `.agents` directory on the upward walk). | `packages/core/src/config.ts:32-33, 417` | Use `<agents root>/plugins/*` as the conventional discovery location. This matches the spec's example `~/.agents/plugins/devtools`. |
| SDK plugins get Location services (`Config`, `Watcher`, `FSUtil`) through an existing seam, and `Global` from the host. | `packages/core/src/plugin/supervisor.ts:154,162`; `packages/kilo-cli/src/host.ts:38-55`; `packages/kilo-plugin/src/gateway/index.ts:110` | No new seam. Read Location services with `Effect.serviceOption`, as the Gateway does. |
| Kilo-only config keys go through `KiloConfigPolicy`, a Kilo-owned file. | `packages/core/src/kilocode/config/policy.ts:9-53` | Add the `agent_plugins` key there. No shared file changes. |
| A `.kilo2/plugins/*` directory without a JS entry is silently dropped by the JS plugin loader. | `packages/core/src/config/plugin/source.ts:164-167` | Do not reuse that directory for Agent Plugins, to avoid two meanings for one path. |

## Placement

| Change | Rung | Why not lower | Location |
|---|---|---|---|
| Spec logic: manifest, skills, `mcp.json`, containment, expansion, diagnostics | Kilo-owned loader files, no `@opencode/*` imports | n/a | `packages/kilo-plugin/src/agent-plugins/*.ts` except `index.ts` |
| Discovery, watching, and contribution through `skill.transform` / `mcp.transform` | 1 | n/a | `packages/kilo-plugin/src/agent-plugins/index.ts` |
| Registration | 2 | n/a | one entry in `KiloPlugins`, `packages/kilo-plugin/src/index.ts:24` |
| `agent_plugins` config key | Kilo-owned file in core | n/a | `packages/core/src/kilocode/config/policy.ts` |
| Diagnostics and plugin listing for clients | 1 (Kilo RPC) | n/a | contract `packages/schema/src/kilocode/agent-plugins.ts`, handlers in the adapter |

No shared upstream file is expected to change. Core-internal imports the adapter will add (name them in the PR): `@opencode/core/config` (Service, compatibility roots, entries), `@opencode/core/filesystem/watcher`. `@opencode/util/fs-util` and `@opencode/util/global` are public.

**Alternative considered:** a standalone package under `packages/plugins/agent-plugins` (like `packages/plugins/figma`), loaded through `plugins: [{ package, options }]` and using only the public API. Upstream could take it, but it would have no access to `Watcher`, `Config.compatibility()` or `Global`. It would need its paths passed as options and would lose hot reload and the `.agents` convention. Keeping the spec logic in a package with no `@opencode` dependency leaves this option open: a second thin adapter could be written later.

## Design

### Loader `packages/kilo-plugin/src/agent-plugins/` (everything but `index.ts`)

Pure TypeScript with `effect` (Schema) and `node:fs`/`node:path`. No `@opencode/*` imports (`bun script/upstream/placement.ts --imports` enforces this). Its output is the input to the adapter and, later, to the U-E2-23 installer and the VS Code panel.

```ts
AgentPlugin.load(root: string, options: { dataRoot: string; platform: NodeJS.Platform }): Effect<Loaded>

interface Loaded {
  root: string                    // realpath of the plugin root
  status: "loaded" | "rejected"
  manifest?: Manifest             // only known fields kept
  data: string                    // PLUGIN_DATA for this instance
  skills: Skill[]                 // { name, description, path, body, frontmatter }
  servers: Server[]               // already expanded and resolved, see below
  diagnostics: Diagnostic[]       // { severity, code, message, component?, path? }
}
```

Modules:

1. `manifest.ts` (§5, §8.1)
   - Read `plugin.json` only after checking that its realpath stays inside the root realpath (§4.1 failure boundary 1).
   - Parse the JSON. A non-object top level is fatal.
   - `$schema` must equal `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. Any other value means reject and report the unsupported version. Never fetch a schema.
   - `name` must be 1-64 characters from `[a-z0-9.-]`, start and end alphanumeric, with no `--` and no `..`.
   - `version`, `description`, `homepage`, `repository`, `license` are type-checked only. `keywords` is `string[]`. `author` is closed: `name`, `email`, `url`, all strings.
   - Unknown top-level fields: report a warning, drop the field, keep loading.
   - `extensions`: if it is not an object, report and ignore it. Keep only the namespaces we implement (none in v1 of this plan) and never validate the others.
   - Any other violation rejects the plugin. No components are discovered.

2. `skills.ts` (§6, §7.1)
   - If `skills` is absent, that is fine. If it exists but is not a directory, mark skills invalid and continue.
   - List the immediate children only. A child is a skill when `<child>/SKILL.md` resolves to a regular file inside the root.
   - Validate against the Agent Skills spec:
     - `name` is required, 1-64 characters, lowercase alphanumeric and hyphens, no leading, trailing or double hyphen, and equal to the directory name.
     - `description` is required, 1-1024 characters.
     - `license` is an optional string; `compatibility` is an optional string of at most 500 characters; `metadata` is an optional `Record<string, string>`; `allowed-tools` is an optional string.
   - Skip an invalid skill and report it.
   - Frontmatter parsing uses `gray-matter`, which `packages/plugins/figma` already pins.

3. `mcp.ts` (§7.2, §9)
   - `mcp.json` absent: fine. Present but not a regular file, outside the root, invalid JSON, wrong top-level shape, unsupported `$schema`, or a version different from `plugin.json`: disable MCP for the plugin, report it, and continue.
   - Validate each server against the closed variants:
     - `stdio`: `type`, `command`, `args`, `env`, `cwd`.
     - `streamable-http` / `sse`: `type`, `url`, `headers`.
     - An unknown field, unknown `type`, or a field from another variant skips that server.
   - `stdio`:
     - `command` is one token. A bare name is passed through for PATH search. A `./` path resolves against the root, its realpath must stay inside, and the result is absolute. No expansion in `command`.
     - `env` must not contain `PLUGIN_ROOT` or `PLUGIN_DATA`; if it does, the entry is invalid.
     - Expand `args`, `env` values and `cwd` with one pass that replaces exact occurrences of the two placeholders and leaves other `${...}` text literal. The replacement text is never rescanned.
     - `cwd` is either missing (use the root), `./...`, or `${PLUGIN_ROOT}[/...]` (must stay inside the root realpath), or `${PLUGIN_DATA}[/...]` (must stay inside the data realpath). Expand before resolving. Any other form makes the entry invalid.
     - Final env: expanded `env`, with case-variant names of the reserved variables removed on win32, then `PLUGIN_ROOT` and `PLUGIN_DATA` set last.
   - `streamable-http`:
     - `url` must be absolute `http:` or `https:` with no userinfo and no fragment. Plain `http:` is allowed only for exactly `localhost`, `127.0.0.0/8` or `::1`.
     - Header names must be valid HTTP tokens and values valid field values. Duplicate names under different casing make the entry invalid.
     - No expansion anywhere in remote entries.
   - `sse`: valid entries are skipped with an `unsupported-transport` diagnostic (§7.2.2 rule 4).

4. `data.ts` (§9.1)
   - `PLUGIN_DATA = <dataRoot>/<name>-<first 8 hex of sha256(root realpath)>`. The hash keeps two installs with the same name apart; keying by root path keeps data across in-place updates.
   - Create it (recursive mkdir) at load time when the plugin has at least one valid stdio server. The loader cannot hook spawn, so this runs before any launch.
   - Never delete it. Uninstall belongs to U-E2-23.

5. `paths.ts` (§4.1): one `contained(root, candidate)` helper. It uses `fs.realpath` on both sides and compares path segments, never string prefixes. Every package read goes through it.

### Adapter `packages/kilo-plugin/src/agent-plugins/index.ts`

`define({ id: "kilocode.agent-plugins", effect })`, registered last in `KiloPlugins`.

1. **Discovery roots** (per Location, recomputed on `config.changes()`):
   - Convention: `<root>/plugins/*/` for each `.agents` root from `config.compatibility()`, global and project. Directories without `plugin.json` are ignored silently. This includes the spec's own `~/.agents/plugins/data` directory.
   - Explicit: `agent_plugins.paths` from config. Each entry is one plugin root. `~/` expands, and relative paths resolve against `location.directory`, as `ConfigSkillPlugin` does (`packages/core/src/config/plugin/skill.ts:80-106`). A missing explicit path is reported, unlike a missing convention directory.
   - Deduplicate by root realpath. If two plugins declare the same `name`, the explicit one wins over the project one, and the project one wins over the global one; report the shadowed plugin.
   - `agent_plugins.disabled: string[]` (plugin names) skips plugins without loading them.

2. **Mapping into Kilo types:**
   - Skill: `id = name = "<plugin>:<skill>"`, `description`, `path` = resolved `SKILL.md`, `content` = body. Namespacing avoids collisions between plugins and with user skills, as Claude Code does. `autoinvoke` stays unset unless `metadata["opencode/autoinvoke"]` says otherwise, matching `SkillFile.parse`.
   - MCP server name: `<plugin>:<server>`, like skill IDs. Tool names sanitize `:` and `.` to `_` (`packages/core/src/tool/mcp.ts:22`), so tools read `demo_echo_<tool>`.
     - `stdio` becomes `LocalConfig { type: "local", command: [command, ...args], cwd, environment }`.
     - `streamable-http` becomes `RemoteConfig { type: "remote", url, headers }`.
   - Encode with the schema decoders before `add`/`set`. Anything that fails becomes a diagnostic, never an exception.

3. **Transforms:**
   ```ts
   yield* ctx.skill.transform((editor) => { for (const s of state.skills) editor.add(s) })
   yield* ctx.mcp.transform((editor) => {
     for (const [name, config] of state.servers) if (!editor.get(name)) editor.set(name, config)
   })
   ```
   - User `mcp.servers.<name>` wins, because `ConfigMcpPlugin` ran first. That is also how a user disables one plugin server (`disabled: true`).
   - User skills with the same id win, because the config skill plugins run in post.

4. **Watching:** use `Watcher.Service` with the debounce and `FiberMap` pattern from `compatibility.ts:24-71`.
   - Watch each `plugins/` directory (entries) and each plugin's `plugin.json`, `mcp.json` and `skills/`.
   - On change, refresh under a semaphore, then call `ctx.skill.reload()` and `ctx.mcp.reload()`. MCP reconcile restarts only servers whose config changed (`packages/core/src/mcp/index.ts:536-574`).

5. **Reporting:** log each diagnostic with `Effect.logWarning` / `logError`, including the plugin root and code. Deduplicate against the previous refresh so watch events do not repeat the same warnings. Keep the last `Loaded[]` for the RPC.

6. **Services:**
   - `Global` comes from the host (`global.data` gives `dataRoot = <data>/agent-plugins`).
   - `Config`, `Watcher` and `FSUtil` come through `Effect.serviceOption`. Without `Config` (a bare SDK embed), only explicit paths and the global `~/.agents/plugins` load.

### Config key

Add to `KiloConfigPolicy.Info` and to the raw `policy` struct (`packages/core/src/kilocode/config/policy.ts:9-16`):

```jsonc
// kilo2.json
{
  "agent_plugins": {
    "paths": ["~/src/my-plugin", "./tools/review-plugin"],
    "disabled": ["acme.tools"]
  }
}
```

A malformed value is reported and ignored, without discarding the rest of the config (same rule as `hide_prompt_training_models`). Merge across entries: `paths` concatenate, `disabled` is a union. Regenerate the config JSON schema if Kilo publishes one for `kilo2.json`.

### Client surface (later PR)

- RPC `kilocode.agent-plugins` with methods `list` (plugins, status, component counts, `PLUGIN_ROOT`/`PLUGIN_DATA`) and `diagnostics`. Add an event when they change.
- TUI: plugin-supplied skills and servers already appear in the skills and MCP dialogs, because they go through the same services. The MCP dialog prints `Configuration: mcp.servers.<name>` (`packages/tui/src/component/dialog-mcp.tsx:165`), which is misleading for plugin servers. Fixing it needs origin data the RPC can supply. The fix is a TUI change (rung 4 call-out or a Kilo TUI plugin); plan it with the RPC.
- `packages/kilo-docs`: a user page covering the layout, discovery locations, config, the transport limitation (`sse`), and the `PLUGIN_DATA` location.

## Conformance checklist to tests

Every row is a test in `packages/kilo-plugin/test/agent-plugins/` with a fixture plugin created in a temp directory.

| Spec | Test |
|---|---|
| §5.2/5.3 | Missing or wrong `$schema`, missing `name`, or bad `author` type rejects the plugin and discovers no components |
| §5.2 | An unsupported `$schema` version rejects and reports the version; the loader makes no network call |
| §5.2 | Unknown top-level field produces a warning, the plugin loads, and the field is dropped |
| §5.4 | Non-semver `version`, non-URL `homepage` and non-SPDX `license` are accepted |
| §5.5 | Name table: valid `a`, `acme.tools`, `lint3r`; invalid `My-Plugin`, `-start`, `has--double`, `too.many..dots`, empty, 65 characters |
| §8.1 | Non-object `extensions` produces a warning and loads. Unknown namespaces with arbitrary values are not validated |
| §4.1 | `plugin.json` symlinked outside rejects. `skills` symlinked outside makes skills invalid. A `SKILL.md` outside skips that skill. A `./` command or `cwd` outside makes the server invalid. A symlink inside the root is allowed |
| §6.2 | Missing `skills/` and `mcp.json` produce no diagnostics. A file named `skills` makes skills invalid, and MCP still loads |
| §7.1 | `skills/a/b/SKILL.md` is not found. A name that differs from the directory skips. A missing description skips |
| §7.2.1 | Unknown field, unknown type, or a cross-variant field skips the entry and other servers still load. An empty `mcpServers` is valid |
| §7.2.2 | Invalid JSON, a bad top level, or a version mismatch with `plugin.json` disables MCP, and skills still load |
| §7.2.1 stdio | A bare command passes through. A `./bin/x` command becomes absolute. A missing `cwd` becomes the root. Every `cwd` form, and an escape through `${PLUGIN_DATA}/../..` |
| §7.2.1 http | `https` passes. `http://localhost`, `http://127.0.0.2` and `http://[::1]` pass. `http://example.com`, userinfo and a fragment fail. Duplicate header casing fails |
| §7.2.2 rule 4 | `sse` is skipped with `unsupported-transport` |
| §9.1 | `PLUGIN_DATA` exists and is writable before load returns. The env overlay order holds. The reserved names are set last. On win32, case variants are replaced |
| §9.2 | Single pass with no recursion: a value containing `${PLUGIN_ROOT}` inside the data path is not re-expanded. `${HOME}` stays literal. No expansion in `command` or env keys. `env.PLUGIN_ROOT` makes the entry invalid |

Check whether the spec repository (`agentplugins/agent-plugins-spec`) publishes conformance fixtures. If it does and the license allows, vendor them and run them in the same suite.

Adapter tests (`packages/kilo-plugin/test/agent-plugins.test.ts`), following `packages/core/test/config/skill.test.ts:29-77` and `packages/core/test/plugin/mcp-codemode-defaults.test.ts:90-116`:

- Use a real `Skill.Service`, a fake MCP editor, `Config.testLayer`, `Watcher.testLayer` and a temp `.agents/plugins/demo`.
- Assert the namespaced skill ids, the `LocalConfig` with absolute command, `cwd` and `environment`, and the `RemoteConfig` with no `oauth`.
- User config with the same server name wins. `disabled` skips the plugin. A watch event followed by an edited `mcp.json` updates the server. A rejected plugin contributes nothing and does not break other plugins.
- Update `packages/kilo-plugin/test/index.test.ts` with the new plugin id.

Integration (`packages/kilo-cli/test/`): boot the host with `KiloHost.overrides` and a fixture plugin that ships a small Bun stdio MCP server. The server has one tool that returns `PLUGIN_ROOT`, `PLUGIN_DATA` and `process.cwd()`. Assert through the generated client that `GET /api/skill` lists `demo:summarize`, `GET /api/mcp` shows the server `connected`, and the tool output matches.

## Self-test (per `v2-migration`)

1. Fixture in `$T/repo/.agents/plugins/demo`: `plugin.json`, `skills/summarize/SKILL.md`, an `mcp.json` with the stdio echo server, an `sse` entry and an invalid entry.
2. `env KILO_V2_PROFILE=$(mktemp -d) bun dev run --standalone "Use the demo echo tool and report PLUGIN_DATA"`. The answer contains the profile's `kilo2/agent-plugins/demo-<hash>` path.
3. TUI harness: the skills dialog lists `demo:summarize`, and the MCP dialog lists `demo_echo` as connected. `logs "agent-plugins"` shows exactly the two expected diagnostics (`sse` unsupported, invalid entry).
4. Edit `mcp.json` while the TUI runs and see the server reconnect without a restart.
5. Add `agent_plugins.disabled: ["demo"]` to `kilo2.json` and see both components disappear.

There is no v1 screen to compare with. The PR `## Proof` shows v2 only and says so.

## Delivery (one unit per PR)

1. **`feat(agent-plugins): spec loader`**: the loader files in `packages/kilo-plugin/src/agent-plugins/` with the conformance suite. No runtime wiring.
2. **`feat(agent-plugins): load skills and MCP servers`**: adapter, `KiloPlugins` entry, `agent_plugins` config key, watching, adapter and integration tests, self-test.
3. **`feat(agent-plugins): list plugins over RPC`**: the `kilocode.agent-plugins` RPC, round-trip test, `bun run check:generated` with no drift, TUI MCP hint fix, docs.
4. Later, separate units: install and update through U-E2-23 (reuses `AgentPlugin.load` for validation before install), and a Kilo extension namespace (§8) for Kilo-only components such as agents, commands and hooks.

Before PR 1, add the unit to `migration-tracking/plans/kilo-v2-migration-plan.md` (new, G1, no v1 source). Add a `agent-plugins` box to `migration-tracking/progress/features.json` only if the progress tooling requires one for a feature with no v1 cells.

Checks for each PR:
- `bun typecheck` and isolated `bun test` in each changed package.
- `bun script/upstream/placement.ts --imports`.
- `bun script/check-shared-patches.ts --worktree` (expected unchanged).
- `bun script/upstream/progress.ts --check`.
- `bun run check` from the root.

## Open questions and risks

1. **Cross-origin header forwarding (§7.2.1).** The spec forbids forwarding configured headers to another origin through a redirect. Core passes `headers` into `StreamableHTTPClientTransport` with Bun `fetch`, which follows redirects and keeps custom headers. Before PR 2, verify this with a redirecting test server. If headers leak, the fix is a generic rung-3 seam in `packages/core/src/mcp/client.ts`, for example a per-server redirect policy, and needs its own approval. Until then, one fallback is to refuse remote entries that have `headers`, but that is a conformance loss.
2. **Project-scope trust.** A cloned repo's `.agents/plugins/*` can start stdio processes when the Location boots. Upstream already does this for project `mcp` config and `.agents/skills`, so the plan adds no gate. A per-project approval prompt would add complexity; decide explicitly before PR 2.
3. **MCP server name separator.** Server names prefix tool names. Confirm which characters survive tool-name sanitizing in `packages/core/src/mcp/` before choosing `_`, `.` or `/`. Confirm too that `:` in skill ids works in the skill tool, `/skills` and autocomplete.
4. **Kilo extension namespace.** Pick a stable reverse-domain id for future extensions, `ai.kilo` or `ai.kilocode` (whichever domain Kilo controls long term). Nothing reads it in this plan.
5. **Unknown frontmatter keys in `SKILL.md`.** Confirm whether the Agent Skills spec makes extra keys invalid, as the `skills-ref validate` tool does, or only ignorable. Choose the lenient option if the spec is silent.
6. **Skill resource containment.** `Skill.prepare` lists sibling files and the agent reads them with its normal tools. A symlink inside a skill directory that points outside the root is not blocked at read time. This is acceptable for v1 (runtime file access is out of the spec's discovery scope) but goes in the PR limits.
7. **Windows.** Core's spawner handles `.cmd` / `.bat` resolution for a bare `command`. Confirm this, and the case-insensitive env replacement, on a Windows CI runner.

## Implementation notes

What landed differs from the design above in these points:

- **No separate package.** The loader lives beside the adapter in `packages/kilo-plugin/src/agent-plugins/`, as the marketplace keeps its installer logic in `kilo-plugin`. The plugin is its only consumer. `placement.ts --imports` checks only `kilo-*-core` packages, so `test/agent-plugins/boundary.test.ts` keeps the loader files free of `@opencode` imports. Extracting them into a package later is mechanical if a consumer outside the server needs them. The loader uses `Bun.YAML` for frontmatter instead of adding `gray-matter`.
- **Headers on remote servers (risk 1, confirmed).** A Bun `fetch` test showed that a custom header follows a 307 redirect to another origin; only `Authorization` is dropped. The adapter therefore skips plugin remote servers that declare `headers`, with a `server-unsupported` error. That error names the `mcp.servers` key a user can set to opt in explicitly. Remote servers without headers load. A proper fix needs a redirect policy in core's MCP client (a rung-3 seam) and its own approval.
- **Separators (risk 3).** Skill IDs and server names use `<plugin>:<name>`. The skill tool, `/api/skill`, code mode (`tools.demo_echo.plugin_env`) and MCP status all work with it (self-test).
- **Frontmatter keys (risk 5).** Unknown `SKILL.md` keys are ignored; the Agent Skills specification is silent on them.
- **Config.** `KiloConfigPolicy.agentPlugins(entries)` returns the merged settings. `fromEntries` keeps its shape, so existing consumers are unchanged. Each Kilo-only field now decodes on its own, so one malformed field no longer hides the other.
- **Core-internal import.** The adapter adds `@opencode/core/filesystem/watcher` (ratchet 27 to 28). No public plugin API watches files.
- **MCP timeouts.** The global `mcp.timeout` defaults from config apply to plugin servers, as they do to configured servers.
