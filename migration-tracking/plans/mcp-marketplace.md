# MCP and marketplace: closing #15307 on v2

Status of this plan: implementation plan for [Kilo-Org/kilocode#15307](https://github.com/Kilo-Org/kilocode/issues/15307).
The issue covers two units from the v1 migration plan:

- **U-E2-22**: each Kilo MCP delta over BASE MCP is tested against the base, and `git:` plugin sources install.
- **U-E2-23**: the marketplace lists and installs each item type through the CLI/RPC API.

MCP Apps is **U-E11-05**, not part of #15307. Product branding is #15298; only the MCP OAuth client
identity is touched here.

## Verdict

#15307 is not complete on v2.

The native MCP base and the skill/MCP/agent marketplace are in place. The Kilo MCP deltas and the
plugin marketplace kind are not. The progress map at the time of writing:

```text
bun script/upstream/progress.ts --list mcp          # 23 open cells
bun script/upstream/progress.ts --list marketplace  # 2 open cells (installer.ts, schema.ts)
bun script/upstream/progress.ts --list plugin | grep -i git
# module:.../plugin/git-source.ts
# module:.../test/kilocode/plugin-git-source.test.ts
```

## Gap audit

| Area | v2 today | Gap |
|---|---|---|
| OAuth callback handoff | `core/src/mcp/oauth.ts` starts one HTTP server per authorization attempt; the default port is ephemeral (`0`); there is no takeover request; `Integration.oauth.connect` does not supersede an existing attempt | A configured `callback_port`/`redirect_uri` already held by another attempt returns `EADDRINUSE`; the older browser tab is not named or replaced. Default ephemeral flows work |
| Issuer discovery | `auth_server_metadata_url` and SDK discovery work; `issuer` is stored in credential metadata | Configured `client_id`/`client_secret` returns the static client unconditionally (`provider.clientInformation`), so a changed issuer can receive the configured secret. The v1 `oauth-issuer.ts` binding is missing |
| CIMD | `cimd` selects `CLIENT_METADATA_URL = https://opencode.ai/oauth/opencode/client.json` whenever no `client_id`/`redirect_uri` | Custom `callback_port` and `client_secret` without `client_id` still select CIMD; v1 required DCR. The upstream document lists the loopback redirect but v2 uses an ephemeral port, so CIMD can mismatch. No Kilo document |
| Auth-failure surfacing | Only `UnauthorizedError` becomes `NeedsAuthError`; `needs_auth` carries the error text | Plain 403 and OAuth-looking non-401 errors become `ConnectError` -> `failed`, so the UI shows "failed" instead of "sign in". The v1 `authFailure` classification is missing |
| SSE probe | The transport uses `fetch: loggedFetch`; there is no probe wrapper | `@modelcontextprotocol/client@2.3.1` still schedules a reconnect at attempt 0 when a 200 GET body is not `text/event-stream`, so a non-SSE endpoint can loop. The v1 `probe()` normalization to 405 is missing |
| jsonc writes | `kilo-plugin/src/marketplace/mcp.ts` preserves comments and symlinks; tests cover it | None |
| `git:` plugin sources | `core/src/plugin/module.ts` treats any non-absolute target as npm (`Npm.add`) | No `git:` parser/resolver/cache; the v1 `git-source.ts` behavior is absent |
| Marketplace kinds | `Kind = ["skill", "mcp", "agent"]`; installer, TUI and VS Code handle those. Modes are agents | `plugin` is absent end-to-end: schema, catalog item, installer/config write, ownership, UI, tests |
| Additional open MCP cells | cleanup, windows hide, sandbox MCP network, token-refresh coalescing, OAuth state/PKCE, remove, cancel/external auth and `needs_auth` error are native or already ported | Env sanitization is missing: local MCP inherits the full host env (`extendEnv: true`), so backend credentials leak. Docker `--rm` is missing. Client identity: upstream still defaults to `opencode`; PR 1 overrides `clientInfo` and the OAuth name/URI in the Kilo host, and the Kilo CIMD document URL remains for Phase 1. MCP Apps is absent but belongs to U-E11-05 |

### Already covered, do not re-port

- JSONC config writes for MCP marketplace installs.
- Process-group cleanup and `windowsHide` in the spawner.
- Sandbox MCP network delegation (`kilo-plugin/src/sandbox/network.ts`).
- Token-refresh race coalescing (`refreshes` in `core/src/mcp/oauth.ts`).
- OAuth state/PKCE per attempt (no shared `mcp-auth.json` race).
- MCP remove, external auth, cancel and the `needs_auth` error text.
- Marketplace skill, MCP and agent/mode install/remove in TUI and VS Code.

## Plan

### Rules

- Keep upstream defaults unchanged. Add generic embedding hooks to shared MCP files, set Kilo values
  from the host, and keep behavior in Kilo-owned code.
- MCP helpers go in `packages/core/src/kilocode/mcp/` so the v1 module cells match by path.
- Plugin resolver and marketplace plugin code go in `packages/kilo-plugin/`.
- Each PR carries the v1 proof ID (`kilo_port(...)` or `kilocode_change(...:<id>)`) and updates the
  map only after a behavior-by-behavior comparison.

### Phase 0: MCP host hooks (PR 1)

**Goal:** a generic embedding surface on `Mcp.Options`, wired from the Kilo host, with no changed
upstream behavior when the host is absent.

PR 1 delivers the hooks the first MCP deltas need:

- `McpHost.Host` in `packages/core/src/mcp/host.ts`: `fetch` (transport fetch wrapper) and
  `localCommand` (local command rewriter), plus `oauth` client identity (`name`, `uri`,
  `documentUrl`).
- Thread the host through `core/src/mcp/index.ts`, `client.ts` and `oauth.ts`.
- Wire the host in `packages/kilo-cli/src/host.ts`:
  `Mcp.node.replace(Mcp.configured({ clientInfo: { name: "kilo", version: KiloApp.version }, host: { oauth: { name: "Kilo", uri: "https://kilo.ai" } } }))`.
- Test the plumbing in `packages/core/test/kilocode/mcp/host-hooks.test.ts`:
  local command rewrite, transport fetch wrapper, and OAuth client metadata.
- Mark the shared additions as rung-3 seams and add the files to
  `script/upstream/shared-patches.json`; prove the existing upstream MCP tests still pass.

**Status:** implemented in this worktree. The hook bag is intentionally limited to the hooks the next
deltas use; later phases extend it rather than replacing it.

Later phases extend the same host interface; they do not rework the hook mechanism.

### Phase 1: MCP OAuth and failure parity

1. **Issuer binding and CIMD**
   - Port `client-metadata.ts` and `oauth-issuer.ts` to `packages/core/src/kilocode/mcp/`.
   - Extend `McpHost.Host.oauth` with the client-information policy hooks. When a configured
     `client_id` is present, return the stored client with its issuer, strip the configured secret,
     and let the SDK discard it on an issuer change.
   - CIMD eligibility: no `client_id`, no `client_secret`, no `callback_port`, and a redirect equal
     to the documented default (`http://127.0.0.1:19876/mcp/oauth/callback`). Otherwise DCR.
   - Use the default `19876`/`/mcp/oauth/callback` when CIMD is selected; keep ephemeral ports for DCR.
   - Provide the Kilo CIMD document at the configured URL (for example
     `https://kilo.ai/docs/oauth/kilo/client.json`). If that host is unavailable, disable CIMD and
     document the DCR fallback.
   - Tests: port `mcp-cimd.test.ts` and `mcp/oauth-issuer.test.ts`. Required cases: a configured
     secret is never sent to a second issuer; refresh against the new issuer; custom callback
     port/redirect/secret use DCR; explicit default redirect uses CIMD.

2. **Callback handoff**
   - Port `mcp-oauth-callback.ts` to `packages/core/src/kilocode/mcp/`.
   - Extend the OAuth host hook with the callback listener factory/takeover. The takeover must fail
     the old attempt's `Deferred` and close its listener.
   - Preserve the v1 security checks: takeover header, loopback `Host` validation, DNS-rebinding
     rejection, and the named "replaced by another authorization attempt" error.
   - Tests: port `mcp-oauth-callback.test.ts` (occupied port, takeover, missing header, rebound host).

3. **SSE probe**
   - Port `sse-probe.ts` to `packages/core/src/kilocode/mcp/`.
   - The host sets `host.fetch` to the probe. Apply it only to the MCP transport fetch, not OAuth
     discovery fetches.
   - Normalize a 200 GET whose content type is not `text/event-stream` to 405; leave event-stream and
     4xx/5xx unchanged.
   - Tests: port `mcp-sse-probe.test.ts`; add the non-SSE 200 case that currently loops.

4. **Auth-failure surfacing**
   - Port `auth-failure.ts` to `packages/core/src/kilocode/mcp/`.
   - Extend the host hook with `authFailure` and use it in `startServer`. For remote servers with
     `oauth !== false`, classify a `ConnectError` as `needs_auth` and preserve the original error
     text; otherwise keep `failed`.
   - Tests: port `mcp/auth-failure.test.ts` and `mcp/auth-classification.test.ts` (plain 403 ->
     `needs_auth`; `oauth: false` -> `failed`; 404/500 -> `failed`).

### Phase 2: `git:` plugin sources

- Port `git-source.ts` to `packages/kilo-plugin/src/plugin/git-source.ts` (path matches the v1
  module cell).
- Add a generic `Plugin.Options.pluginSource` resolver seam in `core/src/plugin.ts` /
  `plugin/module.ts`; the host overrides `Plugin.node` with the Kilo resolver.
- Resolve `git:` specs to a cached local directory before `Npm.add`; keep npm and local-path behavior
  unchanged.
- Port the v1 security rules: no credentials in URLs, no option injection, path traversal rejection,
  ref/subpath handling, immutable cache keys, clone failure errors.
- Tests: `packages/kilo-plugin/test/plugin-git-source.test.ts` (port the v1 cases), plus a host test
  with a local git repo: config `plugins: ["git:..."]` loads the plugin.
- Add the v1 test disposition `ported` with the v2 path; mark the `plugin:25cfde80052f` patch cell on
  the resolver seam.

### Phase 3: Marketplace plugin kind

1. **Schema and registry**
   - `packages/schema/src/kilocode/marketplace.ts`: add `"plugin"` to `Kind`; add
     `plugin?: { spec: string }` to `Item`; add `{ plugin: string, fingerprints? }` to `Resource`.
   - Registry: parse plugin catalog entries; preview shows the spec and a "runs arbitrary code"
     warning.

2. **Installer and config**
   - Add `installPlugin`/`removePlugin` to `packages/kilo-plugin/src/marketplace/installer.ts`.
   - Port `plugin-spec.ts` (identity parsing for npm and `git:` specs) and `plugin-config.ts`
     (append/replace/remove in the `plugins` array), preserving JSONC comments and atomic writes.
   - Persist ownership in the existing durable `Installed` record. Remove only the owned spec; refuse
     if the entry was modified.
   - Preflight the spec through the same npm/git resolver used by the loader; write the config and
     let the plugin loader install on reload.
   - Tests: installer unit tests for append/replace/remove, identity replacement, JSONC preservation,
     modified-entry refusal and git specs.

3. **Clients**
   - TUI: add a Plugins tab, install/remove actions, warning and installed state
     (`packages/tui/src/kilocode/marketplace.tsx`).
   - VS Code: add `"plugin"` to `KINDS` and the corresponding tab/actions
     (`packages/kilo-vscode/webview-ui/src/v2/marketplace-data.ts` and the marketplace UI).
   - Add a CLI/RPC round trip for `list -> preview -> install -> installed -> uninstall` in
     `packages/kilo-cli/test/marketplace.test.ts`.

4. **Map**
   - After plugin support lands, update the dropped dispositions for `plugin-spec.ts` and
     `plugin-config.ts` to `ported`; keep `detection.ts` dropped (durable ownership records replace
     runtime detection) and `relevance.ts` dropped.
   - Mark `installer.ts` and `schema.ts` as `ported` with the v2 paths. Marketplace becomes 13/13.

### Phase 4: Remaining MCP deltas (decide scope)

- **Env sanitization:** local MCP currently inherits the full host environment. Either add an
  environment hook that strips `KILO_*` backend credentials and pass `extendEnv: false` with the
  filtered env, or record a deliberate decision to inherit. This is a security item; recommend
  porting.
- **Docker `--rm`:** port `ensureDockerRm` and wire it through `host.localCommand`; port the v1 unit
  test.
- **Client branding:** `clientInfo.name = "kilo"` via the host (PR 1); OAuth `client_name`/`client_uri`
  via the OAuth host hook (PR 1); Kilo CIMD document (Phase 1). Add a regression test.
- **Interrupted state:** port the v1 test. If v2's Effect-scoped startup already passes, mark it
  `native`; otherwise fix the scope leak.
- **MCP Apps:** leave open under U-E11-05. If the epic owner wants it in #15307, add a separate
  workstream for the two HTTP endpoints, tool `_meta` metadata and client rendering.

### Phase 5: Closeout

- Port remaining tests with `kilo_port(mcp:<test-id>)`.
- Add `kilocode_change(mcp:<patch-id>)` to the corresponding v2 seam/helper lines for the four
  in-scope patch cells; leave the three MCP Apps patch cells open and reference U-E11-05.
- Mark cleanup, windows hide, sandbox network, token refresh and OAuth state as `native` with v2
  pointers.
- Run:
  - `bun test` from `packages/core` and `packages/kilo-plugin`
  - `bun typecheck` in the affected packages
  - `bun run check` at the root
  - `bun script/check-shared-patches.ts --worktree`
  - `bun script/check-opencode-annotations.ts --worktree`
  - `bun script/upstream/progress.ts` and `--list mcp|marketplace|plugin`
- Self-test with `bun dev` using `KILO_V2_PROFILE=$(mktemp -d)` for the TUI marketplace/OAuth, and
  the VS Code e2e path for the plugin tab.
- Update the epic with the PR list and the remaining out-of-scope cells.

## PR sequence

| PR | Content | Depends on |
|---|---|---|
| 1 | `mcp-host-hooks`: host interface, transport/OAuth hooks, host wiring, tests | none |
| 2 | `mcp-oauth-issuer-cimd`: issuer binding, CIMD eligibility/document, tests | 1 |
| 3 | `mcp-callback-handoff`: listener takeover, tests | 1, 2 |
| 4 | `mcp-sse-probe`: probe helper and host hook, tests | 1 |
| 5 | `mcp-auth-failure`: predicate and status classification, tests | 1 |
| 6 | `plugin-git-sources`: resolver, loader seam, tests | none |
| 7 | `marketplace-plugin-kind`: schema, installer, config, RPC tests | 6 |
| 8 | `marketplace-plugin-ui`: TUI and VS Code | 7 |
| 9 | `mcp-extras`: env sanitization, Docker `--rm`, branding regression, interrupted state | 1 |
| 10 | `migration-closeout`: proofs, dispositions, map, epic update | 2-9 |

```mermaid
flowchart LR
  P1[PR 1: MCP host hooks] --> P2[PR 2: issuer + CIMD]
  P1 --> P3[PR 3: callback handoff]
  P1 --> P4[PR 4: SSE probe]
  P1 --> P5[PR 5: auth failure]
  P2 --> P3
  P6[PR 6: git plugin sources] --> P7[PR 7: marketplace plugin kind]
  P7 --> P8[PR 8: marketplace plugin UI]
  P3 --> P10[PR 10: closeout]
  P4 --> P10
  P5 --> P10
  P8 --> P10
  P9[PR 9: MCP extras] --> P10
```

## Exit criteria

- U-E2-22: all named deltas have a v2 test ported with proof and passing; `git:` sources install
  through config and marketplace; upstream MCP tests still pass without the host.
- U-E2-23: `list`, `preview`, `install` and `uninstall` work for `mcp`, `skill`, `agent` and `plugin`
  through the RPC client; TUI and VS Code expose all four; plugin install/remove preserves JSONC and
  ownership.
- `mcp` map: 19/23 cells closed; the remaining four are MCP Apps under U-E11-05 (or 23/23 if that
  unit is pulled in).
- `marketplace` map: 13/13 after restoring `plugin-spec.ts` and `plugin-config.ts`.
- `plugin` map: `git-source` module/test/patch closed.
- `bun run check`, shared-patch checks and annotation checks pass.

## Decisions needed before implementation

1. **CIMD hosting:** does `https://kilo.ai/docs/oauth/kilo/client.json` exist and who publishes it?
   If not, CIMD must fall back to DCR.
2. **MCP Apps:** confirm it stays in U-E11-05 rather than #15307.
3. **Env sanitization:** confirm v1's credential stripping is still required on v2; if yes, it is a
   security fix, not a nice-to-have.
4. **Plugin marketplace install model:** write the spec and let the loader install (recommended), or
   stage/copy the plugin at install time.
5. **Client branding scope:** confirm `clientInfo.name` and OAuth `client_name` belong to this epic or
   to #15298.
