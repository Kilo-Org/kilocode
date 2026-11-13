# Plan: global identity-resilience port (epic #15298, U-E1-01)

Status: implemented (PR #15794). Closes the open `global` cells by porting v1's
state/directory resilience and macOS Spotlight exclusion into v2 as host
composition, adding one generic knob (`OPENCODE_HOME_DIR`, see below) to `packages/util/src/global.ts`.

As built, two details differ from the plan below. All the wiring of step 1 except the `TEST_HOME` name (`cleanEnv`, the state-directory selection) runs in `packages/kilo-cli/src/global-boot.ts`, the boot step of step 2, not in `env.ts`. The module and test cells are closed by `ported` dispositions and the patch cells by `kilo_port(global:…)` proofs.

## Cells this closes

- module `packages/core/src/kilocode/global.ts` (v1): `ensureRealDir`, `writable`, `ready`, `resolveState`.
- module `packages/core/src/kilocode/spotlight.ts` (v1): `markNoIndex` + `exists`/`message`.
- test `packages/core/test/kilocode/global.test.ts` (v1): the `resolveState` suite.
- patches `global:b9f635c56864` (global.ts:7), `global:2886e1a24503` (global.ts:49), `global:9f5a3867e9ba` (global.ts:57): the v1 `kilocode_change` hunks that wired `app="kilo"`, XDG `clean()`, `resolveState`, `ensureRealDir` and `markNoIndex` into upstream `core/src/global.ts`.

The app-dir-name part of those hunks is already done (`OPENCODE_APP_DIR_NAME="kilo2"`, `kilo_port(global:0e189a57d108)`); this plan ports the remaining resilience/Spotlight behavior.

## Key constraint (why placement is forced)

`packages/util/src/global.ts` computes `Path` (`data/config/state/tmp`) **at module load** from `roots(app)` (`global-roots.ts` reads `XDG_*`/`HOME` at load), and `Flock.setGlobal({ state })` runs at load. Per the existing identity seam's own note (`script/upstream/shared-patches.json`, entry `packages/util/src/global.ts`), those statics are read directly by logging, server tmp and the TUI, and some host-started processes compile their own `Global` node from the defaults. Consequence:

- Anything that changes the **paths** (newline sanitize, state-dir selection, test home) must mutate `process.env` **before** `util/global` loads — the same mechanism the app-dir seam uses. A `Global.node.replace` (service layer) is **insufficient** because the statics bypass the service.
- Directory **creation** happens later in the Effect `acquire` layer as idempotent `mkdir -p`; junction-repair and Spotlight marking only need to run before first use, so an early boot step can own them without touching `acquire`.

`kilo-cli/src/index.ts` imports `./env` first, before any `@opencode/util/global` import, so `env.ts` (and a boot step it triggers) is the correct, already-established rung-2 seam-free location.

## Design (Option A — host boot step, rung 2, plus one generic rung-3 knob)

New Kilo-owned module `packages/kilo-cli/src/global-resilience.ts` holding the ported logic (each with a `kilo_port(global:…)` proof):

- `cleanEnv(env)` — strip `\r\n` from `HOME` and `XDG_{DATA,CACHE,CONFIG,STATE}_HOME`; trim `OPENCODE_TEST_HOME`. (v1 `clean()` + the defensive `home` trim.)
- `resolveState(preferred, fallback?)` — ported verbatim from v1 (writability probe, sticky existing fallback, `AggregateError`, warn-and-continue).
- `ensureRealDir(p)` — ported verbatim (mkdir + broken symlink/junction repair).
- `markNoIndex(dir)` — ported verbatim (macOS `.metadata_never_index`, `wx`, EEXIST-ignore, `emitWarning`).

Wiring:

1. **`env.ts` (paths, before load):**
   - add `TEST_HOME` to `names` so `KILO_TEST_HOME → OPENCODE_TEST_HOME`;
   - call `cleanEnv(process.env)`;
   - compute `preferred = <clean XDG_STATE_HOME or ~/.local/state>/kilo2` and (only when `XDG_STATE_HOME` is unset) a fallback under the data dir, run `resolveState`, and set `process.env.XDG_STATE_HOME` to the chosen parent so `roots("kilo2")` yields the resolved state dir.
2. **Early boot step (dirs, before the `acquire` layer builds):** a module imported right after `env.ts` (top-level await, like the entry already uses) that reads `Global.Path`, runs `ensureRealDir` on every leaf `acquire` later mkdirs/realpaths (`data/config/state/cache/tmp/log/bin/repos`, matching v1's repaired set) and `markNoIndex` on `data/cache/state`. `acquire`'s later `mkdir -p` is then a healthy no-op. This runs in every host-started process (they all import `env`/boot first), matching v1 coverage.

### `os.homedir()` is cached, so cleaning `HOME` is not enough

`roots()` defaults its XDG bases from `os.homedir()`, and `os.homedir()` caches `$HOME` as read at **process start** — a trailing shell newline on `HOME` survives in `os.homedir()` even after `cleanEnv` strips `process.env.HOME`, which `roots()` never reads. So the boot step resolves the home once via `resolveHome` (cleaned `process.env.HOME`/`USERPROFILE`, falling back to a stripped `os.homedir()`) and **pins each unset `XDG_{DATA,CACHE,CONFIG}_HOME`** to a clean base under it before `util/global` loads. `roots()` then reads these clean values from the environment via its `||` and never reaches its cached `os.homedir()` default. This is also why the boot step uses `||` (not `??`) and treats a now-empty `XDG_STATE_HOME` as unset: an empty base matches `roots()` and avoids a relative `kilo2` directory in the process CWD.

The same cached-`os.homedir()` problem reaches `Global.Path.home`, which the XDG-base pinning does not fix: its getter still reads `os.homedir()`, and `home` feeds `resolvePath`'s `~` expansion (`core/src/file-access.ts`) and the provider credential paths (bedrock/vertex). v1 fixed this with a `.trim()` in the getter (a `kilocode_change` on the shared file). v2 keeps the same identity seam already present in `packages/util/src/global.ts` (the `OPENCODE_APP_DIR_NAME` knob) and extends it with a second generic knob, `OPENCODE_HOME_DIR`, read before `os.homedir()` with upstream's default unchanged. The boot step pins it to the cleaned home; `OPENCODE_TEST_HOME` still wins, so a test home override is unaffected. This is one marked line on an already-patched shared file (rung 3), recorded in `shared-patches.json` with the `markedLines` limit raised by one. A host-only fix is not possible here: `os.homedir()` is cached process-wide and the getter has no other host-reachable override.

### Known deviation (accepted, documented)

`roots()` always appends the app name, so the env approach cannot reproduce v1's literal `<data>/state` fallback dir — it becomes `<data>/kilo2`-style (still a writable state dir under data). Functionally equivalent; noted because it is not byte-identical to v1. Exact fidelity would need a small state-path seam (rung 3); not proposed.

## Tests (Kilo-owned, `packages/kilo-cli/test/`)

- Port the v1 `resolveState` suite (prefers preferred; falls back; sticky existing fallback; read-only preferred; uncreatable/unwritable preferred, perm-gated/skip on win32+root; preserves error with no fallback; `AggregateError` when both fail).
- `ensureRealDir`: repairs a dangling symlink/junction (POSIX symlink test; Windows-gated where applicable).
- `markNoIndex`: writes the marker on darwin, is a no-op elsewhere, ignores EEXIST.
- `cleanEnv`: newline stripping + `OPENCODE_TEST_HOME` trim; `KILO_TEST_HOME` translation (extend `env.test.ts`/`app-dirs.test.ts`).
- `resolveHome`: strips a newline from the home env var; falls back to a stripped `os.homedir()` when unset/empty.
- Boot wiring (`app-dirs.test.ts`, end to end through the real entry): a newline-only `XDG_STATE_HOME` falls back to the default state dir with no stray CWD `kilo2`; a trailing newline on `HOME` still resolves the directories under the clean home; `KILO_TEST_HOME` overrides the reported home.

Close the `global.test.ts` cell with a `kilo_port(global:…)` on the ported test.

## Progress-map proofs

Each v1 cell gets a done-proof in the implementing PR: `kilo_port(global:<id>)` on the Kilo-owned module/test/wiring that now provides the behavior (Kilo-owned files use `kilo_port`, not `kilocode_change`). The three `global.ts` patch cells are proved by the host wiring that replaces them. Regenerate and verify with `bun script/upstream/progress.ts --list global` (expect 0 open), restoring the generated outputs (CI commits them).

## Scope decision (confirm)

Recommendation: **port all five** behaviors. v1 history shows none are v1-specific throwaways — `ensureRealDir` is a general Windows junction defense and `markNoIndex` is general macOS Spotlight parity. The only argument for dropping is treating the macOS Spotlight marker as an out-of-scope nicety; if so, record `spotlight` as `dropped` instead of porting it.

## Out of scope

- DB-preflight actionable "not writable" error / self-heal — separate `db-preflight` feature.
- Any v1-Kilo → v2 user-data migration — deferred release-migration slices (U-E3-03/U-E8-02).
- The `installation` cells: v1's Kilo distribution identity and its use by upgrade and uninstall. v2 runs a disabled updater on purpose (`packages/kilo-cli/src/updater.ts`), so the cells stay open and belong to #15311. The isolated `kilo2 uninstall` check (dry run and cleanup with the disabled updater; see the `removal` comment there) belongs to #15324, not to these cells.
