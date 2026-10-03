# VS Code: MCP OAuth sign-in UX

Port of [PR #14667](https://github.com/Kilo-Org/kilocode/pull/14667) (`feat(jetbrains): add MCP OAuth sign-in`) to `packages/kilo-vscode/`.
Reference implementation is checked out locally at `/Users/kirillk/work/kilocode/.kilo/worktrees/lively-zephyr` (branch `lively-zephyr`) — read Kotlin sources there when a detail below is ambiguous.

**All edits go in the current worktree (`.kilo/worktrees/frosty-acorn`). Never modify `lively-zephyr` or the main checkout.**

## Goal

VS Code users can complete MCP OAuth sign-in without hand-editing config, discover which MCP servers need sign-in from the chat prompt, and configure a pre-registered OAuth client. Behaviour of the auth flow and the prompt-area issue indicator matches JetBrains; the marketplace surface is adapted to VS Code's webview panel + install modal.

## Already done — do not rebuild

- **No CLI changes needed.** Every endpoint and event exists. `packages/sdk/js/src/v2/gen/` already exposes `client.mcp.status`, `client.mcp.auth.authenticate`, `client.mcp.auth.remove`, `client.mcp.connect`, `client.mcp.disconnect`, `client.config.overlayUpdate`, and `McpOAuthConfig` **including `callbackPort` and `redirectUri`** (`v2/gen/types.gen.ts:2462-2488`). **No SDK regen.**
- **MCP + companion-skill removal already works** in the MCP→skills direction: `removeMarketplaceItem` / `removeMarketplaceItemFromAllScopes` (`src/services/marketplace/actions.ts:68-110`) call `POST /kilocode/marketplace/remove`, and `RemoveDialog.tsx:30-32` already discloses it. Do **not** port the JetBrains MCP-side bundle logic. Only the **skill→MCP** direction is missing (Task 9).
- A basic sign-in button already exists at `AgentBehaviourTab.tsx:689-700`, and `src/kilo-provider/mcp-oauth.ts` already calls `authenticate`. Both get replaced by the new service.
- Config writes already go through `PATCH /config/overlay` with `set`/`unset` and optimistic revisions (`KiloProvider.handleUpdateConfig`, `src/KiloProvider.ts:3836-3929`). Do **not** add a second write path.

## Locked decisions

| Decision | Choice |
|---|---|
| Scope | Auth service + prompt issues + marketplace inline prompt + browser fallback + Settings row rework + OAuth client config in `McpEditView` + skill→MCP bundle removal |
| Marketplace sign-in | Inline step in the `InstallModal` result pane |
| Issues menu shape | `DropdownMenu.Sub` per issue (literal JetBrains parity) |
| Settings deep link | Full: `tab` + `subtab` + focus token that expands and scrolls the MCP row |
| Outcome reporting | `signInMcp` carries `notify?: boolean`. Prompt/Settings omit it → host shows a native notification. Marketplace passes `notify: false` → inline only. `cancelled` is always silent. |
| Browser-open failure | Native `showInformationMessage(msg, "Open in Browser", "Copy URL")`, replacing today's auto-retry. Keep the 4 s same-URL dedupe, add the server name. |
| Warning icon placement | First child of `.prompt-input-hint-actions`, reusing `prompt-input.css:568-607` tone/dot CSS |

## Critical behaviours to preserve from JetBrains

1. **`failed` → `needs_auth` normalization is load-bearing.** The CLI only emits `needs_auth` on `UnauthorizedError`; real-world recoverable failures (notably Anaconda's `SSE error: Non-200 status code (403)`) arrive as `failed`. Without normalization no Sign In affordance ever appears.
2. **Client timeout must stay above the CLI's 5 min callback timeout.** Use 6 min so the CLI names the failure first.
3. **Cancel == `DELETE /mcp/{name}/auth`.** There is no cancel endpoint; deleting credentials is what rejects the CLI's pending callback.
4. **`mcp.browser.open.failed` fires while `authenticate` is still pending.** Any surface must be non-blocking.
5. **Never drop `headers` / `oauth` when editing a remote server.** The CLI's `mergeDeep` clears them when `type`/`url` changes unless the patch re-states them.

---

## Task 1 — Pure status normalization

New file `src/services/mcp-auth/status.ts`. No `vscode` import, no I/O.

```ts
import type { McpStatus } from "@kilocode/sdk/v2/client"

const MARKERS = [
  "unauthorized", "authentication required", "needs authentication", "not authenticated",
  "browser authorization", "token exchange failed", "invalid_token", "invalid_grant",
]
const WORDS = [/\boauth\b/]
const HTTP = /\b(?:http|status)\D{0,10}40[13]\b/

/** True when an MCP `failed` error is recoverable by signing in again. */
export function authFailure(error: string | undefined): boolean
/** Rewrite recoverable `failed` entries to `needs_auth`, preserving `error`. */
export function normalize(status: Record<string, McpStatus>): Record<string, McpStatus>
```

- Match against `error.toLowerCase()`.
- Keep the regexes **anchored** — `\b` on `oauth` and the `http|status` prefix on `40[13]` are what stop false positives.
- `normalize` must keep the `error` field on the rewritten entry (the Settings tooltip shows it).

**Tests** — `tests/unit/mcp-auth-status.test.ts`. Port the JetBrains corpus from `backend/src/test/kotlin/ai/kilocode/backend/cli/KiloCliDataParserTest.kt` verbatim:

- → `needs_auth`: `Unauthorized: authentication required`, `Browser authorization failed: Authorization cancelled`, `Browser authorization was rejected: ... replaced by another authorization attempt`, `Token exchange failed: invalid client`, `Error POSTing to endpoint (HTTP 401): missing bearer token`, `Error POSTing to endpoint (HTTP 403): Forbidden`, `SSE error: Non-200 status code (403)`, `SSE error: Non-200 status code (401)`, `OAuth discovery failed`, `... invalid_grant`, `... invalid_token`
- stays `failed`: `Connection refused`, `Connection closed`, `Failed to get tools`, `spawn npx ENOENT`, `Invalid MCP URL for "broken"`, `Error POSTing to endpoint (HTTP 500)`, `SSE error: Non-200 status code (404)`, `(500)`
- **anti-false-positive** (must stay `failed`): `connect ECONNREFUSED 127.0.0.1:40123`, `connect ECONNREFUSED 127.0.0.1:40323`, `Invalid MCP URL for "broken401"`, `Invalid MCP URL for "broken403"`, `Invalid MCP URL for "oauthserver"`, `Failed to connect to myoauthapp.internal`, `Request failed after 403 ms`

---

## Task 2 — Extension-host auth service

New `src/services/mcp-auth/service.ts` + `src/services/mcp-auth/index.ts`.

```ts
export type McpAuthStatus =
  | "connected" | "failed" | "cancelled" | "timeout"
  | "unsupported" | "not_found" | "disabled" | "needs_client_registration"

export interface McpAuthResult { status: McpAuthStatus; error?: string }

export interface McpAuthOpts {
  timeout?: number   // default 6 * 60 * 1000
  dedupe?: number    // default 4000
  onUrl?: (name: string, url: string) => void
}

export class McpAuthService {
  constructor(connection: KiloConnectionService, opts?: McpAuthOpts)
  /** Sorted `needs_auth` server names per directory. */
  needsAuth(dir: string): string[]
  /** Sorted server names with an in-flight sign-in, per directory. */
  busy(dir: string): string[]
  onChange(listener: (dir: string) => void): () => void
  refresh(dir: string): Promise<string[]>
  signIn(dir: string, name: string): Promise<McpAuthResult>
  cancel(dir: string, name: string): Promise<boolean>
  reset(dir: string, name: string): Promise<boolean>
  dispose(): void
}
```

`index.ts` memoizes one instance per connection so no constructor threading is needed:

```ts
const instances = new WeakMap<KiloConnectionService, McpAuthService>()
export function mcpAuth(connection: KiloConnectionService): McpAuthService
```

Semantics — mirror `frontend/.../app/KiloMcpAuthService.kt` exactly:

- **`refresh(dir)`**: blank `dir` → `[]`, no HTTP call. Otherwise `client.mcp.status({ directory: dir })` → `normalize()` → filter `needs_auth` → store sorted. Bound the directory map to **64** entries, evicting oldest insertion first. Fire `onChange(dir)` only when the value actually changed.
- **`signIn(dir, name)`**: single-flight per `` `${dir}\0${name}` `` via a `Map<string, object>` token. A duplicate call returns `{ status: "failed" }` immediately with no HTTP request. Race `client.mcp.auth.authenticate({ name, directory: dir })` against a 6 min timer:
  - resolved and token is in the `cancelled` set → return `{ status: "cancelled" }` (silent)
  - resolved → map the response: `200` → the `McpStatus.status` tag + `error`; `400` → `unsupported`; `404` → `not_found`; other → `failed` with `error ?? message ?? "HTTP <code>"`
  - timed out → `client.mcp.auth.remove(...)` for cleanup, return `{ status: "timeout" }`
  - `finally`: drop the token, clear the cancel mark, update `busy`, and `await refresh(dir)`
- **`cancel(dir, name)`**: mark the in-flight token cancelled, `client.mcp.auth.remove(...)`; roll the mark back if the delete failed.
- **`reset(dir, name)`**: mark cancelled → `auth.remove` → `disconnect` → `connect` → `refresh`. If the reconnect failed, still mark the server `needs_auth` so the UI stays honest.
- **Browser fallback**: subscribe once (lazily, idempotent) to `connection.onEvent` for `mcp.browser.open.failed`, dedupe the **same URL within 4 s**, then call `opts.onUrl(properties.mcpName, properties.url)`.
- Wrap every SDK call so failures log and fall back instead of throwing. Never swallow a disposal/abort.

**Tests** — `tests/unit/mcp-auth-service.test.ts`, driven by a fake client (short `timeout`/`dedupe`, captured `onUrl`). Port all 13 cases from `KiloMcpAuthServiceTest.kt`, in particular:

- `refresh` collects only `needs_auth`; blank directory issues no call; 65 refreshes leave 64 entries with the oldest evicted
- concurrent `signIn` is single-flight (second returns `failed`, exactly one HTTP call)
- timeout path calls `auth.remove` and returns `timeout`
- `reset` calls `auth.remove` → `disconnect` → `connect` and leaves the server `needs_auth`; keeps `needs_auth` when `connect` throws
- cancelling an in-flight sign-in yields `cancelled` **and a subsequent sign-in still succeeds** (token cleanup)
- same URL twice inside the dedupe window → one `onUrl`; different URLs → two

---

## Task 3 — Host wiring, messages, notifications

### 3a. `src/kilo-provider/mcp-oauth.ts`

- Delete `authenticateMcpServer` (replaced by the service) and the auto-retry in `openMcpOAuthUrlOnce`.
- Replace with `showAuthUrl(name: string, url: string)`: `vscode.window.showInformationMessage(t("mcp.auth.browserFailed", { name }), t("mcp.auth.browserFailed.open"), t("mcp.auth.browserFailed.copy"))` → `vscode.env.openExternal` / `vscode.env.clipboard.writeText`. Non-modal.
- The 4 s dedupe now lives in `McpAuthService`; pass `showAuthUrl` in as `opts.onUrl`.
- Keep `connectMcpServer` / `disconnectMcpServer`.

### 3b. New message contract

`webview-ui/src/types/messages/webview-messages.ts` — add to the interfaces **and** the `WebviewMessage` union:

```ts
export interface RequestMcpAuthStateMessage { type: "requestMcpAuthState" }
export interface SignInMcpMessage { type: "signInMcp"; name: string; notify?: boolean }
export interface CancelMcpSignInMessage { type: "cancelMcpSignIn"; name: string }
export interface ResetMcpAuthMessage { type: "resetMcpAuth"; name: string }
export interface RequestMcpBundlesMessage { type: "requestMcpBundles" }
```

Change `OpenSettingsTabRequest` (`:616-619`) to `{ type: "openSettingsTab"; tab: string; subtab?: string; focus?: string }`.

**Remove** `AuthenticateMcpMessage` (`:371-393` block, union member ~`:1720`) and its `KiloProvider` case — one code path only, and `knip` will flag the orphaned export.

`webview-ui/src/types/messages/extension-messages.ts` — add to the interfaces **and** the `ExtensionMessage` union:

```ts
export interface McpAuthStateMessage {
  type: "mcpAuthState"
  directory: string
  needsAuth: string[]
  busy: string[]
}
export interface McpAuthResultMessage {
  type: "mcpAuthResult"
  name: string
  status: McpAuthStatus
  error?: string
}
export interface McpBundle { id: string; scope: "project" | "global"; skills: string[] }
export interface McpBundlesMessage { type: "mcpBundles"; bundles: McpBundle[] }
```

Extend `NavigateMessage` (`:463-468`) with `subtab?: string` and `focus?: string`.

### 3c. `src/KiloProvider.ts`

- Apply `normalize()` inside `fetchAndSendMcpStatus` (`:3073-3092`) before caching/posting, so Settings, prompt, and marketplace all agree on `needs_auth`.
- New message cases next to the existing MCP block (`:1448-1480`): `requestMcpAuthState`, `signInMcp`, `cancelMcpSignIn`, `resetMcpAuth`, `requestMcpBundles`.
- Add `private auth = mcpAuth(this.connectionService)` and subscribe to `auth.onChange(dir)`; when `dir === this.getWorkspaceDirectory()`, post `mcpAuthState`. Cache the last payload as `cachedMcpAuthStateMessage` and replay it on reconnect/webview-ready, following the `cachedMcpStatusMessage` pattern. Dispose the subscription with the provider.
- `signInMcp` handler: `await auth.signIn(dir, name)`, then `postMessage({ type: "mcpAuthResult", ... })`. If `message.notify !== false` **and** `status !== "cancelled"`, show a native notification: `connected` → info `mcp.signIn.success`; `timeout` → error `mcp.signIn.timeout`; `unsupported` → error `mcp.signIn.unsupported`; `not_found` → error `mcp.signIn.notFound`; anything else → error `mcp.signIn.failed` with `result.error` appended when present.
- `resetMcpAuth`: on failure show `mcp.auth.resetFailed`.
- Extend the `openSettingsTab` case (`:1544-1548`) so `tab === "agentBehaviour"` runs a new command `kilo-code.new.openMcpSettings` with `message.focus`.
- `KiloProvider.ts` is already 6183 lines. Put all non-trivial logic in `src/services/mcp-auth/` and `src/kilo-provider/mcp-oauth.ts`; the provider should only dispatch and post.

### 3d. `src/MarketplacePanelProvider.ts`

- `tests/unit/marketplace-panel-arch.test.ts:11-26` forbids *marketplace* message cases in `KiloProvider`. MCP-auth cases are not marketplace cases, but the panel still needs its own: add `requestMcpAuthState`, `signInMcp`, `cancelMcpSignIn` to `handle()` (`:214-246`) using the same `mcpAuth(this.connectionService)` instance, and post `mcpAuthState` / `mcpAuthResult` through `post()` (`:359-364`).
- In `install()` (`:295-305`), after a successful `item.type === "mcp"` install: `const needs = await auth.refresh(dir)`, and include `needsAuth: needs.includes(item.id)` on the `marketplaceInstallResult` message. **Use `item.id`** (the config key), not `item.name`.
- Keep the existing native "Successfully installed" notification.

### 3e. Host i18n

New namespace `src/services/i18n/mcp/{en,ar,br,bs,da,de,es,fa,fr,it,ja,ko,nl,no,pl,ru,th,tr,uk,zh,zht}.ts`, spread into `src/services/i18n/en.ts` (and each locale root) alongside `autocompleteDict` / `attentionDict`.

```
"mcp.signIn.success": "Signed in to {{name}}."
"mcp.signIn.failed": "Sign-in to {{name}} failed."
"mcp.signIn.timeout": "Sign-in to {{name}} timed out."
"mcp.signIn.unsupported": "{{name}} does not support OAuth sign-in."
"mcp.signIn.notFound": "MCP server {{name}} was not found."
"mcp.auth.browserFailed": "Kilo could not open a browser for {{name}}. Open the authorization URL on the machine running Kilo to finish signing in."
"mcp.auth.browserFailed.open": "Open in Browser"
"mcp.auth.browserFailed.copy": "Copy URL"
"mcp.auth.resetFailed": "Could not clear the stored sign-in for {{name}}."
```

Check `tests/unit/i18n-keys.test.ts:364-380` — if it hardcodes the `autocomplete`/`attention` namespaces for the host pool, extend it to include `mcp`.

---

## Task 4 — Webview session context

`webview-ui/src/context/session.tsx` (+ `session-types.ts`):

- Add `const [mcpAuth, setMcpAuth] = createSignal<{ needsAuth: string[]; busy: string[] }>({ needsAuth: [], busy: [] })`, fed by `mcpAuthState` in the existing `vscode.onMessage` block alongside `mcpStatusLoaded` (`:741-747`).
- Request `requestMcpAuthState` next to the `requestMcpStatus` call (`:750`) and reuse the same 3 s / `extensionDataReady` retries (`:752-764`).
- Replace `authenticateMcp` (`:323-328`) with `signInMcp(name, notify?)`, `cancelMcpSignIn(name)`, `resetMcpAuth(name)`.
- **Remove the global `mcpLoading` gate for auth actions.** Per-server busy now comes from `mcpAuth().busy`. Keep `mcpLoading` for `connectMcp`/`disconnectMcp`.
- Add `mcpBundles` signal + `refreshMcpBundles()` fed by `mcpBundles` (Task 9).
- Export everything on the context object (`:3008-3012`) and in `session-types.ts:137-141`.

The `MarketplaceSessionProvider` (`webview-ui/src/context/marketplace-session.tsx`, 41 lines) is a separate lightweight provider. Add the same `mcpAuth` signal + `signInMcp`/`cancelMcpSignIn` there — do **not** pull the full session provider into the marketplace bundle.

---

## Task 5 — Prompt-area session issues

### 5a. Generic issue model

New `webview-ui/src/components/chat/session-issues.ts` (pure, no JSX):

```ts
export interface SessionIssueAction {
  title: string
  description?: string
  enabled?: boolean
  run: () => void
}
export interface SessionIssue { id: string; title: string; actions: SessionIssueAction[] }
```

Plus a pure derivation so it is unit-testable without rendering:

```ts
export function mcpAuthIssues(
  needsAuth: string[],
  busy: string[],
  t: (key: string, params?: Record<string, string>) => string,
  handlers: { signIn: (name: string) => void; openSettings: (name: string) => void },
): SessionIssue[]
```

Per server, sorted by name:
- `id: \`mcp-auth:${name}\``
- `title: t("prompt.mcp.provider", { name: capitalize(name) })` → `"Anaconda MCP"`
- actions: `[{ title: busy ? t("prompt.mcp.signIn.busy") : t("common.signIn"), enabled: !busy, run: signIn }, { title: t("prompt.mcp.openSettings"), run: openSettings }]`

Deliberately **no severity field** — one visual severity today, so the icon is fixed at the component level. Keep the model generic for future non-MCP issue providers.

### 5b. Indicator component

New `webview-ui/src/components/chat/SessionIssues.tsx`:

- Returns `null` when `issues.length === 0` — that is the only hide condition, and there is no dismiss.
- `DropdownMenu` → `Trigger` wrapping `IconButton icon="warning" variant="ghost" size="small"` with `class="prompt-issues-button"`, `aria-label={t("prompt.issues.title")}`, wrapped in `Tooltip value={t("prompt.issues.title")} placement="top"`.
- `DropdownMenu.Portal` → `Content placement="top"` → one `DropdownMenu.Sub` per issue: `SubTrigger` = `issue.title`, `Portal` → `SubContent` → `DropdownMenu.Item` per action with `disabled={action.enabled === false}` and `onSelect={action.run}`.
- `warning` exists in the upstream icon registry (`packages/ui/src/components/icon.tsx:108`). `alert-triangle` does **not** — do not use it.
- The nested `DropdownMenu.Portal` inside `Sub` is required; see `packages/kilo-ui/src/stories/dropdown-menu.stories.tsx:83-106` (the only existing submenu usage in the repo).

### 5c. Mount it

`webview-ui/src/components/chat/PromptInput.tsx` — insert `<SessionIssues ... />` as the **first** child of `.prompt-input-hint-actions` (`:2207`), before the indexing `<Show>` at `:2208`.

- `signIn` → `session.signInMcp(name)` (notify defaults on)
- `openSettings` → `vscode.postMessage({ type: "openSettingsTab", tab: "agentBehaviour", subtab: "mcpServers", focus: name })`

`webview-ui/src/styles/prompt-input.css` — add `.prompt-issues-button { position: relative; color: var(--vscode-charts-yellow, #cca700); }` and add the selector to the shared status-dot rule at `:576-578` with the top-right offset from `:588-591`.

### 5d. Tests

- `tests/unit/session-issues.test.ts` — pure: empty in → empty out; one `needs_auth` → one issue with `"<Name> MCP"` title and `["Sign in", "Open in Settings"]`; busy → first action disabled with the `Signing in…` label; two servers → two issues in sorted order.
- Component fixture `tests/fixtures/session-issues.tsx` + `tests/unit/session-issues-render.test.ts`, following `tests/fixtures/marketplace-install-modal.tsx` and `tests/fixtures/run.ts`: nothing rendered with zero issues; trigger present with the right `aria-label` when there is one; `openSettingsTab` with `subtab: "mcpServers"` and `focus: "<name>"` is posted when the action is selected.

---

## Task 6 — Settings deep link to the MCP row

1. **Command** — `src/extension.ts` next to `openIndexingSettings` (`:604-606`):
   ```ts
   vscode.commands.registerCommand("kilo-code.new.openMcpSettings", (focus?: string) =>
     settingsEditorProvider.openPanel("settings", "agentBehaviour", undefined, "mcpServers", focus),
   )
   ```
   Register it in `package.json` `contributes.commands` with the `kilo-code.new.` prefix.
2. **`src/SettingsEditorProvider.ts`** — extend `openPanel(view, tab?, projectId?, subtab?, focus?)` (`:60-77`). Store `subtab`/`focus` next to the existing `tabs` map and include them in the `navigate` posts at `:70-76` **and** the `webviewReady` replay at `:130-142`. Clear `focus` after it is sent once.
3. **`webview-ui/src/App.tsx`** — in the `navigate` handler (`:348-354`) add `settingsSubtab` and a token-bearing focus signal (same trick as `MarketplaceFocus`, `MarketplaceListView.tsx:26-30`, so repeat requests for the same server are observable):
   ```ts
   setSettingsFocus((prev) => ({ token: (prev?.token ?? 0) + 1, name: message.focus! }))
   ```
   Pass both into `<Settings>` (`:455-463`).
4. **`webview-ui/src/components/settings/Settings.tsx`** — accept `subtab` / `focus` props, mirror the existing `createEffect(on(() => props.tab, ...))` at `:293-300`, and pass them to `<AgentBehaviourTab />` (`:444`), which currently takes no props.
5. **`webview-ui/src/components/settings/AgentBehaviourTab.tsx`** —
   - Add `Props { subtab?: string; focus?: { token: number; name: string } }`.
   - `createEffect(on(() => props.subtab, ...))` setting `activeSubtab` (`:59`) when it is a valid `SubtabId`.
   - **Lift `expanded` out of `renderMcpSubtab()`** (`:557`) to component scope so the focus effect can reach it.
   - On a new focus token: set `activeSubtab("mcpServers")`, expand that row, and `scrollIntoView({ block: "nearest" })` via a `ref` captured per row keyed by server name.

---

## Task 7 — Settings MCP row rework

`webview-ui/src/components/settings/AgentBehaviourTab.tsx`, `renderMcpSubtab()` (`:555-831`). Match `McpSettingsUi` cell rules exactly:

| Status | Controls (in order) |
|---|---|
| `needs_auth` | **Sign in**, edit, remove. **No enable/disable switch** — you cannot connect your way out of an auth problem. |
| `connected` + remote | switch (on), **Reset sign-in**, edit, remove |
| `connected` + local | switch (on), edit, remove |
| anything else | switch (off), edit, remove |

- Status pill carries the failure reason: wrap the label in `Tooltip` with `"<label>\n<error>"` when `error` is present, and no tooltip when `connected`. Add a `warning` icon to the pill when `status === "needs_auth"` (JetBrains parity, `McpSettingsUi.badges()`).
- Replace `session.authenticateMcp(name)` (`:695`) with `session.signInMcp(name)`. While `session.mcpAuth().busy.includes(name)`: show a spinner + `settings.agentBehaviour.mcp.signIn.cancel` button calling `session.cancelMcpSignIn(name)`, and disable the row's other actions.
- **Reset sign-in** → `useDialog().show(...)` confirm using the `dialog-confirm-body` / `dialog-confirm-actions` layout already used by `confirmRemoveSkill` (`:178-201`), then `session.resetMcpAuth(name)`.
- `statusColor`/`statusLabel` (`:563-584`) already cover all five statuses — leave them.

---

## Task 8 — OAuth client config in `McpEditView`

`webview-ui/src/components/settings/McpEditView.tsx` and `webview-ui/src/types/messages/config.ts`.

1. Extend the hand-written `McpConfig` type (`config.ts:7-16`, currently missing `oauth` and `timeout`):
   ```ts
   export interface McpOAuthConfig {
     clientId?: string
     clientSecret?: string
     scope?: string
     callbackPort?: number
     redirectUri?: string
   }
   // on McpConfig:
   oauth?: McpOAuthConfig | false | null
   timeout?: number
   ```
2. **Fix the scope bug first.** `McpEditView.update()` (`:27-33`) posts through `updateConfig`, which `splitConfigByScope` routes to the **global** file for every key except `commit_message` — so editing a project-scoped MCP server silently relocates it. Switch `update()` to the scope-aware pattern already used by the enable switch (`AgentBehaviourTab.tsx:702-721`): `mcpConfigScope(name, collections())` → `updateProjectConfig` or `updateGlobalConfig`. Required for the OAuth section to write to the right file.
3. Render an OAuth `Card` **only when `transport() === "remote"`**, after the URL card (`:136-147`):
   - `Select` with Automatic / Disabled / Custom client. Mode derivation: `oauth == null` → automatic; `oauth === false` → disabled; otherwise custom.
   - Custom-only fields: Client ID, Client secret (`TextField` with `type="password"`), Scope, Callback port, Redirect URI (+ help text).
   - Writes: automatic → `update({ oauth: null })` (null becomes an `unset` path via `configUnsetPaths`, `config-utils.ts:42-50`, which is exactly the explicit-removal semantic JetBrains achieves with `"oauth": null`); disabled → `update({ oauth: false })`; custom → `update({ oauth: { ...only non-blank fields } })`.
   - `update()` already spreads `{ ...current, ...partial }`, which is what keeps `headers`/`oauth`/`type` from being dropped by the CLI's `mergeDeep`. **Do not change that spread.**
4. Inline validation, custom mode only: port must parse to `1..65535`; a non-blank client secret requires a non-blank client ID; a non-empty redirect URI must be absolute (`new URL(value)` guarded). Show the error next to the field and skip the config write while invalid.

**Tests** — `tests/unit/mcp-oauth-config.test.ts` over extracted pure helpers (`oauthMode(oauth)`, `oauthPatch(mode, fields)`, `validateOauth(fields)`), covering the round-trip table and the three validation rules. Add a story to `webview-ui/src/stories/settings.stories.tsx` next to `McpEditViewRemote` (`:515`) with a custom OAuth client.

> `settings.agentBehaviour.mcp.oauth.redirectUri.help` contains a URL → run `bun run script/extract-source-links.ts` from the repo root and commit the updated `packages/kilo-docs/source-links.md`.

---

## Task 9 — Skill → MCP bundle removal

Only this direction is missing; MCP → skills already works.

1. New `src/services/marketplace/bundles.ts` — derive bundles with no CLI endpoint, porting `KiloBackendMarketplaceManager.bundles`:
   - `client.app.skills({ directory })` → for each `location`, read the sibling `.kilo-marketplace.json`
   - validate: refuse symlinks, cap the file at **4 KiB**, require `version === 1`, a UUID-shaped `token`, and an id matching `^[A-Za-z0-9_@.\-]+$` that is not `.`/`..` and not a Windows reserved device name (`con|prn|aux|nul|com[1-9]|lpt[1-9]`)
   - scope = `"project"` when the skill path is under the workspace directory, else `"global"`
   - group by `(id, scope)`, skills sorted, result sorted by scope then id
   - Use `vscode.workspace.fs` so the existing `tests/unit/marketplace-actions.test.ts` patching approach works.
2. `KiloProvider` handles `requestMcpBundles` → post `mcpBundles`. Cache it like the other payloads.
3. `AgentBehaviourTab.confirmRemoveSkill` (`:178-201`): look up `session.mcpBundles().find((b) => b.skills.includes(skill.location))`. When found, use `settings.agentBehaviour.removeSkill.bundle.confirm` and post `{ type: "removeMcp", name: bundle.id }` instead of `removeSkill`. `handleRemoveMcp` → `removeMcp(this.removeConfigItemCtx, name)` already deletes the config entry and every companion skill, so no new removal path is needed.
   - Keep removal **immediate**, matching the existing VS Code skills behaviour — do **not** port the JetBrains staged-draft model.
   - `removeMarketplaceItemFromAllScopes` removes from both scopes; that is existing VS Code behaviour and acceptable here.
   - Refresh skills afterwards (`removeSkillViaCli` already does; make sure the `removeMcp` branch triggers `requestSkills` + `requestMcpBundles` too).
4. **Respect the arch guard**: `tests/unit/marketplace-panel-arch.test.ts:28-38` requires sidebar-side removal to stay behind `src/kilo-provider/remove-config-item.ts`, which must not import `MarketplaceService` / `MarketplacePaths` / `McpMarketplaceItem`. Keep `bundles.ts` out of that module's import graph.

**Tests** — `tests/unit/marketplace-bundles.test.ts` over a real temp tree with a project skill and a global skill, each with `{"version":1,"id":"context7","token":"<uuid>"}`, asserting two bundles sorted `global` then `project`. Add rejection cases for a 5 KiB marker, `version: 2`, a non-UUID token, and `id: "../escape"`.

---

## Task 10 — Marketplace inline sign-in

`webview-ui/src/components/marketplace/InstallModal.tsx`.

1. Extend the `marketplaceInstallResult` message with `needsAuth?: boolean` and carry it into the local `result()` state (`:111-131`).
2. In the success branch of the result pane (`:309-315`), when `result().needsAuth`, replace the `Done` footer with a sign-in step:
   - idle: `marketplace.install.mcp.signIn.message` + primary `Sign In` → `session.signInMcp(props.item.id, false)` and secondary `Later` → `props.onClose`
   - waiting (`session.mcpAuth().busy.includes(props.item.id)`): `<Spinner /> marketplace.install.mcp.signIn.waiting` + `Cancel` → `session.cancelMcpSignIn(props.item.id)`
   - on `mcpAuthResult` for `props.item.id`: `connected` → success line + `Done`; `cancelled` → back to idle; anything else → `install-modal-error-msg` with `error ?? marketplace.install.mcp.signIn.failed` and a `Sign In` retry
   - **Use `props.item.id`** (the MCP config key), not `props.item.name`, for every service call; display `props.item.name`.
3. Closing the modal mid-sign-in must not cancel it — the host service keeps running and the prompt-area indicator picks it up.
4. Do **not** add an auth badge to `ItemCard`. JetBrains has none; the three surfaces are the post-install step, Settings, and the prompt menu.

**Tests** — extend `tests/fixtures/marketplace-install-modal.tsx` + `tests/unit/marketplace-install-modal.test.ts`: `needsAuth: true` renders the sign-in step; `needsAuth: false` renders the plain `Done` footer; pressing Sign In posts `signInMcp` with `name === item.id` and `notify === false`; a `mcpAuthResult` with `status: "connected"` shows the success state; `status: "failed"` with an error shows that error text.

---

## Task 11 — i18n

### Sidebar pool — `webview-ui/src/i18n/en.ts` + all 20 siblings (`ar br bs da de es fa fr it ja ko nl no pl ru th tr uk zh zht`)

```
"prompt.issues.title": "Session issues"
"prompt.mcp.provider": "{{name}} MCP"
"prompt.mcp.openSettings": "Open in Settings"
"prompt.mcp.signIn.busy": "Signing in\u2026"
"settings.agentBehaviour.mcp.signIn.cancel": "Cancel sign-in"
"settings.agentBehaviour.mcp.resetAuth": "Reset sign-in"
"settings.agentBehaviour.mcp.resetAuth.title": "Reset MCP sign-in"
"settings.agentBehaviour.mcp.resetAuth.confirm": "Clear the stored sign-in for \"{{name}}\"? You will need to sign in again."
"settings.agentBehaviour.mcp.oauth": "OAuth"
"settings.agentBehaviour.mcp.oauth.help": "Leave on Automatic unless the server requires a pre-registered client. A client secret is stored in your Kilo config file."
"settings.agentBehaviour.mcp.oauth.mode": "Mode"
"settings.agentBehaviour.mcp.oauth.mode.automatic": "Automatic"
"settings.agentBehaviour.mcp.oauth.mode.disabled": "Disabled"
"settings.agentBehaviour.mcp.oauth.mode.custom": "Custom client"
"settings.agentBehaviour.mcp.oauth.clientId": "Client ID"
"settings.agentBehaviour.mcp.oauth.clientSecret": "Client secret"
"settings.agentBehaviour.mcp.oauth.scope": "Scope"
"settings.agentBehaviour.mcp.oauth.callbackPort": "Callback port"
"settings.agentBehaviour.mcp.oauth.redirectUri": "Redirect URI"
"settings.agentBehaviour.mcp.oauth.redirectUri.help": "Defaults to http://127.0.0.1:19876/mcp/oauth/callback and overrides the callback port."
"settings.agentBehaviour.mcp.oauth.port.invalid": "Enter a port between 1 and 65535."
"settings.agentBehaviour.mcp.oauth.secret.invalid": "A client secret requires a client ID."
"settings.agentBehaviour.mcp.oauth.redirectUri.invalid": "Enter a valid redirect URI."
"settings.agentBehaviour.removeSkill.bundle.confirm": "Remove skill \"{{name}}\"? This also uninstalls the {{mcp}} MCP server and every companion skill from the same Marketplace installation."
```

Reuse existing: `common.signIn` (`:329`), `common.cancel`, `mcp.status.*` (`:249-253`).

### Marketplace pool — `packages/kilo-i18n/src/en.ts` + all 19 siblings (no `fa` in this pool)

```
"marketplace.install.mcp.signIn.message": "{{name}} is installed but needs sign-in before its tools can be used."
"marketplace.install.mcp.signIn.button": "Sign In"
"marketplace.install.mcp.signIn.waiting": "Waiting for browser sign-in\u2026"
"marketplace.install.mcp.signIn.cancel": "Cancel"
"marketplace.install.mcp.signIn.skip": "Later"
"marketplace.install.mcp.signIn.success": "Signed in to {{name}}."
"marketplace.install.mcp.signIn.failed": "Sign-in to {{name}} failed."
```

### Rules

- `tests/unit/i18n-keys.test.ts` fails on any key missing from any sibling locale, and only recognises **string-literal** `t("...")` calls — no template literals for keys.
- `tests/unit/i18n-unused-keys.test.ts` fails on unused keys. **Do not port** the five dead JetBrains keys (`prompt.mcp.needsAuth.one/.many`, `prompt.mcp.signIn`, `prompt.mcp.signingIn`, `settings.agentBehavior.mcp.resetAuth.failed`).
- Provide real translations, not English copies. Follow `packages/ui/AGENTS.md` → Localization.

---

## Task 12 — Changeset

`.changeset/vscode-mcp-oauth-sign-in.md`, `kilo-code: minor`. User-facing, imperative, no implementation detail:

> Support OAuth sign-in for MCP servers: prompt to sign in after installing an OAuth-protected server from the Marketplace, surface servers that need sign-in from the chat prompt with recovery actions, and configure a pre-registered OAuth client when a server requires one.

---

## Validation

From `packages/kilo-vscode/`:

```
bun run typecheck
bun run lint
bun run test:unit
bun run knip
bun run check-kilocode-change
bun run compile
bun run format
```

From the repo root:

```
bun run script/extract-source-links.ts     # required: new URL in the redirectUri help string
bun run script/check-md-table-padding.ts
```

Do **not** run root `bun test` (it exits 1 by design). `packages/opencode/` is untouched, so the opencode annotation check is not needed.

Manual check with `bun run extension:isolated`, against a real OAuth MCP (Anaconda):
1. Install from the Marketplace → the install modal shows the sign-in step → browser opens → `Signed in to anaconda.`
2. Decline the sign-in, open a chat → warning icon appears in the prompt toolbar → `Anaconda MCP ▸ Sign In` works, `▸ Open in Settings` lands on the expanded row in Agent Behaviour → MCP Servers
3. Settings → `Reset sign-in` on a connected remote server → row returns to `needs auth`
4. Start a sign-in, press Cancel → no error notification, a second sign-in still works
5. Edit the server URL only → the configured OAuth client survives
6. Remove a companion skill from Settings → Skills → the confirm names the MCP server and removal takes both

## Risks

| Risk | Mitigation |
|---|---|
| Normalization regexes cause false positives and offer Sign In for unrelated failures | Port the full anti-false-positive corpus in Task 1 before anything else |
| Agent Manager worktrees: wrong directory's issues shown in a session | `McpAuthService` is keyed by directory; each `KiloProvider` posts only `getWorkspaceDirectory()`'s state. Verify with two worktree sessions, one with a failing MCP. |
| `KiloProvider.ts` growth (already 6183 lines) | All logic in `src/services/mcp-auth/` and `src/kilo-provider/mcp-oauth.ts`; provider only dispatches |
| Scope fix in `McpEditView` changes behaviour for existing project-scoped servers | It is a bug fix, but call it out in the PR description |
| `authenticate` blocks up to 5 min | Cancel is always reachable (prompt menu, Settings, install modal); the 6 min client timeout cleans up credentials |
| Nested `DropdownMenu.Sub` has no production precedent in this repo | Follow `packages/kilo-ui/src/stories/dropdown-menu.stories.tsx:83-106`; the inner `Portal` is mandatory. Add an a11y check if the submenu misbehaves in the narrow sidebar. |

## Out of scope

- CLI (`packages/opencode/`) changes of any kind
- `mcp.auth.start` + `mcp.auth.callback` (extension-owned browser opening). Keep using the all-in-one `authenticate`, as JetBrains does.
- Auth badges on marketplace cards
- Remote-development loopback redirect limitations (unchanged)
- Porting the JetBrains MCP-side bundle removal (already covered) and the staged-draft Skills model
