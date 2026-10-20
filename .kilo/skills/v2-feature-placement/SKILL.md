---
name: v2-feature-placement
description: Use before adding, porting or changing any Kilo behavior on the v2 line (branches v2, v2-*), including Gateway, tools, session, TUI and CLI work. Decides where one change goes (plugin hook, host composition, seam or patch), finds the upstream extension point, applies the shape and import rules, writes the done-proof for the progress map, and produces the PR placement statement.
---

# v2 feature placement

One change, one rung. Use the first rung that works, prove it with the checks below, and say in the PR which rung you used and why the lower ones do not work. The placement rules in `migration-tracking/plans/v2-host-strategy.md` section 5 are the source of truth; when this skill and that section disagree, the section wins. Rules: `migration-tracking/technical-notes/v2-fork-conventions.md`, section "Plugin-first extension order".

## Direction

Kilo is the host, OpenCode is a library. Code moves one way: from upstream files into Kilo-owned files (`packages/kilo-*`, `src/kilocode/`, `test/kilocode/`), never back. Do not propose adding or widening a `kilocode_change` line in an upstream file to remove or shrink a Kilo-owned file; a Kilo-owned mirror of an upstream file (the host entry, a replaced tool) is rung 2 and beats a seam. A patch adds to upstream, it never changes an upstream default: upstream's own test files must pass unchanged against the code without the host. If they do not, the Kilo value belongs in the host, behind a generic knob with upstream's default.

## Vocabulary

| Word | Meaning | Marker |
|---|---|---|
| Plugin hook (rung 1) | An extension point upstream exposes through `@opencode/plugin`; you attach from a Kilo-owned file | none |
| Host composition (rung 2) | Plugin registration, service replacement, environment translation or boot option in the Kilo host; a Kilo-owned mirror of an upstream file (host entry, replaced tool), registered in `mirroredFiles` | none |
| Seam (rung 3) | One to three generic lines you add to an upstream file so that a plugin hook becomes possible. Carries no Kilo value: no `kilocode/` path, `Kilo*` identifier or Kilo string literal | `kilocode_change(<feature>) seam` |
| Patch (rung 4) | A Kilo-specific line inside an upstream file, including a registration or import of a Kilo module. One line thick; behavior lives in a Kilo module | `kilocode_change(<feature>)` |

"Hook" alone means plugin hook. A Kilo edit in an upstream file is a patch, not a hook. The rung 3 and 4 distinction is mechanical: any Kilo reference in the marked lines makes it rung 4.

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

#### Add a Kilo RPC

A Kilo RPC is rung 1: the plugin API has an `rpc` domain (`packages/plugin/src/effect/rpc.ts`), and the server serves every registered RPC through one generic route, `rpc.call` (`POST /api/rpc/:rpcID/:method`, `packages/protocol/src/groups/rpc.ts`). The reference is the Gateway RPC, `kilocode.gateway` (U-E0-02).

1. Contract: `packages/schema/src/kilocode/<feature>.ts`, `Rpc.define({ id: "kilocode.<feature>", methods, events })` with `Rpc` from `../rpc.js`. Wrap each schema in `Schema.toStandardSchemaV1` so the promise client accepts it. Import only `effect` and Schema modules: `@opencode/schema` depends on no Kilo package (that needs a shared `package.json` patch, and the packed SDK check in `packages/sdk/script/verify-package.ts` fails).
2. Handlers: in the feature's plugin under `packages/kilo-plugin/src/<feature>/`, `yield* ctx.rpc.register(Definition, { ... }).pipe(Effect.orDie)`. A handler fails with `context.error("<name>", message)`, using an error name of the contract. List the plugin in `KiloPlugins`.
3. Clients (TUI, VS Code, JetBrains) import the contract from `@opencode/schema/kilocode/<feature>` and call `client.rpc(Definition).<method>(input, { location })`, never from Core or `kilo-plugin`.
4. Round trip: a test in `packages/kilo-cli/test/` boots the server with `KiloHost.overrides` and calls a method through the generated client, as `rpc.test.ts` does for the Gateway.
5. `bun run generate` in `packages/client` leaves no drift: plugin methods are not in the generated OpenAPI or SDK surface, only the generic `rpc.call`. The typed surface is the Schema contract.

```sh
git grep -n -E "Rpc\.define|\.register\([A-Za-z]+\.Definition" -- packages/kilo-plugin/src packages/schema/src/kilocode   # existing Kilo RPCs and their handlers
bun test test/rpc.test.ts      # from packages/kilo-cli: the round trip through the generated client
bun run check:generated        # from packages/client: generate, then fail on drift
```

### 3. Rung 2: look for a service node or boot option

```sh
rg -n "export const node = " packages/core/src/<area>* packages/util/src packages/server/src   # LayerNode services the host can replace with X.node.replace(X.layerWith(...)) or X.configured(...); <area>* also finds <area>.ts
rg -n "process\.env\.OPENCODE_" packages/cli/src packages/core/src/<area>* packages/util/src packages/server/src   # environment the host translates from KILO_*
```

The host is `packages/kilo-cli` (U-E0-01). `bun dev` starts it, and every server the CLI starts runs its `serve` handler with the overrides. Where each kind of change goes:

- Server plugin: add it to `KiloPlugins` in `packages/kilo-plugin/src/index.ts`. `packages/kilo-cli/src/host.ts` registers each one through `SdkPlugins.register` and provides the global services a plugin requires (today `Bus`); a plugin that needs another global service adds it there, with the node in the registration node's `deps`. Never add a Kilo plugin to `core/src/plugin/internal.ts` or `provider.ts`.
- Service replacement: add `X.node.replace(...)` to `overrides` in `packages/kilo-cli/src/host.ts`. `createRoutes` applies the overrides after its standard set, so they win.
- Environment: add the name to `names` in `packages/kilo-cli/src/env.ts` (`KILO_<NAME>` becomes `OPENCODE_<NAME>`). Never add a name whose OPENCODE_ form means something else upstream (`KILO_API_KEY` is not `OPENCODE_API_KEY`).
- TUI plugin: the TUI's built-in list is in the TUI process, which the host does not reach. Register it with one marked line in `packages/tui/src/plugin/builtins.ts` (a rung-4 call-out, as `KiloTeams`).
- A change to the host entry itself: `packages/kilo-cli/src/index.ts` and `serve.ts` mirror upstream files; keep the differences marked `Kilo:` and few. A mirror is rung 2 and stays a mirror: never replace it with a seam in the upstream file it mirrors. Register it in `mirroredFiles` (`script/upstream/utils/config.ts` once it exists; until then, name it in the PR).

### 4. Rung 3: design a seam

Only when steps 2 and 3 found nothing. A seam is the knob or dispatch point upstream forgot. Rules:

- Generic: an optional setting, an exported value, a pass-through parameter, a call to a registered list. Any plugin could use it.
- No Kilo constant, condition or import in the marked lines. Kilo's value is set from `kilo-plugin` or the host.
- One to three lines. Prefer files that change rarely. Do not reformat or restructure around it.
- Each line: `// kilocode_change(<feature>) seam - <what the knob is>`. For more than one line, use a block: `// kilocode_change start - <feature> seam: <what the knob is>` ... `// kilocode_change end`. Never `kilocode_change(<feature>) start`: the counters recognize a block only when `start` or `end` follows `kilocode_change` directly, and that form breaks the count.
- Add the file to `script/upstream/shared-patches.json` with `rung: 3` and a `seam` text that names the missing knob and why rungs 1 and 2 cannot supply it. Raise `limits` only in the same PR.

### 5. Rung 4: write a patch

Only when a seam makes no sense (a defect fix, or a Kilo-specific decision no knob can express).

- One line thick. If the behavior is more than a fix, the line calls into a Kilo-owned module (`if (yield* KiloPolicy.x(...)) ...`) and the policy lives there. Never write policy inline in an upstream file.
- `// kilocode_change(<feature>) - <reason>`, or `kilocode_change(<feature>:<id>)` when it replaces a v1 patch cell. If a fix truly needs more than one line, use the block form from step 4 (`kilocode_change start - <feature>: <reason>` ... `kilocode_change end`) and put any `<feature>:<id>` proof on one of its lines.
- `shared-patches.json` entry with `rung: 4` and the reason rungs 1 to 3 do not work. The PR repeats the reason.
- A patch adds, it never changes an upstream default. Run the upstream test files of the module you touched, byte-identical from the pin, against the code without the host: they must pass. Never edit an upstream test file to make a Kilo change pass; put the Kilo behavior test under `test/kilocode/` and compose the host's values there.

### Rejected moves

These come up again and again and are refused on sight:

- A seam or patch in an upstream file whose purpose is to remove or shrink a Kilo-owned file (for example a `run(options)` export in `cli/src/index.ts` to delete the host entry mirror). Wrong direction.
- Editing an upstream test file so that it passes with a Kilo value. The value belongs in the host.
- Relabelling a rung in `shared-patches.json` instead of changing the placement. A label fix is allowed only when the code is already correct and the label was wrong.
- Borrowing a shape from the archived port (tag `kilo-v2-checkpoints-2026-09`) without checking it against v1 behavior and against the current upstream seams. The port provides mechanism only.

### 6. Imports

- A logic package (`packages/kilo-*-core`) imports nothing from `@opencode/*` (static, export-from or dynamic import).
- An adapter or plugin imports `@opencode/plugin`, `@opencode/schema`, `@opencode/client` and `@opencode/util` freely. It imports core internals (`@opencode/core/*`, relative `../` into `packages/core/src`) only when no public surface has it; name each one in the PR. The number must not grow without a reason.
- Check both: `bun script/upstream/placement.ts --imports`. It fails on a logic package import (CI runs it) and prints the distinct core-internal modules per adapter (Kilo-owned modules, such as `core/src/kilocode/config/*` or the RPC contracts in `schema/src/kilocode/`, do not count). The progress map carries the same count as a ratchet (`coreImports` in `migration-tracking/progress/progress.json`), also fails on a logic package import, and the PR comment names new core-internal imports.

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

Plus: shared files touched with rung, core-internal imports added and mirrored files. When the PR changes the map, add the section `## Progress map` from the `v2-migration` skill (section "Evidence"): the box before and after, and one short line per cell or group on why it is done, why it is dropped, or why it stays open. Self-test per `v2-migration` skill; the user should not need to test for you.

## Decision in one table

| You need to | Rung | Where |
|---|---|---|
| react to or change a tool call, a session request, compaction, a permission, a command, a provider or model | 1 | `kilo-plugin`, domain hook or editor |
| add, wrap or replace a builtin tool | 1 | `ToolEditor.update` or `remove` + `add` |
| add a Kilo RPC for clients | 1 | contract in `schema/src/kilocode/<feature>.ts`, `ctx.rpc.register` in `kilo-plugin` |
| register a plugin, replace a service, set paths, translate env, change a boot option | 2 | `KiloPlugins` in `packages/kilo-plugin`, `overrides` in `packages/kilo-cli/src/host.ts`, `names` in `env.ts` |
| change the host entry, or re-implement an upstream file | 2 | the mirror in `packages/kilo-cli`, differences marked `Kilo:`, listed in `mirroredFiles`; never a seam in the mirrored file |
| register a TUI plugin | 4 | one marked call-out line in `tui/src/plugin/builtins.ts` |
| a knob upstream does not expose yet | 3 | seam, generic, tagged, `shared-patches.json` |
| a defect fix or a Kilo decision inside upstream logic with no knob | 4 | one tagged line, policy in a Kilo module |
| product strings, names, logos | 5 | rename script during sync, never by hand |
