# PR 5: `mcp-auth-failure` (MCP authentication failure classification)

Plan for row 5 of the PR sequence in `migration-tracking/plans/mcp-marketplace.md`
(`mcp-auth-failure`: predicate and status classification, tests). Depends on PR 1 (#15986), which is
merged. Reference for the expected shape of a plan/PR from this project: #16029.

## Goal

A remote MCP server that answers with an authentication failure must report `needs_auth` with the
server's original message so the TUI, CLI and VS Code offer sign-in, instead of reporting `failed`.
Non-authentication failures stay `failed`, and a server configured with `oauth: false` stays `failed`.

Acceptance: a `Bun.serve` endpoint that returns 403 for `/mcp`, configured as a plain remote server,
shows `needs_auth` with the original "403" text in `/api/mcp` and "Sign in required" in the TUI; the
same endpoint with `oauth: false`, and a 404/500 endpoint, show `failed`.

## Current state and the gap

- v2 turns only the SDK's `UnauthorizedError` into `needs_auth`
  (`packages/core/src/mcp/client.ts:571-578`); every other connection error becomes `ConnectError`,
  and `packages/core/src/mcp/connection.ts:218-226` maps `ConnectError` to `failed`.
- Evidence that this is the gap: `packages/core/test/mcp.test.ts:3452-3481` asserts a pooled server
  answering 401 or 403 is `failed`. With `oauth: false` today that already matches v1, so the missing
  case is an **OAuth-enabled remote whose failure message describes an authentication problem but
  arrives as `ConnectError`** (a plain 403, an OAuth discovery failure, an `invalid_grant`, and so on).
- v1 classified centrally in `connectRemote`
  (`packages/opencode/src/mcp/index.ts:374`, v1 pin in `migration-tracking/progress/features.json`)
  with the predicate in `packages/opencode/src/kilocode/mcp/auth-failure.ts`.
- The v1 test cells to port: `packages/opencode/src/kilocode/mcp/auth-failure.ts`,
  `packages/opencode/test/kilocode/mcp/auth-failure.test.ts`,
  `packages/opencode/test/kilocode/mcp/auth-classification.test.ts`. The patch cells to close are the
  two in `packages/opencode/src/mcp/index.ts` that carry Kilo attribution: the `authFailure` import
  hunk at `:50` and the `isAuthError` expression hunk at `:374`.

**Prove the gap before writing code.** Write the host test first (task 4.3, the real OAuth-provider
path) and run it against the current tree: `plain-403` must report `failed`. If it already reports
`needs_auth`, stop and report the narrower result instead of adding unreachable code (the predicate
would then only cover OAuth-shaped `ConnectError` messages, and the tests must assert that instead).

## Decisions (settled, with evidence)

1. **Host predicate, not a config-aware classifier.** The hook is a pure message predicate
   (`(message: string | undefined) => boolean`), matching the v1 helper. The `remote && oauth !== false`
   gate stays in core, so the host carries no config policy. No downgrade of an existing `needs_auth`
   is needed: an `oauth: false` server already reports `failed`
   (`packages/core/test/mcp.test.ts:3452-3481`).
2. **Placement is rung 3 (seam).** `input.host` already reaches `McpConnection.make` from both the
   Location connection and the pool (`packages/core/src/mcp/index.ts:447`,
   `packages/core/src/mcp/pool.ts:143`), so only the failure branch changes. No plugin hook reaches
   connection failure classification and no service node can classify it, so a seam is the first
   usable rung.
3. **Where it runs.** The plan's "use it in `startServer`" names a v1 function; v2's equivalent is the
   failure branch of `start` in `packages/core/src/mcp/connection.ts`. Everything that reports a
   server status (per-Location, pooled, and reconnects through `recover`) goes through it.
4. **`needs_client_registration` is not ported.** v2 has no such status and v1 used it only for a
   toast; a dynamic-client-registration failure now reads `needs_auth` or `failed` with the original
   message. Record it as a deliberate difference in the PR.
5. **v1 markers stay verbatim**, including the OAuth-flow phrases ("browser authorization", "token
   exchange failed"). v2 applies the predicate only to connection attempts; those phrases are inert
   there and keeping them keeps the port a pure predicate port.
6. **No flag.** This is a parity fix for an existing status, not a new behavior.

## Tasks

### 1. Port the predicate (Kilo-owned)

New file `packages/core/src/kilocode/mcp/auth-failure.ts`:

- Export `authFailure(error: string | undefined): boolean` with the v1 markers array, `/\boauth\b/`
  and `/\b(?:http|status)\D{0,10}40[13]\b/`, applied to `error.toLowerCase()`; `undefined`/empty is
  `false`. No `kilocode_change` marker (Kilo-owned path), no comment describing v1.
- This closes `module:packages/opencode/src/kilocode/mcp/auth-failure.ts` by relative path
  (`mcp/auth-failure.ts`), so keep the file name.

### 2. Add the host hook (Kilo-owned type, seam consumer)

- `packages/core/src/mcp/host.ts`: add to `Host`
  `readonly authFailure?: (message: string | undefined) => boolean` with a one-line doc comment (this
  interface is already a rung-3 entry in `script/upstream/shared-patches.json`; extend its `seam`
  text to list the new hook).
- `packages/core/src/mcp/connection.ts`, failure branch (currently lines 218-226). Keep the upstream
  expression intact and add one computed boolean:

  ```ts
  const error = Cause.squash(result.cause)
  // kilocode_change start - seam: the host may classify a remote authentication failure
  const authFailure =
    config.type === "remote" && config.oauth !== false && input.host?.authFailure?.(error.message) === true
  // kilocode_change end
  yield* input.events.failed(
    error instanceof McpClient.NeedsAuthError || authFailure
      ? { status: "needs_auth", error: error.message }
      : { status: "failed", error: error instanceof Error ? error.message : String(error) },
    error instanceof McpClient.ConnectError && error.answered === true,
  )
  ```

  `config` is already in scope (`connection.ts:181`). With `host` unset the emitted failure is
  identical to upstream; the only changed upstream line is the `|| authFailure` condition.
- Update `script/upstream/shared-patches.json`: `packages/core/src/mcp/connection.ts` seam text now
  names connection-failure classification, still `rung: 3`; raise `limits.markedLines` by the exact
  number of added marked lines and say so in the seam text.
- Do not touch `client.ts`, `index.ts` or `pool.ts`.

### 3. Wire the host (rung 2)

`packages/kilo-cli/src/host.ts`: import `authFailure` from
`@opencode/core/kilocode/mcp/auth-failure` and pass it in the existing override:

```ts
host: { oauth: { name: "Kilo", uri: "https://kilo.ai" }, authFailure },
```

A Kilo-owned core module does not count against the `coreImports` ratchet. No client (TUI, VS Code,
CLI list) change: all three already render `needs_auth`
(`packages/tui/src/component/dialog-mcp.tsx:30`, `packages/cli/src/commands/handlers/mcp/list.ts`,
`packages/kilo-vscode/webview-ui/src/components/settings/agent-behaviour/McpSubtab.tsx`).

### 4. Tests

1. `packages/core/test/kilocode/mcp/auth-failure.test.ts` — port the four v1 `describe` groups
   verbatim (recoverable messages, unrelated failures, numbers/hostnames, `undefined`) importing
   `authFailure` from `@opencode/core/kilocode/mcp/auth-failure`. This closes the v1 test cell by path.
2. `packages/core/test/kilocode/mcp/auth-classification.test.ts` — port the v1 assertions at the level
   that owns the behavior, `McpConnection.make`, with one shared `Bun.serve` fixture that answers
   `/mcp` with 403 (and a second path with 404 and 500). Capture `events.failed` and assert:
   - 403, host predicate present, default OAuth → `{ status: "needs_auth" }`, `error` contains "403";
   - 403, host predicate present, `oauth: false` → `failed`, `error` contains "403";
   - 404 and 500, host predicate present → `failed`;
   - 403, no `host` → `failed` (upstream default unchanged).
   Input shape: `ConfigMCP.Remote`, `directory: import.meta.dir`, `authProvider: Effect.succeed(undefined)`,
   a no-op elicitation handler, `globalThis.fetch`, `Environment.Service` from
   `packages/core/test/fixture/environment.ts`, `lock: (effect) => effect`, no-op `callbacks`/`fork`,
   and `Effect.scoped` for `input.scope`. With no provider the 403 arrives as a `ConnectError`
   (`packages/core/test/mcp.test.ts:3455` shows the same failure is `failed` today), so this file
   tests the seam directly; the OAuth-provider path is the host test in 4.3. The v1 test's `finishAuth`
   "No pending OAuth flow" assertion has no v2 mechanism; the status assertions above replace it (say
   so in the PR).
3. `packages/kilo-cli/test/mcp-auth-failure.test.ts` — end to end through the real host, modelled on
   `packages/kilo-cli/test/marketplace-oauth.test.ts` (same `createRoutes(..., KiloHost.overrides)`,
   `OpenCode.make` with a `HttpEffect.toWebHandlerWith` fetch, `eventually` helper, 30s timeout).
   Write `kilo2.json` in a temp directory with two remote servers pointing at one `Bun.serve` that
   answers 403: `plain-403` (no `oauth`) and `no-auth` (`"oauth": false`). Assert via
   `client.mcp.list(options)` that `plain-403` settles on `needs_auth` with "403" in `error` and
   `no-auth` on `failed`. This is also the PR proof that the host override reaches the server graph.

## Progress map and proof

- `bun script/upstream/progress.ts --list mcp` first; the IDs are content hashes and must be copied
  from its output.
- Close the `patch:mcp:*` cell whose `source` is `packages/opencode/src/mcp/index.ts:50` (the
  `authFailure` import) by tagging the seam line in `connection.ts` with
  `kilocode_change(mcp:<id>)`. The map resolves the `:374`, `:378` and `:394` hunks as
  `unattributed:mcp`, which current policy leaves untouched, so this feature closes one patch cell,
  not two.
- The three module/test cells above close by path; no `dispositions.json` entry is needed.
- Do not reopen or proof other `mcp` patch cells; they belong to phases 1-3.
- Expected: `mcp` drops from 23 open cells to 19 (3 module/test + 1 patch).
- Update `migration-tracking/plans/mcp-marketplace.md` in the same PR: add a `Status:` paragraph under
  Phase 1 item 4 like Phases 2 and 3 have, and after merge note the PR number on row 5.

## Checks (from package directories, isolated)

```sh
# packages/core
T=$(mktemp -d); env OPENCODE_TEST_HOME=$T XDG_DATA_HOME=$T/data XDG_CONFIG_HOME=$T/config XDG_STATE_HOME=$T/state XDG_CACHE_HOME=$T/cache \
  bun test test/kilocode/mcp/auth-failure.test.ts test/kilocode/mcp/auth-classification.test.ts test/mcp.test.ts test/mcp-oauth.test.ts
bun typecheck

# packages/kilo-cli
bun test test/mcp-auth-failure.test.ts test/host.test.ts
bun typecheck

# root
bun run check
bun script/check-shared-patches.ts --worktree
bun script/check-opencode-annotations.ts --worktree
bun script/upstream/progress.ts --list mcp
git checkout HEAD -- $(bun script/upstream/progress.ts --outputs)
```

`packages/core/test/mcp.test.ts` and `test/mcp-oauth.test.ts` must pass **unchanged**: they are the
proof that the seam leaves upstream behavior alone when no host is configured.

## Self-test and PR proof

Fixture endpoint (one process, two outcomes):

```sh
bun -e 'Bun.serve({ port: 4789, fetch: (r) => new URL(r.url).pathname === "/mcp" ? new Response(null, { status: 403 }) : new Response(null, { status: 404 }) })'
```

Project config:

```json
{ "mcp": { "servers": {
  "plain-403": { "type": "remote", "url": "http://127.0.0.1:4789/mcp" },
  "no-auth": { "type": "remote", "url": "http://127.0.0.1:4789/mcp", "oauth": false }
} } }
```

1. `env KILO_V2_PROFILE=$(mktemp -d) bun dev <project>` and open `/mcps`: `plain-403` reads
   "Sign in required", `no-auth` reads "Failed". Capture the screen.
2. `bun dev api get /api/mcp --param 'location[directory]=<project>'` should show
   `plain-403` → `needs_auth` with "403" in `error`, `no-auth` → `failed`. Paste the JSON in the PR.
3. Use a cheap model only if a session is needed; no prompt is required for this proof.
4. Stop the fixture and the profile service afterwards.

Implemented proof (recorded in the PR): a one-shot `bun dev api get /api/mcp` on a fresh profile
returns `data: []` because it reads before the Location's forked MCP reconcile lands; a warm second
call or any polling read settles. That is independent of this change (a local `echo` server is also
absent in the one-shot read). The proof therefore boots the same graph the TUI uses,
`createRoutes(..., KiloHost.overrides)` with the generated client and polls until the statuses settle.
Captured output:

```json
[
  { "name": "no-auth", "status": { "status": "failed", "error": "Error POSTing to endpoint:  (HTTP 403)" } },
  {
    "name": "plain-403",
    "status": { "status": "needs_auth", "error": "Error POSTing to endpoint:  (HTTP 403)" },
    "integrationID": "mcp_ddf90a4af24976e8"
  }
]
```

The same graph without `authFailure` in the host override reports `plain-403` as `failed` with the
same message, which is the reproduced gap.

## Risks

- **Message-shape coupling.** A 403 is classified only if its message matches
  `/\b(?:http|status)\D{0,10}40[13]\b/`. v2 folds the status into the message as `(HTTP 403)`
  (`client.ts:46-55`), so it should match; the test asserts the real message. If the SDK words it
  differently, extend the predicate in the Kilo module, never the seam.
- **v1 false positive kept on purpose:** a host name such as `oauth.example.com` in a
  "connection refused" message matches `\boauth\b`. Same as v1; leave it and note it if it shows up.
- **Pooled connections** relay the classified failure to every holder (`pool.ts:169-180`), so all
  Locations agree without a pool change; do not special-case the pool.

## Out of scope

- `needs_client_registration` status, registration toasts, and the OAuth issuer/CIMD/callback/SSE
  phases (rows 2-4, 9).
- Clearing credentials, retry policy, or changing when a connect is attempted.
- Any TUI/VS Code copy or badge changes: `needs_auth` already exists in all clients.
