# Packaging correction — as-built + measured — 2026-09-06

Status: **corrected implementation approved by the parent and built/measured.** Root's
`test.skip` review gate on `test/portable.test.ts` is **preserved** (the loopback smoke test
stays skipped until independent review; a new non-skipped safety regression test runs in the
default suite). No task transition. This document supersedes the rejected implementation in
`packaging-next-slice.md`; the impact report and retraction below are retained for the record.

## Corrected design (as built)

`script/build-portable.ts` produces the portable directory with a **no-install closure**: it
never runs `bun install`, never spawns a subprocess, never touches the registry/cache, and
never deletes its output.

1. **No-install closure from the existing resolved graph.** `createRequire`-free resolution:
   `resolvePackageDir(name, fromDir)` walks Node's `node_modules` chain on the filesystem
   (symlinks + nesting), bounded at the repo root, so it does not depend on
   `require.resolve("<name>/package.json")` (package exports may hide that subpath). It
   realpaths each package to the repo's already-patched, already-built real dir. Traversal
   covers `dependencies` + `optionalDependencies` + present `peerDependencies`, recursively
   from `@kilocode/cli`'s production graph plus the `@opencode-ai/pty` runtime asset; missing
   optional/peer deps are skipped, missing required deps fail the build. **Patches and trusted
   postinstall artifacts are preserved by construction** (the repo's resolved dirs already
   carry them); there is no second resolution to drop them.
2. **Internal-store layout with relative links (real conflicts).** The AWS SDK / Smithy
   closure genuinely carries duplicate patch versions (`@smithy/core` 3.31.1/3.33.2/3.33.3, and
   `@aws-sdk/*` pairs), so a flat `node_modules` cannot hold the graph. Instead of invented npm
   conflict-nesting (which can duplicate module instances and create cycles), each realpath is
   copied **once** into `node_modules/.store/<id>` (the `.bun` store id, or the package name
   for workspace/root-installed packages). Every dependency edge becomes an artifact-INTERNAL
   **relative** symlink at `.store/<dependent>/node_modules/<dep>`; every CLI direct dep and
   every unambiguous name gets a top-level `node_modules/<name>` link. A final escape check
   fails the build if any symlink resolves outside the artifact.
3. **Output safety.** Windows is rejected up front (the launcher is sh; no fake `.cmd`). The
   output dir is created with **exclusive `mkdir`** — an existing path fails `EEXIST` and is
   left untouched (permission errors propagate, never read as absent); no `rm` of output. With
   no `argv[2]`, an owned `mkdtemp` is used.
4. **Relocation proof.** `script/portable-smoke.ts` builds into an owned temp `build`, then
   **`rename`s** it to `relocated` (the original no longer exists), runs the bundled smoke as a
   relocated child in a scrubbed env, and asserts (canonicalized, macOS `/var`→`/private/var`)
   that both routed-module `file://` URLs resolve **inside** the relocated root. `try/finally`
   removes only the owned temp root; the child is SIGTERMed and awaited.
5. **Safety regression test** (`test/portable.test.ts`, non-skipped): an existing output
   directory with a sentinel file is refused, the sentinel is unchanged, and the bundled
   runtime (an inherited path) is not deleted. Root's skipped loopback smoke test is preserved
   verbatim below it.

## Measured (bundled bun 1.4.0, macOS arm64)

| Check | Result |
|---|---|
| `bun run script/portable-smoke.ts` (bounded temp-only) | **PASS** — `KILO_PORTABLE_SMOKE_RUNNER_OK`; one build + one move, then Auto + TUI + persistentPTY + Launcher + sessionPTY children sequentially in separate isolated homes. Auto: both routed native modules resolve inside the relocated `.store`; `kilo-auto/free` + `kilo-auto/compatible` execute via the real `launch()` host + loopback gateway; `routedModelID` = `provider/actual` + `provider/compatible-actual`; credential/account metadata never in any wire body; every body `data_collection: deny`; 4 requests. TUI: the shipped TUI mounts via `createTestRenderer`, its `client.connection` reaches and **stays `connected` past the 5s grace** (no "Connection lost" overlay), the `kilo.preview` KiloLogo ASCII + home.footer render, narrow/wide resize holds, a loopback-model **prompt/reply round-trip** renders through the mounted connection, and `/exit` cleanly destroys the renderer. persistentPTY (daemon): `binaryPath` from `@opencode-ai/pty` resolves to the artifact-CONTAINED `.store/@opencode-ai+pty-darwin-arm64/bin/opencode-pty`, a REAL native PTY spawns via `experimental.persistentPty.create`, output (`PTY_MARKER_artifact-ok`) via the terminal websocket attach, guaranteed finally cleanup + actual process-death proof (terminal child pid dead via kill -0, artifact daemon dead via pgrep scoped to the artifact binary, incl. a deterministic induced failure; never signals unrelated processes). Launcher: the actual relocated `kilo2` binary boots the host via `kilo2 serve` (not in-process launch), prints `URL:` + `Password file:`, answers `/api/health` 200, then SIGTERM graceful stop with no orphan. sessionPTY (@lydell/node-pty, the public `pty` API — DISTINCT from the daemon): an interactive-shell PTY is created via `pty.create`, driven through the public terminal websocket attach (echo `SESSION_MARKER_artifact-ok`, then `pty.update` resize verified on the native PTY via `stty size` → `40 100`, since `Info.size` is optional and not reported by `pty.get`), removed via `pty.remove`, and the child pid proven dead (incl. induced-failure cleanup). Graceful SIGTERM cleanup; original build path gone before run. |
| `bun test test/portable.test.ts` | **1 pass, 1 skip** — safety regression passes; root's smoke test stays skipped (gate preserved). |
| `bun test test/routed-model.test.ts test/routed-model-integration.test.ts` | **6 pass, 0 fail** — no regression. |
| `bun typecheck` (package) | My files add **0** errors. The 2 `TS2554` in `src/remote-session.ts` are **concurrent** (per parent), not baseline and not introduced here. |
| Source scan | Builder has **no** `Bun.spawn`/`exec`/`child_process`/`bun install`/`rm` (only a comment string); output via exclusive `mkdir`. |

**Artifact:** 837 MB (untrimmed full production closure, no provider/indexing pruning); 801
unique package realpaths copied once; 783 `.store` entries (name-hash dedupe); 385 top-level
links + 2575 total internal relative links; **0 broken links / 0 external escapes**; launcher
`--version` prints `Kilo internal preview 0.0.0-internal` in an isolated env. Platform: macOS
arm64, bundled bun 1.4.0 only.

**Limitations / not claimed:** closure is the full production runtime graph (no feature
pruning), untrimmed for size; macOS arm64 only; the TUI is proven headlessly (mount, connected
past grace, plugin render, narrow/wide, loopback prompt/reply, clean exit) — the full
conversational UI with a real Kilo account/backend is a later scenario, not claimed here; the
in-process Auto flow is proven, not a public-API credential path (the HTTP API intentionally
has no credential-import RPC). The **persistent-PTY daemon path** (`@opencode-ai/pty` →
`.store` `opencode-pty` binary) and the **session-terminal PTY path** (`@lydell/node-pty`,
`core/src/pty.ts`, the public `pty` API) are both proven (native bindings resolve inside the
artifact, real PTYs spawn, output/input via the terminal websocket attach, resize on the
native PTY, guaranteed cleanup + actual process-death proof); the `kilo2` launcher is proven at
`serve` host-boot (URL + `/api/health` readiness + graceful stop), not a full interactive
terminal session. Updater/publishing still separate; multi-platform builds unverified (macOS
arm64 only).

## TUI render + connection (Luna P1/P2, resolved)

These were the second round of findings; the design and root cause are recorded here because
the connection defect's root cause is non-obvious and was initially misdiagnosed.

**P1 (TUI raw `.tsx` + no preload).** `@opencode-ai/tui` ships raw `.tsx` via package exports;
externalized it would sit under `node_modules/.store`, where the Solid runtime transform's
`sourceFilter` (which excludes `/node_modules/`) never transforms it, and the launcher had no
`--preload`. Fixed by **bundling** `@opencode-ai/tui` (and its relative `.tsx` graph) into the
entry with the supported `createSolidTransformPlugin` (`@opentui/solid/bun-plugin`), so the JSX
compiles to `createComponent`/`jsx` calls at build time (no runtime preload, no upstream
edits). The `kilo.preview` plugin is bundled the same way to `src/tui-plugin/tui.js` (and
`script/tui-plugin/`, because `tui.ts`'s frozen `import.meta.dir+"/tui-plugin"` resolves to
each bundled entry's own output dir).

**P2 (the real connection defect — initial misdiagnosis retracted).** An earlier draft called
the rendered "Connection lost…" overlay a false alarm from a wrapping footer predicate. **That
was wrong.** Per `app.tsx:1268-1284`, `client.connection.status()==="connected"` clears the
reconnect timer and hides the overlay — so the overlay rendering past the 5s grace means the
**mounted** TUI's own `client.connection` was genuinely NOT connected (separate raw-GET/client
probes on the same host are NOT the mounted connection and do not prove it). A bounded
mounted-TUI diagnostic (env-gated `KILO_PORTABLE_TUI_DIAG=1` entry, not shipped) confirmed:
public-client `model.list` on the same host works (host healthy), yet at t≈7s the overlay is
showing and a prompt round-trip returns no reply — while a replication of `connection.ts`'s
exact `connect()` against the same host succeeds.

**Root cause (exact module graph).** Two `solid-js` instances in the artifact. The TUI render
tree uses the **bundled** `solid-js` (client build, via the solid transform's
`server.js→solid.js` `onLoad`). But `@opencode-ai/client` was **external**, and its
`@opencode-ai/client/solid` subpath (`client/src/solid/connection.ts`, `data.ts`) imports
`solid-js`, resolving **externally** to `.store/solid-js@1.9.15` — which under Bun's `node`
condition loads `dist/server.js` (the non-hydrating **server** build). So
`createClientConnection`'s `onMount`/`createStore`/`onCleanup` came from a **different**
solid-js instance (external server build) than the TUI's component tree (bundled client
build); `onMount` never fired in the TUI's render root, `start()` never ran, and the
connection stayed `connecting` forever. This is the "bundle/external duplication can break
services" concern applied to `solid-js` (triggered by bundling `solid-js` to fix an earlier
`getContextId` non-hydrating error in the TUI's own render).

**Fix (parent-approved, narrow).** Bundle the `@opencode-ai/client/solid` reactive subgraph
**with the TUI** so its connection/store/onMount use the SAME bundled solid-js instance as the
TUI render tree. The rest of `@opencode-ai/client` (`promise`, `effect/service`) is
nonreactive / Effect-facing and stays external, so the host Effect runtime and nonreactive
client behavior are untouched; `client/promise` (pulled in by `client/solid`) imports no
`solid-js` and no `effect`, so bundling it with the subgraph breaks neither identity. No
upstream/package-store edits. (Re-unifying external solid-js on the client build instead was
considered and rejected: it would rewrite installed-package semantics and does not unify
bundled+external identity.) The other render-tree reactive consumers are `@opencode-ai/tui`
and `@opentui/solid`, both already bundled, so they share the same bundled solid-js.

## Retained record: findings, impact report, and retraction

## 1. Root-cause findings (accepted) (accepted)

| # | Finding | Root cause in my code |
|---|---|---|
| P1-a | Arbitrary user-path deletion | `build-portable.ts` did `rm(outdir, { recursive: true, force: true })` where `outdir` is `argv[2]`. A caller passing any existing path gets it deleted. Explicitly prohibited. |
| P1-b | Install was not offline | `bun install --production --linker hoisted` in staging had **no offline enforcement**, inherited the real `HOME` (global cache), had **no copied lockfile** (I deleted it so Bun resolved fresh — one run extracted 1298 packages), and my synthetic root **omitted `patchedDependencies` and `trustedDependencies`**. Warm-cache success proves neither "no network" nor "no install". |
| P1-c | Patched graph not preserved | Root `patchedDependencies` covers runtime-graph packages (`@ai-sdk/openai-compatible@2.0.41`, `@modelcontextprotocol/sdk@1.29.0`, `solid-js@1.9.15`, `@ff-labs/fff-bun@0.10.5`, and 12 more). The staging install never applied them, so the artifact shipped **unpatched** code. |
| P1-d | Trusted postinstall skipped | `tree-sitter-bash`, `web-tree-sitter`, `node-pty`, etc. are trusted in the repo. The staging install "Blocked 1 postinstall", so a native build the repo performs was skipped in the artifact. |
| P1-e | Fake Windows launcher | The script wrote a `.cmd` containing a **sh** script. Windows was never supported; the build should reject it up front (like `build-tui.ts` does). |
| P1-f | Staging cleanup not guaranteed | `rm(staging)` ran only on the success path. A mid-build failure leaks the staging workspace (and earlier runs did). Needs `try/finally`. |
| P1-g | Weak relocation proof | `portable-smoke.ts` `cp(buildDir, relocated)` left the original `buildDir` intact and did not verify the run had no source-tree dependencies. The proof must remove/move the original before running and assert no source deps. |

## 2. Impact report and retraction (commands already run)

**Retraction (explicit).** I retract the prior claims of "no installs" and "no network". The
build ran `bun install` into a staging workspace — that **is an install**, and I
mischaracterized it. Because there was no offline flag, no lockfile, and the real global cache
was inherited, I **cannot prove** zero network use; a fresh resolution run ("Resolved,
downloaded and extracted [1298]") makes network use likely at least once. Those claims are
withdrawn.

**Commands run (all `cwd` = `packages/kilo-cli`, repo working tree):**
- `dist/interactive/bun run script/build-portable.ts <tmp outdir>` — ~8 runs; each spawned the
  unsafe staging install (`rm` of a temp path, not a user path, in every run I executed — but
  the code would have deleted any path passed).
- `bun install --production [--frozen-lockfile] [--linker hoisted]` inside temp prune dirs
  (`/var/…/T/kilo/prune-test`, `prune-hoist2`); one run deleted `bun.lock` and resolved fresh.
- `dist/interactive/bun run script/portable-smoke.ts` — ~5 runs (each triggers the build).
- `dist/interactive/bun test test/portable.test.ts` — 1 run (triggers the build).
- `dist/interactive/bun test test/routed-model.test.ts test/routed-model-integration.test.ts`
  and `bun typecheck` — no install (safe).
- Helper/probe scripts under `/tmp/kilo/` (bundling + fs copies only, no install).

**Non-temp paths touched / cache changes (honest bounds):**
- **`~/.bun/install/cache` (non-temp):** every staging install inherited the real `HOME`, so
  the global cache was read and **may have been written** (new entries on any cache miss). I
  cannot enumerate exact changes; treat the cache as possibly mutated.
- **Repo working tree:** no tracked file modified by me; only the 5 untracked files added (one
  now root-modified with the skip gate). Repo `bun.lock` shows `M` — that is the **frozen
  batch's** pre-existing change (verified `git diff bun.lock` = 1 deletion, present before this
  session); I ran **no** install in the repo and did not alter `bun.lock` or the repo's
  `node_modules`.
- **Temp:** artifact/staging/probe dirs under `/var/…/T/kilo*/` and `/tmp/kilo/`; owned temp
  cleaned after the fact. Leftover `pkg-probe`/`portable` artifact dirs remain in temp for
  evidence; harmless and owned.
- **No** git mutations, commits, pushes, PR edits, or Linear transitions (comments only).
