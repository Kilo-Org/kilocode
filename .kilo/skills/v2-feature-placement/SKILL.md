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

The open cells are what v1 had: modules, API operations, patch cells with their v1 source line, tests. Each patch cell has an ID you will carry into the v2 code. If the feature has no box, add it to `migration-tracking/progress/features.json` first.

### 2. Rung 1: look for a plugin hook

Do this before assuming the hook is missing. Upstream implements many of its own features as plugins on the same API.

```sh
ls packages/plugin/src/effect/                       # domains: agent, provider, model, aisdk, session, event, tool, permission, command, skill, mcp, rpc, storage, worktree, shell, vcs, websearch, integration, reference
rg -n "readonly \"?[a-z.]+\"?: " packages/plugin/src/effect/<domain>.ts      # hook names and editor methods
rg -n "define\(" packages/core/src/**/plugin/*.ts packages/core/src/plugin/*.ts  # upstream features that are themselves plugins; what they can do, you can do
```

Signals that rung 1 applies:

- The domain has a hook with a mutable field you need (`tool.hook("execute.before")` has mutable `tool` and `input` and may fail with `Tool.Error`; `session.compaction` can set `result`).
- The domain has an editor with `add`, `update`, `remove`, `configure` or `transform` covering the thing you change (`ToolEditor.update("grep", tool => ...)` can change parameters, description and `execute` of a builtin tool).
- Upstream's own version of the behavior is a plugin (for example `core/src/config/plugin/compaction.ts` calls `SessionCompaction.Service.transform`): a Kilo plugin can call the same service.

Write the plugin in `packages/kilo-plugin/src/<feature>.ts` (or the feature's own `packages/kilo-*` package), export it from the plugin index. Builtin tools: wrap with `editor.update` when you add parameters, output or policy; replace with `editor.remove` plus `editor.add` when you change the algorithm or the tool is a different product, and list the replaced upstream file as a mirror (`mirroredFiles` in `script/upstream/utils/config.ts` once it exists; until then, name it in the PR).

### 3. Rung 2: look for a service node or boot option

```sh
rg -n "export const node = " packages/core/src/<area> packages/util/src packages/server/src   # LayerNode services the host can replace with X.node.replace(X.layerWith(...)) or X.configured(...)
rg -n "process.env.OPENCODE_" packages/cli/src packages/core/src/<area>                         # environment the host translates from KILO_*
```

If the host (`packages/kilo-cli`, unit U-E0-01, #15172) exists, put the replacement or registration there. If it does not exist yet, register the plugin with one marked line in the upstream builtin list (`core/src/plugin/internal.ts`, `core/src/plugin/provider.ts` or `tui/src/plugin/builtins.ts`) and write in the PR that the line moves to the host.

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

- A logic package (`packages/kilo-*-core`) imports nothing from `@opencode/*`. Check: `rg -c "from \"@opencode" packages/kilo-<name>-core/src` must print nothing.
- An adapter or plugin imports `@opencode/plugin`, `@opencode/schema`, `@opencode/client` and `@opencode/util` freely. It imports core internals (`@opencode/core/*`, relative `../` into `packages/core/src`) only when no public surface has it; name each one in the PR. Count: `rg -oh --no-filename 'from "(@opencode/core/[^"]+|\.\./[^"]+)"' <adapter dir> | sort -u | wc -l`. The number must not grow without a reason.

### 7. Done-proof for the progress map

Every v1 patch cell you replace gets its ID on the v2 code:

- In a shared upstream file (rung 3 or 4): `// kilocode_change(<feature>:<id>)`.
- In a Kilo-owned file (rung 1 or 2): `// kilo_port(<feature>:<id>)` on the code that now provides the behavior. (Until the generator recognises `kilo_port`, also add the cell to `dispositions.json` with `state: "ported"`, the v2 path in `note`, and `by`.)
- Behavior v2 already provides: `dispositions.json`, `state: "native"`, with the v2 pointer. Behavior not carried: `state: "dropped"`, with the reason.

Then regenerate and verify:

```sh
bun script/upstream/progress.ts && bun script/upstream/progress.ts --check
bun script/check-shared-patches.ts && bun script/check-opencode-annotations.ts
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

Plus: shared files touched with rung, core-internal imports added, mirrored files, and the progress map delta (cells closed per feature, dispositions added with reasons). Self-test per `v2-migration` skill; the user should not need to test for you.

## Decision in one table

| You need to | Rung | Where |
|---|---|---|
| react to or change a tool call, a session request, compaction, a permission, a command, a provider or model | 1 | `kilo-plugin`, domain hook or editor |
| add, wrap or replace a builtin tool | 1 | `ToolEditor.update` or `remove` + `add` |
| register a plugin, replace a service, set paths, translate env, change a boot option | 2 | `packages/kilo-cli` host |
| a knob upstream does not expose yet | 3 | seam, generic, tagged, `shared-patches.json` |
| a defect fix or a Kilo decision inside upstream logic with no knob | 4 | one tagged line, policy in a Kilo module |
| product strings, names, logos | 5 | rename script during sync, never by hand |
