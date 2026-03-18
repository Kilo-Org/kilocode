# Multi-Provider Selection — Reimplementation Plan

## Problem Statement

The previous implementation caused a DDoS-like flood of authentication and API requests against external providers (Kilo API, Vercel, etc.). Root causes:

1. **No deduplication on `fetchAndSendProviders()`** — 5+ call sites with no in-flight tracking. Rapid SSE events, webview retries, and initialization code all trigger parallel HTTP requests.
2. **SSE event storms** — Both `global.disposed` and `server.instance.disposed` trigger full state reloads. A single auth change can emit both events, each calling `reloadAfterAuthChange()` which fires 5 parallel endpoint fetches.
3. **Webview retry timer overlaps extension push** — The webview sends `requestProviders` immediately + up to 5 retries at 500ms, overlapping with the extension's own push from `doInitializeConnection()`.
4. **`ModelCache.fetch()` lacks in-flight deduplication** — Only `refresh()` deduplicates. Multiple concurrent provider list requests trigger parallel upstream model fetches.
5. **No login guard** — `startLogin()` has no double-call prevention; calling it while a login is in progress starts a parallel auth flow.

## Architecture Goals

1. **Single in-flight request per resource** — At most one HTTP request in flight for providers, auth states, etc. Additional callers join the existing promise.
2. **Event deduplication** — Collapse rapid SSE events into a single reload cycle with a debounce window.
3. **Request-response pairing** — Provider actions (connect/disconnect/OAuth) use request IDs so the webview can track which response belongs to which action.
4. **Fallback chain for model selection** — CLI config → VS Code settings → recent models → kilo-auto/free.
5. **Clean separation** — Shared validation/types in `src/shared/`, webview utilities in `webview-ui/src/utils/`, no business logic in UI components.

## Implementation Plan

### Phase 1: Shared Modules (Extension + Webview)

#### 1.1 `packages/kilo-vscode/src/shared/provider-model.ts` (NEW)

Constants and helpers shared between extension host and webview:

- `KILO_PROVIDER_ID = "kilo"`
- `KILO_AUTO = { providerID: "kilo", modelID: "kilo-auto/free" }`
- `CUSTOM_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible"`
- `PROVIDER_ID_PATTERN` — regex for valid provider IDs
- `PROVIDER_PRIORITY` — ordered list: `["kilo", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]`
- `parseModelString(raw)` — splits `"provider/model"` into `{ providerID, modelID }` or `null`
- `providerOrderIndex(providerID)` — returns sort index
- `createKiloFallbackProvider()` — creates a minimal Kilo provider entry for when the catalog hasn't loaded

#### 1.2 `packages/kilo-vscode/src/shared/custom-provider.ts` (NEW)

Zod-based validation for custom provider configs (prevents injection of malicious npm packages or MCP servers):

- `ProviderIDSchema` — validates provider ID format
- `CustomProviderConfigSchema` — strict schema with `.strict()` to reject unknown fields
- `sanitizeCustomProviderConfig(provider)` — validates and normalizes, always forces `npm: "@ai-sdk/openai-compatible"`
- `validateProviderID(providerID)` — returns `{ value }` or `{ error }`
- `parseCustomProviderSecret(raw)` — handles plain API keys and `{env:VAR_NAME}` references

### Phase 2: CLI Backend Changes

#### 2.1 New `/auth` GET endpoint (`packages/opencode/src/server/server.ts`)

Add a `GET /auth` endpoint that returns the stored auth type per provider:

```typescript
// Returns: { "kilo": "oauth", "openrouter": "api", ... }
```

This lets the extension show accurate connection status (API key vs OAuth vs env) without exposing credentials. The diff shows this is added inline in `server.ts` as a simple `Auth.all()` → map to type.

#### 2.2 Auth removal cleanup (`packages/opencode/src/auth/index.ts`)

- Also delete the trailing-slash variant (`normalized + "/"`) on remove — prevents stale entries
- On Kilo logout, call `clearLegacyKiloAuth()` to clean up legacy CLI config

#### 2.3 Provider list endpoint fix (`packages/opencode/src/server/routes/provider.ts`)

- Keep Kilo provider even when it has zero models (it always has `kilo-auto/free`)
- Filter `connected` list to only include providers that made it through the validity filter

#### 2.4 Model cache deduplication (`packages/opencode/src/provider/model-cache.ts`)

- Add in-flight deduplication to `fetch()` (not just `refresh()`) — if a fetch is already in flight for a provider, join the existing promise instead of starting a new one

#### 2.5 Device auth shared module (`packages/kilo-gateway/src/auth/device-auth-shared.ts`)

Extract `initiateDeviceAuth()` and `pollDeviceAuth()` into a shared module so both TUI and extension can use them without duplicating HTTP logic. Add proper headers (`DEFAULT_HEADERS`, `buildKiloHeaders()`).

#### 2.6 Legacy migration enhancement (`packages/kilo-gateway/src/auth/legacy-migration.ts`)

- Add `clearLegacyKiloAuth()` export — clears kilo token/org from legacy CLI config file
- Refactor file reading into `readLegacyConfig()` helper

#### 2.7 Headers improvement (`packages/kilo-gateway/src/headers.ts`)

- Fall back to `KILO_EDITOR_NAME` and `KILO_APP_VERSION` env vars for editor name header
- Read `KILO_MACHINE_ID` from env as fallback for machine ID header

### Phase 3: Extension Host (KiloProvider.ts)

#### 3.1 Provider refresh coalescing

Replace the bare `fetchAndSendProviders()` with a coalesced version:

- Track a single `providersRefresh: Promise | null` in-flight promise
- Track a `providersQueued: boolean` flag for pending follow-up requests
- Track a `providersGeneration: number` counter to detect stale results
- When called while a refresh is in-flight, set `providersQueued = true` and await the existing promise
- After a refresh completes, if `providersQueued` is true, do one more refresh cycle
- Check `generation` after each fetch to discard stale results (e.g., if the client changed mid-flight)

This guarantees **at most 2 concurrent HTTP calls** (the in-flight one + one queued re-run) regardless of how many callers trigger a refresh.

#### 3.2 Fetch auth states alongside providers

Extend `fetchAndSendProviders()` to make 3 parallel requests:

1. `client.provider.list(...)` — provider catalog + connected list
2. `client.provider.auth(...)` — auth methods per provider (for OAuth flows)
3. `client.auth.list(...)` — auth states per provider (api/oauth/wellknown)

All 3 use `Promise.all` within the coalesced refresh, so they share the single in-flight slot.

#### 3.3 Default selection with fallback chain

Add `computeDefaultSelection()`:

1. Try CLI config `config.model` (parsed as `provider/model`)
2. Try VS Code settings `kilo-code.new.model.providerID/modelID`
3. Fall back to `KILO_AUTO`

#### 3.4 Provider action handlers

Add message handlers for provider connection actions:

- `handleConnectProvider(requestId, providerID, apiKey)` — calls `auth.set`, then `global.dispose()`, then refreshes providers
- `handleAuthorizeProviderOAuth(requestId, providerID, method)` — calls `provider.oauth.authorize`, returns authorization details
- `handleCompleteProviderOAuth(requestId, providerID, method, code?)` — calls `provider.oauth.callback`, then dispose + refresh
- `handleDisconnectProvider(requestId, providerID)` — calls `auth.remove`, then dispose + refresh
- `handleSaveCustomProvider(requestId, providerID, config, apiKey?)` — validates config, updates global config, sets/removes auth, then refresh

All handlers:

- Validate the provider ID using the shared schema before making any API calls
- Post typed error messages (`providerActionError`) on failure
- Use `disposeGlobal()` helper to safely call `global.dispose()` with error handling

#### 3.5 SSE event deduplication

Change `handleEvent()` to:

- Only handle `global.disposed` (not `server.instance.disposed`) for full reloads
- For `server.instance.disposed`, only reload if the event's `directory` matches this provider's workspace directory
- This prevents foreign-project dispose events from triggering unnecessary reloads

#### 3.6 Login guard

Add guard in `startLogin()` to block re-entry when a login is already in progress (`initiating` or `pending` status).

#### 3.7 Provider refresh after config changes

When `updateConfig` touches `provider`, `disabled_providers`, or `enabled_providers`, also call `fetchAndSendProviders()` so the webview sees the change immediately.

#### 3.8 Recent models persistence

Handle `persistRecents` / `requestRecents` messages to store/load the last 5 used models in `extensionContext.globalState`.

### Phase 4: Webview Context Changes

#### 4.1 Provider context (`context/provider.tsx`)

Extend to store and expose:

- `authMethods: Record<string, ProviderAuthMethod[]>` — from `providersLoaded.authMethods`
- `authStates: Record<string, ProviderAuthState>` — from `providersLoaded.authStates`
- `isModelValid(selection)` — checks if a model exists in a connected provider

Add debug logging to retry loop to track excessive requests.

#### 4.2 Model selection resolution (`context/model-selection.ts`, NEW)

Pure function `resolveModelSelection(input)` implementing the fallback chain:

1. `override` (user-selected model) — validated against catalog
2. `mode` (per-agent config model) — validated
3. `global` (global config model) — validated
4. `recent` (first valid from recent list) — validated
5. `fallback` (`KILO_AUTO`) — always accepted, even if catalog hasn't loaded

Validation means: the provider exists in the catalog AND (it's kilo OR it's in the connected list) AND the model ID exists in the provider's models.

Before providers load (empty catalog), the function returns the first non-null preference without validation — this prevents flickering to kilo-auto on startup.

#### 4.3 Session context (`context/session.tsx`)

- Replace inline model resolution with `resolveModelSelection()`
- Add `recentModels` to store
- Add `pushRecent()` to track used models (deduplicates, caps at 5)
- Load/persist recents via `requestRecents` / `persistRecents` messages

#### 4.4 Server context (`context/server.tsx`)

- Add login guard: skip `startLogin()` if status is already `initiating` or `pending`

#### 4.5 Provider utilities (`context/provider-utils.ts`)

- Add `isModelValid()` — validates a `ModelSelection` against the provider catalog and connected list

### Phase 5: Webview UI Components

#### 5.1 Provider action utility (`utils/provider-action.ts`, NEW)

Request-response pairing for provider actions:

- `createProviderAction(transport)` — returns `{ send, clear, dispose }`
- `send(message, handlers)` — generates a UUID `requestId`, registers handlers, posts the message
- Handlers are one-shot: `onConnected`, `onDisconnected`, `onOAuthReady`, `onError`
- `clear(requestId?)` — drops pending handlers (used when navigating away)
- `dispose()` — clears all handlers and unsubscribes from messages

#### 5.2 Provider catalog (`components/settings/provider-catalog.ts`, NEW)

Static helpers for provider display:

- `POPULAR_PROVIDER_IDS` — re-exports from shared module
- `providerIcon(id)` — maps provider ID to icon name
- `providerNoteKey(id)` — maps provider ID to i18n key for description text
- `sortProviders(items)` — sorts by priority then alphabetically
- `kiloFallbackProvider()` — creates a minimal Kilo provider for when catalog hasn't loaded

#### 5.3 Provider visibility (`components/settings/provider-visibility.ts`, NEW)

- `visibleConnectedIds(connected, authStates)` — filters Kilo from connected list when it has no auth (shows as "popular" instead of "connected")

#### 5.4 Settings restructure (`components/settings/Settings.tsx`)

Split the current "Providers" tab into two tabs:

- **Models** tab — model selection (default model, small model, per-mode models)
- **Providers** tab — provider connection management (connected, popular, custom, disabled)

#### 5.5 Models tab (`components/settings/ModelsTab.tsx`, NEW)

Extracted from the current ProvidersTab:

- Default model selector
- Small model selector
- Per-mode model selectors

#### 5.6 Providers tab (`components/settings/ProvidersTab.tsx`, REWRITTEN)

Full provider management UI (following desktop app patterns):

- **Connected providers section** — shows connected providers with disconnect buttons, tags for auth type
- **Popular providers section** — shows recommended providers with connect buttons
- **Custom provider entry** — opens CustomProviderDialog
- **"Add provider" button** — opens ProviderSelectDialog
- **Disabled providers section** — with ProviderSelector dropdown (replaces the old Select component)
- Inline Kilo device auth card when login is in progress

#### 5.7 ProviderConnectDialog (`components/settings/ProviderConnectDialog.tsx`, NEW)

Multi-step provider connection dialog (mirrors desktop `dialog-connect-provider.tsx`):

1. Method selection (API key, OAuth options)
2. API key input form
3. OAuth code input (opens external URL, user pastes code)
4. OAuth auto (opens external URL, shows confirmation code, auto-completes)

Uses `createProviderAction` for request-response pairing.

#### 5.8 ProviderSelectDialog (`components/settings/ProviderSelectDialog.tsx`, NEW)

Searchable list of all available (unconnected, non-disabled) providers. Grouped into "Recommended" and "Other". Clicking opens the appropriate dialog (Kilo → device auth, custom → CustomProviderDialog, others → ProviderConnectDialog).

#### 5.9 CustomProviderDialog (`components/settings/CustomProviderDialog.tsx`, NEW)

Form for adding OpenAI-compatible providers:

- Provider ID, display name, base URL, API key (with `{env:VAR}` support)
- Dynamic model list (add/remove rows)
- Dynamic header list (add/remove rows)
- Full client-side validation using shared schemas
- Uses `saveCustomProvider` action

#### 5.10 ProviderSelector (`components/settings/ProviderSelector.tsx`, NEW)

Popover-based dropdown for selecting a provider (used in the disabled providers section). Replaces the kilo-ui `<Select>` component with a searchable, keyboard-navigable custom dropdown.

#### 5.11 ModelSelector enhancement (`components/shared/ModelSelector.tsx`)

- Allow opening the selector when `allowClear` is true and a value is set (even if no providers are loaded)
- Add `providerName` to trigger label for non-kilo providers: "OpenAI / GPT-4o"

#### 5.12 DeviceAuthCard enhancement (`components/profile/DeviceAuthCard.tsx`)

- Compact long error messages (truncate, strip HTML)
- Add "Copy error" and "View details" buttons for debugging
- Show full error in a dialog when user clicks "View details"

### Phase 6: Message Types

#### 6.1 Extension → Webview messages (NEW)

- `ProviderOAuthReadyMessage` — `{ requestId, providerID, authorization }`
- `ProviderConnectedMessage` — `{ requestId, providerID }`
- `ProviderDisconnectedMessage` — `{ requestId, providerID }`
- `ProviderActionErrorMessage` — `{ requestId, providerID, action, message }`
- `RecentsLoadedMessage` — `{ recents: ModelSelection[] }`

#### 6.2 Webview → Extension messages (NEW)

- `ConnectProviderMessage` — `{ requestId, providerID, apiKey }`
- `AuthorizeProviderOAuthMessage` — `{ requestId, providerID, method }`
- `CompleteProviderOAuthMessage` — `{ requestId, providerID, method, code? }`
- `DisconnectProviderMessage` — `{ requestId, providerID }`
- `SaveCustomProviderMessage` — `{ requestId, providerID, config, apiKey? }`
- `PersistRecentsRequest` — `{ recents: ModelSelection[] }`
- `RequestRecentsMessage`

#### 6.3 Existing type extensions

- `ProvidersLoadedMessage` — add `authMethods`, `authStates`
- `Provider` — add `source?`, `env?`
- `ProviderConfig` — add `npm?`, `env?`, `options?`

### Phase 7: i18n

Add translation keys for all 16 locales:

- Provider custom dialog labels and errors
- Provider connection dialog labels
- Provider tab section headers
- Device auth error display
- Provider tags (gateway, oauth, configured, custom, connected)

### Phase 8: Tests

#### 8.1 Unit tests

- `custom-provider.test.ts` — validates provider ID, secret parsing, config sanitization
- `model-selection.test.ts` — tests the fallback chain with various provider/connected states
- `provider-action.test.ts` — tests request-response routing, concurrent isolation, stale request cleanup
- `provider-visibility.test.ts` — tests Kilo visibility logic
- `provider-utils.test.ts` — extends with `isModelValid` tests
- `model-selector-utils.test.ts` — updates for new `providerName` parameter and priority changes

#### 8.2 Integration tests

- `kilo-provider-provider-actions.test.ts` — tests the full KiloProvider handler chain with mock client (connect, OAuth, disconnect, custom provider save, provider refresh coalescing)

### Phase 9: Cleanup

- Remove all `console.log("[Kilo TRACK]")` debug statements before final commit
- Remove the `6822-analysis.md` file (unrelated analysis document)

## File Change Summary

| File                                                                                | Action     | Lines (est.) |
| ----------------------------------------------------------------------------------- | ---------- | ------------ |
| `packages/kilo-vscode/src/shared/provider-model.ts`                                 | NEW        | ~35          |
| `packages/kilo-vscode/src/shared/custom-provider.ts`                                | NEW        | ~120         |
| `packages/kilo-vscode/src/KiloProvider.ts`                                          | MODIFY     | +350         |
| `packages/kilo-vscode/webview-ui/src/types/messages.ts`                             | MODIFY     | +80          |
| `packages/kilo-vscode/webview-ui/src/context/provider.tsx`                          | MODIFY     | +25          |
| `packages/kilo-vscode/webview-ui/src/context/provider-utils.ts`                     | MODIFY     | +15          |
| `packages/kilo-vscode/webview-ui/src/context/model-selection.ts`                    | NEW        | ~45          |
| `packages/kilo-vscode/webview-ui/src/context/session.tsx`                           | MODIFY     | +40          |
| `packages/kilo-vscode/webview-ui/src/context/server.tsx`                            | MODIFY     | +5           |
| `packages/kilo-vscode/webview-ui/src/utils/provider-action.ts`                      | NEW        | ~90          |
| `packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts`       | NEW        | ~55          |
| `packages/kilo-vscode/webview-ui/src/components/settings/provider-visibility.ts`    | NEW        | ~10          |
| `packages/kilo-vscode/webview-ui/src/components/settings/Settings.tsx`              | MODIFY     | +10          |
| `packages/kilo-vscode/webview-ui/src/components/settings/ModelsTab.tsx`             | NEW        | ~90          |
| `packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx`          | REWRITE    | ~350         |
| `packages/kilo-vscode/webview-ui/src/components/settings/ProviderConnectDialog.tsx` | NEW        | ~350         |
| `packages/kilo-vscode/webview-ui/src/components/settings/ProviderSelectDialog.tsx`  | NEW        | ~120         |
| `packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx`  | NEW        | ~350         |
| `packages/kilo-vscode/webview-ui/src/components/settings/ProviderSelector.tsx`      | NEW        | ~140         |
| `packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx`           | MODIFY     | +5           |
| `packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts`     | MODIFY     | +15          |
| `packages/kilo-vscode/webview-ui/src/components/profile/DeviceAuthCard.tsx`         | MODIFY     | +80          |
| `packages/opencode/src/server/server.ts`                                            | MODIFY     | +25          |
| `packages/opencode/src/server/routes/provider.ts`                                   | MODIFY     | +5           |
| `packages/opencode/src/auth/index.ts`                                               | MODIFY     | +5           |
| `packages/opencode/src/provider/model-cache.ts`                                     | MODIFY     | +15          |
| `packages/kilo-gateway/src/auth/device-auth-shared.ts`                              | NEW        | ~45          |
| `packages/kilo-gateway/src/auth/device-auth-tui.ts`                                 | MODIFY     | -40          |
| `packages/kilo-gateway/src/auth/device-auth.ts`                                     | MODIFY     | -40          |
| `packages/kilo-gateway/src/auth/legacy-migration.ts`                                | MODIFY     | +30          |
| `packages/kilo-gateway/src/headers.ts`                                              | MODIFY     | +5           |
| `packages/kilo-gateway/src/index.ts`                                                | MODIFY     | +2           |
| `packages/kilo-gateway/src/api/models.ts`                                           | MODIFY     | +2 (debug)   |
| i18n files (16 locales)                                                             | MODIFY     | ~+50 each    |
| Test files (7)                                                                      | NEW/MODIFY | ~800 total   |
| `packages/kilo-vscode/webview-ui/src/stories/StoryProviders.tsx`                    | MODIFY     | +3           |

## Implementation Order

1. **Shared modules** (provider-model.ts, custom-provider.ts) — no dependencies
2. **CLI backend** (server.ts, auth/index.ts, provider.ts, model-cache.ts) — needs shared modules
3. **Gateway** (device-auth-shared.ts, legacy-migration.ts, headers.ts) — independent
4. **Message types** (messages.ts) — needs shared modules
5. **Extension host** (KiloProvider.ts) — needs messages + shared modules
6. **Webview contexts** (provider.tsx, model-selection.ts, session.tsx, server.tsx) — needs messages
7. **Webview utilities** (provider-action.ts, provider-catalog.ts, provider-visibility.ts) — needs contexts
8. **Webview components** (all dialogs, tabs, selectors) — needs everything above
9. **i18n** — can run in parallel with step 8
10. **Tests** — after implementation
11. **SDK regeneration** — after server.ts changes
12. **Cleanup** — remove debug logs
