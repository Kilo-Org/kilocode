# Auto packaging compile probe — 2026-09-05

Read-only verification probe for the routed Auto packaging question raised in review
(`import.meta.resolve("@opencode-ai/ai/kilocode/openrouter-routed")` under Bun `--compile`).
No repository source was modified; all artifacts live in an owned temp directory. This
document records measured facts only. It was produced by a verification delegate; the
parent thread owns any follow-up implementation and task state.

## Scope and provenance

- Runtime: bundled Bun **1.4.0** from `packages/kilo-cli/dist/interactive/bun` (system bun is
  1.3.14, below `src/runtime.ts`'s build gate; matches pinned `bun@1.4.0`). No installs, no
  network, no accounts.
- Compile flags copied from `packages/kilo-cli/script/build.ts:34-40` (`target: "bun"`,
  `minify`, `format: "esm"`, all `autoload*` disabled).
- Evidence directory (preserved): `/var/folders/pd/_rh0zzyx19ncnzldhjlt3mtc0000gp/T/kilo/vprobe`
  (`source-a/`, `entry-b.ts`, `entry-d.ts`, `build-probe*.ts`, `iso/probe-a..e`, `realbuild/`).
- Real-graph probes imported the working-tree `packages/kilo-cli/src/routed-model-plugin.ts`
  and `packages/core/src/provider.ts` by absolute path into a temp entry; no shared file was
  edited, renamed, or swapped.

## Measured matrix (source vs compiled, bun 1.4.0)

| Path (mirrors the real code shape) | Source mode | Compiled binary |
| --- | --- | --- |
| `import.meta.resolve("@opencode-ai/ai/kilocode/openrouter-routed")` (`routed-model-plugin.ts:23`, unguarded) | resolves to the checkout file URL | **throws** `Cannot find package '@opencode-ai/ai' imported from /$bunfs/root/...` |
| `Provider.loadPackage(fileURL)` → `import(fileURL)` (`provider.ts:80` + `import.bun.ts`) | works | unreachable; the resolve throws first |
| `loadPackage(bare "@opencode-ai/ai/...")` pass-through → `import(variable)` | works | **fails even when the module is embedded** elsewhere in the graph |
| Core builtins literal closure (`provider.ts:36-74`) | works | **works**; loads from `/$bunfs`, proven after deleting the probe source tree entirely |
| Direct-literal dynamic import in a Kilo-owned module | works | works (embedded) |

Commands and results (all under the evidence directory):

```console
$ bun run source-a/entry.ts                       # source mode: [1]-[4] all ok
$ bun run build-probe.ts && iso/probe-a           # error: Cannot find module '@probe/ai/...' from '/$bunfs/root/probe-a'
$ iso/probe-b                                     # [1] resolve threw; [3] bare → LoadError; [4] builtin openrouter → model(): function
$ rm -rf source-a node_modules && iso/probe-c     # [C2]/[C3] literal imports still work (embedded); [C1] bare variable import fails
$ bun run build-probe-d.ts && iso/probe-d         # [D1] routed bare specifier via build-injected builtin → model(): function
$ iso/probe-e                                     # negative control without injection → Provider.LoadError, exit 1
$ cd packages/kilo-cli && dist/interactive/bun run script/build.ts $T/realbuild   # builds; routed strings absent
```

## Current packaging state — the gap is latent

- The headless compiled `dist/kilo2` (rebuilt 2026-09-05 18:48 from this worktree) does **not
  contain the routed plugin at all**: `src/index.ts` → `host.ts` never reaches
  `interactive-server.ts` (only `daemon.ts`/`tui-preview.ts` import it). The bundle contains
  zero occurrences of `kilocode.routed-model`, `kilocode/openrouter-routed`, or
  `openai-compatible/kilo`; builtin provider strings are present.
- The interactive entry `dist/interactive/kilo2` is a shell-script **source-mode launcher**
  (runs `src/tui-preview.ts` from the checkout with the bundled bun). `import.meta.resolve`
  therefore works there, and all routed tests are source mode (`test/routed-model.test.ts:181`).
- Source-preview behavior is correct and verified; no shipped artifact currently exercises the
  routed path in compiled form, so the compile gap has no user-visible effect today.

## Not claimed

- No compiled end-to-end Auto flow (with or without a loopback fake Gateway) was run or is
  claimed: no compiled artifact contains the plugin, so such a run is only possible after a
  packaging seam lands. Mechanism evidence above is seam-level.
- No impossibility claim beyond tested paths: the table reflects measured behavior for bun
  1.4.0 with these flags; other Bun versions or loader APIs (`Bun.embeddedFiles` returned 0
  entries in 1.4.0) were not exhaustively explored.

## Candidate seam — not accepted

A build-time `onLoad` plugin in `packages/kilo-cli/script/build.ts` that injects
`["@opencode-ai/ai/kilocode/openrouter-routed", () => import("@opencode-ai/ai/kilocode/openrouter-routed")]`
into Core's builtins map text made the bare specifier load in a compiled binary (probe D), and
the negative control without injection failed with `Provider.LoadError`. This candidate is
**upstream-coupled and fragile** (keyed on a marker line in `packages/core/src/provider.ts`)
and was **rejected by the parent thread — not an approved extension**. It is recorded here as
measured evidence only. No Core rewrite, override, or shared patch was implemented, and the
measured source-mode behavior of the current implementation stands as delivered.
