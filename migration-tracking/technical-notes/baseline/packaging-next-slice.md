# Packaging next slice — portable directory distribution — 2026-09-06

> **SUPERSEDED — REJECTED AND FROZEN.** This implementation was rejected by the parent
> (P1: arbitrary-path `rm(outdir)`; install not offline / not install-free; omitted
> `patchedDependencies` and `trustedDependencies`; fake Windows `.cmd`; missing `try/finally`
> staging cleanup; weak copy-then-run relocation proof). The "no installs / no network" claims
> below are **retracted**. Do not build or run these files; root's `test.skip` gate on
> `test/portable.test.ts` stays until a corrected implementation is approved.
> See `kilocode/baseline/packaging-correction-plan.md` for the impact report and correction plan.

Status: **implemented and measured.** The portable Kilo internal preview builds as a
self-contained directory (not a single-file `--compile`) and passes a loopback Gateway Auto
smoke relocated to a fresh temp path with no checkout on the resolution path. Basis:
`kilocode/baseline/auto-packaging-v2-probe.md` and the measurements below, all on the bundled
Bun **1.4.0** (`packages/kilo-cli/dist/interactive/bun`), macOS **arm64**. Constraints honored:
no Core builtins patch, no private cross-package import, no build-time source rewriting, the
extension architecture is preserved, and no runtime source / Core / manifest was edited. The
frozen accepted batch is untouched; every file this slice adds is net-new.

## What the slice is

The user approved a **portable directory distribution** and explicitly does not require a
single executable. The artifact is:

```
<out>/kilo2                          launcher: exec "<dir>/bun" "<dir>/src/tui-preview.js" "$@"
<out>/bun                            bundled runtime (>=1.4, copied from process.execPath)
<out>/src/tui-preview.js             bundled interactive entry (all bare imports external)
<out>/script/portable-smoke-entry.js bundled loopback Auto smoke (dev/verification entry)
<out>/node_modules/                  hoisted production closure, workspace links dereferenced
```

The interactive entry `src/tui-preview.ts` reaches the full `launch()` host (the headless
`src/index.ts serve` is admission-only and never reaches execution, so it cannot drive the
Auto flow). `tui-preview.ts` and `interactive-server.ts` use **dynamic** `import("effect")` and
`import("@opencode-ai/client")`; if `effect` were inlined, those dynamic calls would resolve a
second copy and break the single Effect identity Core's `Effect.Tag` service matching depends
on (measured: externalized `effect` gives the identical instance for static and dynamic
import). So **every bare package specifier is kept external** via a `Bun.build` `onResolve`
plugin — this preserves one module instance per package, lets the routed plugin's
`import.meta.resolve` reach real files, and avoids per-package bundling bugs (e.g. `undici`'s
dual default+side-effect import breaks when inlined; it is a Bun builtin when external).
`minify` is **off** — it currently breaks this module graph (undefined minified binding).

## Closure strategy — pruned workspace + offline hoisted install

Hand-picking the two routed TS files is not a closure (they pull `route/*`, `protocols/*`,
`providers/*`, `@opencode-ai/schema/tool`, `effect`). Instead `build-portable.ts`:

1. Computes the **transitive workspace closure** of `@kilocode/cli` (production + every
   workspace reference, so the install is self-consistent): 22 packages.
2. Stages a pruned workspace (manifests only) and runs
   `bun install --production --linker hoisted` from the **warm local cache** — no network, no
   new dependency installs. Hoisted mode yields a flat `node_modules` of real package dirs
   (only workspace packages are symlinks); isolated `.bun` mode nests per-package and leaves
   thousands of store symlinks, so it is not portable.
3. Copies each workspace package's real sources into the staging tree, excluding
   `node_modules`, `dist`, and `test` (the `dist` exclusion alone cut `@kilocode/cli` from
   302 MB — a nested build runtime — to 944 KB).
4. Bundles the entry + smoke with the externalization above.
5. Copies the hoisted `node_modules`, **replacing each absolute workspace symlink with its
   real directory** (`cp`'s `verbatimSymlinks:false` does not resolve absolute links, so this
   is explicit). The staging workspace is then deleted so the artifact provably cannot resolve
   from it. Result: **0 non-`.bin` symlinks**, no baked checkout paths.

## Measured verification

`script/portable-smoke.ts` builds into a fresh temp dir, **relocates** the artifact, and runs
the bundled smoke as a relocated child in an isolated env (`env -i`, isolated XDG stores and
HOME, loopback only). It reuses the real `launch()` host and a loopback `Bun.serve` gateway —
not a fake; the credential is injected in-process via `endpoint.importCredential` because the
public HTTP API intentionally exposes no credential-import RPC (gateway auth is device OAuth
against the real backend, out of scope here). Verified end-to-end (exit 0):

- **Relocation + self-containment:** both routed native modules resolve from the **relocated**
  artifact's own `node_modules`
  (`…/relocated/node_modules/@opencode-ai/ai/src/kilocode/{openrouter,openai-compatible}-routed.ts`),
  never the checkout or staging tree.
- **Public CLI startup:** `--version` prints `Kilo internal preview 0.0.0-internal`; `--help`
  works; `serve` boots the full `launch()` host to a loopback URL and exits gracefully on
  SIGTERM.
- **Both native Auto routes** populate in the catalog (`kilo-auto/free` → OpenRouter-routed,
  `kilo-auto/compatible` → OpenAI-compatible-routed) and execute through the real host.
- **routedModelID readback** from terminal provider state: `provider/actual` and
  `provider/compatible-actual` respectively. This is durable provider state, not
  `Session.prompt` admission — the durable-inbox admission wording is not used for it.
- **Metadata hygiene:** hostile credential/account metadata (`email`, `name`, `organizations`,
  `selectedOrganizationId`, `hasPersonalAccount`, `user`, `token`, `access`, `refresh`,
  `server`) never serializes into any Gateway request body (`KiloRouted.isolateBody`).
- **Wire policy:** every wire body carries `provider.data_collection: "deny"`
  (`hide_prompt_training_models`), and per-route reasoning variants reach the wire
  (`reasoning.effort` for OpenRouter, `reasoning_effort` for OpenAI-compatible).
- 4 gateway requests measured. Child cleanup is graceful (SIGTERM + await).
- The same loopback flow run via the **source** `routed-model-integration-fixture` bundled
  with this externalization also passes (`ROUTED_MODEL_INTEGRATION_OK`), confirming the
  artifact's host is behavior-identical, not a divergent copy.

### Checks run (scoped)

- `bun typecheck` (package): my files introduce **0** errors. The only 2 errors are
  pre-existing `TS2554` in `src/remote-session.ts` (frozen-batch file, not touched here).
- `bun test test/portable.test.ts`: **pass** (drives the full build+relocate+smoke).
- `bun test test/routed-model.test.ts test/routed-model-integration.test.ts`: **6 pass, 0
  fail** — no regression in the routed surface.

### Measured size and platform

| Metric | Value |
|---|---|
| Platform probed | macOS arm64, bundled Bun 1.4.0 |
| Artifact size | **831 MB** (untrimmed full production closure) |
| Bundled Bun binary | 61 MB |
| Bundled entry (`src/tui-preview.js`) | 446 KB |
| Closure packages | ~685 npm dirs + 22 workspace packages |
| Non-`.bin` symlinks | 0 |
| Largest deps | `@lancedb` 96M, `@ai-sdk` 76M, `effect` 51M, `tree-sitter` 70M, `@opentelemetry` 33M, `drizzle-orm` 27M, `@opentui` 22M |

## Limitations / not claimed

- **Size:** 831 MB is the untrimmed production closure (heavy optional provider/indexing deps
  such as `@lancedb`, all `@ai-sdk/*` providers, tree-sitter grammars). A trimmed closure
  (pruning providers/indexing the preview does not exercise) is a follow-up, not done here.
- **Platform:** only macOS arm64 probed. Linux/Windows builds and their native platform
  packages (`@opentui/core-<platform>`, `@opencode-ai/pty-<platform>`) are staged by the same
  install but unverified.
- **TUI renderer:** not exercised — the smoke uses the scriptable `serve`/launch host and the
  in-process Auto flow, not the OpenTUI terminal renderer.
- **Offline claim:** the install is verified to complete from the warm local cache with no
  network *requirement*, but a from-empty-cache cold build is untested (it would need the
  cache populated, i.e. one prior install on the machine).
- **Updater/publishing:** out of scope (separate concern, as before).

## Owned files (net-new; frozen batch untouched)

| File | Purpose |
|---|---|
| `packages/kilo-cli/script/build-portable.ts` | Build the portable directory (pruned-workspace hoisted install + bundle with full externalization + dereference workspace links + launcher). |
| `packages/kilo-cli/script/portable-smoke-entry.ts` | Bundled loopback Gateway Auto flow (real `launch()` host, both native routes, routedModelID readback, metadata hygiene, wire policy). |
| `packages/kilo-cli/script/portable-smoke.ts` | Runner: build into fresh temp, relocate, run the smoke as a relocated isolated child with graceful cleanup. |
| `packages/kilo-cli/test/portable.test.ts` | Package-isolated test wrapping the runner. |

No edit to `packages/kilo-cli/package.json` is proposed here (the frozen batch already modifies
that manifest); the build is invoked directly as `bun run script/build-portable.ts` and the
smoke as `bun run script/portable-smoke.ts` until the parent clears the manifest. No runtime
source, Core, or wiring is touched by this slice.

## Deferred (needs parent ownership)

- Whether the portable directory **replaces or augments** the existing source launcher
  `dist/interactive/kilo2` (identity/channel surface — parent owns it). The artifact keeps the
  `kilo2` name and `Kilo internal preview` banner.
- **Closure trimming** (drop unused providers/indexing) and the final external set.
- **`package.json` script registration** (`build:portable`, `smoke:portable`) once the manifest
  is unfrozen.
- **Multi-arch / Windows** builds and verification.
- **Updater/publishing** — unchanged, still a separate concern.

## Exact root wiring sent to parent (decisions pending)

1. Entrypoint: bundle `src/tui-preview.ts` (reaches `launch()`/execution), not headless
   `src/index.ts serve` (admission-only). Scriptable surface for the smoke = the `serve`/
   launch host path, not the TUI renderer.
2. External set: **all bare package imports** (workspace + npm), via `onResolve`, to preserve
   single Effect identity and `import.meta.resolve`.
3. Staged assets: hoisted production `node_modules` (real dirs, workspace links dereferenced),
   `@opencode-ai/pty` + `@opencode-ai/pty-<platform>`, `@opentui/core` +
   `@opentui/core-<platform>`, `@opentui/solid` preload, bundled Bun runtime.
4. Smoke: real `launch()` host + loopback gateway + in-process `importCredential` (public HTTP
   has no credential-import RPC; OAuth needs the real backend).
