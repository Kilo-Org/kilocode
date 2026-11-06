# Fix: Chromium launch failure in one browser suite cascades into 21 test failures (#15871)

## Goal

A runner that cannot launch a Chromium that is present fails fast once with a clear message, a runner without Chromium skips, and one Chromium launch failure never cascades into another suite. A slow launch must never consume the 180 s outer budget that currently leaves an orphaned Chromium when the child is SIGKILLed.

## Current state

- `packages/kilo-vscode/test/browser-network.test.ts:14-28` runs a Node fixture through `node()` with a 180 s timeout (`190_000` Bun timeout). The fixture `before` hook has a 20 s hard timeout and calls `chromium.launch()` with no `timeout` (`test/fixtures/browser-network.ts:111-117`), so the default 20 s launch timeout races the hook timeout and the hook fails (`hookFailed`). `node()` uses `killSignal: "SIGKILL"` (`test/fixtures/node.ts:20`), which propagates to no children, so the Chromium that eventually starts stays alive (the `killed 1 dangling process` in the issue).
- `packages/kilo-vscode/test/browser-stream.test.ts:528-542` launches its own Chromium in `beforeAll` (20 s hard timeout, no `timeout` option) in the same Bun process. Bun runs test files concurrently, so the two launches compete on the same contended runner.
- A launch failure in `browser-stream` leaves `browser` unset (or closed). The first test's 10 s budget expires, `afterEach`'s unconditional `page.close()`/`stream.close()` (`browser-stream.test.ts:86-89`) and the first test's `finally { await probe.detach() }` (`browser-stream.test.ts:770-772`) throw, and every following test fails in <1 ms at `browser.newPage` (`browser-stream.test.ts:545`). 20 of the 21 failures are this cascade.
- Both test files find Chromium by scanning `CHROME_PATH`, macOS/`/usr/bin` paths and `chromium.executablePath()`. The `kilo packages` job in `.github/workflows/kilo-v2.yml` installs no browser; `.github/workflows/check-test.yml:332-353` does install one, but only for the app e2e jobs, which do not run these suites. `existsSync` only proves the path exists, not that the binary can start.
- Rule to respect: "Avoid mocks as much as possible." The fix must use a real launch probe, no fake Chromium.

## Decisions

1. **One shared preflight probe, run once per package test run.** Probe by launching a real Chromium with the same `options()` used by the suites (`browser-runtime.ts`), then closing it. Cache the outcome (memoized promise, at most one probe per process) so `browser-network`'s wrapper and `browser-stream` share one result.
2. **A found but unlaunchable Chromium fails once, clearly; a missing one stays a skip.** No executable found: keep today's silent skip (a machine without a browser is a normal local setup). Executable found but the probe cannot launch it: fail with the executable path and the launch error tail. Do not skip, because a skip would hide a real runner or binary problem — the `kilo packages` job installs no browser, so these suites already skip in normal CI and a second silent skip would never be read. This matches the issue's "skip or fail fast with a clear message" and `.kilo/skills/v2-migration/SKILL.md:185` ("Never delete or skip a test silently").
3. **`browser-stream` runs the probe in-process.** `browser-stream.test.ts` is a Bun file: run the probe at module top level before declaring the Chromium describe block, and branch on its `state` (`missing` skips, `failed` yields one failing test, `ready` runs the suite). Because Bun test files are isolated per file, this cannot make a non-browser file pay the probe cost.
4. **`browser-network` runs the probe in the wrapper process, before the Node child.** Replace `test()`'s `skipIf(!executable)` with the same module-level `await probe()` in `browser-network.test.ts` (only when `executable` is set), then keep the existing `node()` run. This keeps the expensive Node/Node-test launch out of the 180 s budget and makes a probe failure cost seconds, not 180 s.
5. **Bound every launch explicitly and retry once.** Pass `timeout` to every `chromium.launch` in tests (`browser-network` fixture, `browser-stream` `beforeAll`) with a short budget, and retry once with a fresh proxy/socket state. A single 20 s default no longer equals the hook timeout.
6. **Harden cleanup so a dead browser cannot cascade.** The `afterEach` cleanup and the first `browser-stream` test's `finally` must treat `Target page, context or browser has been closed` as expected. Do not change production `browser-stream.ts`; the test's `probe.detach()` is Chromium CDP state, and the issue's suggestion to guard it applies to the test.
7. **Kill the process tree when the child times out.** Playwright launches Chromium detached in its own process group (chromium with `--remote-debugging-pipe`, no `detached`), so a SIGKILL to `node` orphans it. In `test/fixtures/node.ts`, wrap the exec so on timeout the child is killed with its process group (or the Node fixture closes the browser in a `process.on("SIGTERM")` handler and the helper escalates SIGTERM → SIGKILL). Prefer the fixture-side `SIGTERM` handler plus the existing `killSignal` fallback, because it does not depend on `setsid` availability.

## Plan

1. **Add `test/fixtures/chromium.ts`** (or `test/support/chromium.ts`, sibling of `test/fixtures/node.ts`):
   - Move the existing executable scan from both test files into one exported `executable` (same candidate list, same order) so the two suites cannot disagree.
   - Export `probe()`, memoized: if no `executable`, return `{ state: "missing" }`; otherwise `chromium.launch({ ...options(false), executablePath: executable, timeout: PROBE_TIMEOUT })`, `await browser.close()`, return `{ state: "ready" }`. On error, return `{ state: "failed", reason }` with the executable path and `error.message` tail.
   - Export `describe(state)` returning the message text, so the failure names the executable and the launch error instead of a generic "beforeAll hook failed".
   - Keep the constant small (for example 15 s) and document why it is below the suite hook budgets.
2. **`test/browser-network.test.ts`**: replace the local `executable` scan with the shared one and branch on one `probe()` result: `missing` keeps `test.skipIf(!executable)`; `failed` adds a single test whose body is `expect.unreachable(reason)`, run instead of the wrapper test; `ready` runs the wrapper test unchanged. Keep the 180 s/190 s budgets for the actual Node run, since the probe no longer sits inside them.
3. **`test/browser-stream.test.ts`**: replace the local scan with the shared one; same `missing` → `describe.skipIf(!executable)`, `failed` → one failing test with the reason; `ready` → run the suite. In `beforeAll`, pass `timeout: LAUNCH_TIMEOUT` to `chromium.launch` and retry once. Make `afterEach`'s `page.close()`/`stream.close()` (line 86-89) use `Promise.allSettled` or ignore `has been closed`. Guard `probe.detach()` in the first test's `finally` (`771`) and any other CDP `detach` to ignore `Target ... has been closed`.
4. **`test/fixtures/browser-network.ts`**: pass an explicit `timeout` in `launch()` (line 94) equal to the `before` hook budget, or lower the hook budget and raise the launch timeout above it so the launch timeout is the meaningful error. Prefer `timeout: 15_000` with the hook at `20_000`. Add a `process.once("SIGTERM", ...)` handler in `before`/`after` that closes `browser` and `gateway` so the Node child can clean up when the parent gives up.
5. **`test/fixtures/node.ts`**: keep `killSignal: "SIGKILL"` as the last resort, but first send `SIGTERM` and wait a short grace before SIGKILL, so the fixture's handler can close Chromium. Do this with the Bun/Node `child_process` API directly or `AbortSignal.timeout`; do not change the signature for other callers (`browser-proxy.test.ts` uses the same helper).
6. **No CI browser install in this fix.** The probe turns a missing browser into the existing skip and a broken one into one clear failure. Whether to `npx playwright install chromium` in `kilo packages` is covered by the open question below.
7. **Audit for other Chromium launch sites** before finalizing: `rg -n "chromium\.launch" packages/kilo-vscode/test` currently returns only the two files above; recheck after edits and route any new one through `probe()`.

## Validation

- From `packages/kilo-vscode`: `bun test test/browser-stream.test.ts test/browser-network.test.ts` — both pass on a working browser, and both skip when no browser is installed.
- Simulate a broken browser without mocks: `CHROME_PATH=/bin/false bun test test/browser-stream.test.ts` and `CHROME_PATH=/bin/false bun test test/browser-network.test.ts`. Both must fail once, within a few seconds, with a message naming `/bin/false` and the launch error, with no cascade and no leftover Chromium. `/bin/false` is used in place of a real browser only here, because it is a real executable that fails to launch; the probe itself stays unmocked.
- Simulate a slow launch: temporarily point `CHROME_PATH` at a wrapper script that sleeps 30 s then execs real Chromium; both suites must fail once after the probe timeout, the `browser-network` run must finish far below 180 s, and no Chromium process may remain.
- `bun run typecheck` and `bun run lint` from `packages/kilo-vscode`. Do not run `bun test` from the repo root.
- Confirm the full package run still executes every non-Chromium test as before, and check `git diff` touches only `packages/kilo-vscode/test/**` and the plan file. No `kilocode_change` markers are needed: these are Kilo-owned test files, not shared upstream files.
- If any skip path remains, list it in the PR body with its reason, per `.kilo/skills/v2-migration/SKILL.md:185`.

## Risks

- The probe adds one Chromium launch (~1-3 s) to every `kilo-vscode` test run on machines that have a browser. Acceptable given it replaces two brittle launches.
- If `chromium.executablePath()` points at a shell that exits successfully but Chromium later fails, the probe catches the failure and the suite fails once with the reason. That is intended: a broken binary is a real failure, not an environment limitation.
- Failing on a probe timeout could block a PR for a transient runner hiccup, since the second `browser-stream` launch also retries once. Mitigate by making the probe retry once on a timeout before failing, and by printing the error tail so the log distinguishes a timeout from a missing library or sandbox error.
- The `kilo packages` job will start failing if its runner has a browser on PATH that cannot launch. Today it installs none, so this only happens if the image gains one; the failure message names the path so the cause is obvious.

## Open question (not blocking implementation)

Chromium coverage in CI: the `kilo packages` job installs no browser, so today those suites skip in CI unless the runner image ships one. `check-test.yml:332-353` already reads the Playwright version from the workspace catalog, caches browsers under `.playwright-browsers` and runs `bunx playwright install chromium`; the same steps could be copied into `kilo-packages`. Decide separately whether that is worth the job time.
