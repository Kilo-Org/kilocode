---
name: v2-feature-placement
description: Use before adding, porting or changing any Kilo behavior on the v2 line (branches v2, v2-*), including Gateway, tools, session, TUI and CLI work. Decides where one change goes (plugin hook, host composition, seam or patch), finds the upstream extension point, applies the shape and import rules, writes the done-proof for the progress map, and produces the PR placement statement.
---

# v2 feature placement

One change, one rung. Use the first rung that works, prove it with the checks below, and say in the PR which rung you used and why the lower ones do not work. Strategy and reasoning: `migration-tracking/plans/v2-host-strategy.md`. Rules: `migration-tracking/technical-notes/v2-fork-conventions.md`, section "Plugin-first extension order".

## Vocabulary

| Word | Meaning | Marker |
|---|---|---|
| Plugin hook (rung 1) | An extension point upstream exposes through `@opencode/plugin`; you attach from a Kilo-owned file | none |
| Host composition (rung 2) | Plugin registration, service replacement, environment translation or boot option in the Kilo host | none |
| Seam (rung 3) | One to three generic lines you add to an upstream file so that a plugin hook becomes possible. Carries no Kilo value | `kilocode_change(<feature>) seam` |
| Patch (rung 4) | A Kilo-specific line inside an upstream file. One line thick; behavior lives in a Kilo module | `kilocode_change(<feature>)` |

"Hook" alone means plugin hook. A Kilo edit in an upstream file is a patch, not a hook.

## Procedure

### 1. Name the feature and its v1 inventory

```sh
bun script/upstream/progress.ts --list <feature>
```

The open cells are what v1 had: modules, API operations, patch cells with their v1 source line (listed as `hook:<feature>:<id>`), tests. Each patch cell has an ID you will carry into the v2 code. If the feature has no box, add it to `migration-tracking/progress/features.json` first.

Then run the placement finder on the upstream module you would change. It prints, with no model and no network, the plugin domains and hooks that match the module, the upstream plugins that are or extend it, its service nodes, the environment it reads, existing seams in `shared-patches.json`, its `kilocode_change` markers, whether the path is Kilo-owned, and a suggested first rung. Steps 2 to 4 explain its sections and the manual commands behind them.

```sh
bun script/upstream/placement.ts packages/core/src/session/compaction.ts   # or a module: @opencode/core/session/compaction; --json for scripts
```

### 2. Rung 1: look for a plugin hook

Do this before assuming the hook is missing. Upstream implements many of its own features as plugins on the same API.

```sh
ls packages/plugin/src/effect/                       # domains: agent, provider, model, aisdk, session, event, tool, permission, command, skill, mcp, rpc, storage, worktree, shell, vcs, websearch, integration, reference (index.ts, plugin.ts, registration.ts are not domains)
rg -n "^export (interface|type) \w+(Hooks|Editor|Domain)\b" -A 30 packages/plugin/src/effect/<domain>.ts   # hooks, editor methods and domain members
rg -n --glob '**/plugin/**' 'id: "opencode\.' packages/core/src   # every upstream plugin (tool plugins have no define call); what they can do, you can do
```

Signals that rung 1 applies:

- The domain has a hook with a mutable field you need (`tool.hook("execute.before")` has mutable `tool` and `input` and may fail with `Tool.Error`; `session.compaction` can set `result`).
- The domain has an editor with `add`, `update`, `remove`, `configure` or `transform` covering the thing you change (`ToolEditor.update("grep", tool => ...)` can change parameters, description and `execute` of a builtin tool).
- Upstream's own version of the behavior is a plugin (for example `core/src/config/plugin/compaction.ts` calls `SessionCompaction.Service.transform`): a Kilo plugin can call the same service. Limit: the host gives a registered plugin only global services (for example `Bus`). A Location service (`SessionCompaction.Service`, `Config.Service`; the finder prints the node kind) needs one rung-3 seam in `core/src/plugin/supervisor.ts` first.

Write the plugin in `packages/kilo-plugin/src/<feature>.ts` (or the feature's own `packages/kilo-*` package) and add it to `KiloPlugins` in `packages/kilo-plugin/src/index.ts`; the host registers it (step 3). Builtin tools: wrap with `editor.update` when you add parameters, output or policy; replace with `editor.remove` plus `editor.add` when you change the algorithm or the tool is a different product, and list the replaced upstream file as a mirror (`mirroredFiles` in `script/upstream/utils/config.ts` once it exists; until then, name it in the PR).

### 3. Rung 2: look for a service node or boot option

```sh
rg -n "export const node = " packages/core/src/<area>* packages/util/src packages/server/src   # LayerNode services the host can replace with X.node.replace(X.layerWith(...)) or X.configured(...); <area>* also finds <area>.ts
rg -n "process\.env\.OPENCODE_" packages/cli/src packages/core/src/<area>* packages/util/src packages/server/src   # environment the host translates from KILO_*
```

The host is `packages/kilo-cli` (U-E0-01). `bun dev` starts it, and every server the CLI starts runs its `serve` handler with the overrides. Where each kind of change goes:

- Server plugin: add it to `KiloPlugins` in `packages/kilo-plugin/src/index.ts`. `packages/kilo-cli/src/host.ts` registers each one through `SdkPlugins.register` and provides the global services a plugin requires (today `Bus`); a plugin that needs another global service adds it there, with the node in the registration node's `deps`. Never add a Kilo plugin to `core/src/plugin/internal.ts` or `provider.ts`.
- Service replacement: add `X.node.replace(...)` to `overrides` in `packages/kilo-cli/src/host.ts`. `createRoutes` applies the overrides after its standard set, so they win.
- Environment: add the name to `names` in `packages/kilo-cli/src/env.ts` (`KILO_<NAME>` becomes `OPENCODE_<NAME>`). Never add a name whose OPENCODE_ form means something else upstream (`KILO_API_KEY` is not `OPENCODE_API_KEY`).
- TUI plugin: the TUI's built-in list is in the TUI process, which the host does not reach. Register it with one marked line in `packages/tui/src/plugin/builtins.ts` (rung 3, as `KiloTeams`).
- A change to the host entry itself: `packages/kilo-cli/src/index.ts` and `serve.ts` mirror upstream files; keep the differences marked `Kilo:` and few.

### 4. Rung 3: design a seam

Only when steps 2 and 3 found nothing. A seam is the knob or dispatch point upstream forgot. Rules:

- Generic: an optional setting, an exported value, a pass-through parameter, a call to a registered list. Any plugin could use it.
- No Kilo constant, condition or import in the marked lines. Kilo's value is set from `kilo-plugin` or the host.
- One to three lines. Prefer files that change rarely. Do not reformat or restructure around it.
- Each line: `// kilocode_change(<feature>) seam - <what the knob is>`.
- Add the file to `script/upstream/shared-patches.json` with `rung: 3` and a `seam` text that names the missing knob and why rungs 1 and 2 cannot supply it. Raise `limits` only in the same PR.

### 5. Rung 4: write a patch

Only when a seam makes no sense (a defect fix, or a Kilo-specific decision no knob can express).

- One line thick. If the behavior is more than a fix, the line calls into a Kilo-owned module (`if (yield* KiloPolicy.x(...)) ...`) and the policy lives there. Never write policy inline in an upstream file.
- `// kilocode_change(<feature>) - <reason>`, or `kilocode_change(<feature>:<id>)` when it replaces a v1 patch cell.
- `shared-patches.json` entry with `rung: 4` and the reason rungs 1 to 3 do not work. The PR repeats the reason.

### 6. Imports

- A logic package (`packages/kilo-*-core`) imports nothing from `@opencode/*` (static, export-from or dynamic import).
- An adapter or plugin imports `@opencode/plugin`, `@opencode/schema`, `@opencode/client` and `@opencode/util` freely. It imports core internals (`@opencode/core/*`, relative `../` into `packages/core/src`) only when no public surface has it; name each one in the PR. The number must not grow without a reason.
- Check both: `bun script/upstream/placement.ts --imports`. It fails on a logic package import (CI runs it) and prints the distinct core-internal modules per adapter (Kilo-owned modules inside core, such as `core/src/kilocode/gateway-rpc.ts`, do not count). The progress map carries the same count as a ratchet (`coreImports` in `migration-tracking/progress/progress.json`), also fails on a logic package import, and the PR comment names new core-internal imports.

### 7. Done-proof for the progress map

Every v1 cell you replace gets a proof in the same PR:

- In a shared upstream file (rung 3 or 4): `// kilocode_change(<feature>:<id>)`.
- In a Kilo-owned file (rung 1 or 2): `// kilo_port(<feature>:<id>)` on the code that now provides the behavior, also when that code only selects or configures upstream behavior, and on the Kilo-owned v2 test that replaces a v1 test patch cell.
- A Kilo-owned module or test ported under another name: the v1 file name when it fits, else `state: "ported"` in `dispositions.json` with the v2 path.
- Behavior upstream v2 provides with no Kilo code: `state: "native"`, with the v2 pointer. Behavior not carried (a shim, dead v1 code, or a decision the plan records): `state: "dropped"`, with the evidence. Behavior that a later unit ports stays open.

Close a cell only after you compared the v1 hunk with the v2 code behavior by behavior; a cell with a known gap stays open, with the gap in the PR. The full rules are in the `v2-migration` skill, section "Progress map".

Then regenerate and verify:

```sh
git add <new files>   # the map counts only tracked files
bun script/upstream/progress.ts && bun script/upstream/progress.ts && bun script/upstream/progress.ts --check   # identical output, then check
bun script/upstream/progress.ts --list <feature>   # each open cell needs a reason in the PR
bun script/check-shared-patches.ts --worktree && bun script/check-opencode-annotations.ts --worktree   # before the commit; CI runs both without --worktree on the commit
bun typecheck      # from the affected package directory, never tsc
```

### 8. PR placement statement

Add a section `## Placement` to the PR body:

```
| Change | Rung | Why not lower | Proof |
|---|---|---|---|
| sandbox guard on bash | 1 | n/a | kilo-plugin/src/sandbox-guard.ts, kilo_port(sandbox:1a2b3c4d5e6f) |
| compaction toolOutput setting | 3 | no editor field, no hook reaches the transcript | core/src/session/compaction.ts, 3 lines, shared-patches.json |
```

Plus: shared files touched with rung, core-internal imports added, mirrored files, and the progress map delta (the feature box before and after, dispositions added with reasons, open cells with reasons). Self-test per `v2-migration` skill; the user should not need to test for you.

## Decision in one table

| You need to | Rung | Where |
|---|---|---|
| react to or change a tool call, a session request, compaction, a permission, a command, a provider or model | 1 | `kilo-plugin`, domain hook or editor |
| add, wrap or replace a builtin tool | 1 | `ToolEditor.update` or `remove` + `add` |
| register a plugin, replace a service, set paths, translate env, change a boot option | 2 | `KiloPlugins` in `packages/kilo-plugin`, `overrides` in `packages/kilo-cli/src/host.ts`, `names` in `env.ts` |
| register a TUI plugin | 3 | one marked line in `tui/src/plugin/builtins.ts` |
| a knob upstream does not expose yet | 3 | seam, generic, tagged, `shared-patches.json` |
| a defect fix or a Kilo decision inside upstream logic with no knob | 4 | one tagged line, policy in a Kilo module |
| product strings, names, logos | 5 | rename script during sync, never by hand |
