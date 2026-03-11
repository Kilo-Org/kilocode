# Multi-Provider Model Selection - VS Code Extension

## Goal

Add robust multi-provider model selection to the new VS Code extension using the same overall resolution pattern as the desktop app, but with a Kilo-first product decision:

1. top-of-composer model selector wins
2. CLI-configured model is the default when no UI override exists
3. `kilo/kilo-auto/free` is the final product fallback
4. if nothing is actually usable, the UI falls back to `No providers` instead of showing a fake model

## What Already Exists

- The selector is already in the prompt chrome at `packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx:575`.
- Provider catalogs already come from the CLI backend via `provider.list()` into `packages/kilo-vscode/webview-ui/src/context/provider.tsx`.
- CLI config already reaches the webview through `packages/kilo-vscode/webview-ui/src/context/config.tsx`.
- The desktop reference behavior lives in `packages/app/src/context/local.tsx:92`.

This means the main work is not new UI. The work is making model resolution deterministic, validated, and shared across the sidebar and Agent Manager consumers.

## Review Of The Current Draft

### What is correct

- Reusing the existing top selector is the right approach.
- Validating models against the current provider catalog is required.
- Using CLI config as the primary default source is the right product behavior.
- Persisting recent models is reasonable if we want desktop-like fallback behavior.

### What should change before implementation

1. Do not make `KiloProvider` the authoritative place for CLI model fallback.
   - The current draft adds `computeDefaultSelection()` in `packages/kilo-vscode/src/KiloProvider.ts`.
   - That duplicates logic already available in `configLoaded` and introduces a startup race because `fetchAndSendProviders()` and `fetchAndSendConfig()` run in parallel.
   - The webview `SessionProvider` should remain the single source of truth for CLI-based model resolution.

2. Do not return synthetic invalid selections.
   - The current draft always falls through to `provider.defaultSelection()` and then `KILO_AUTO`.
   - That prevents the selector from ever reaching a true "no valid model" state.
   - Result: the trigger can show raw strings like `kilo-auto/free` instead of `No providers`.

3. Use one shared resolver everywhere.
   - The current draft resolves selection in multiple places (`selected`, `configModel`, `getSessionModel`, sync effect).
   - Any path that reads raw `store.modelSelections[...]` can still leak invalid overrides after a provider disconnects.
   - The sidebar and Agent Manager should both go through the same validated resolver.

4. If we keep recents, update them on selection, not only on send.
   - Desktop pushes recent models when the user selects a model in the selector, not only when a message is sent.
   - Updating recents only on send means failed sends pollute recents and simple model switches never become fallback candidates.

5. Keep `kilo/kilo-auto/free` as the v1 fallback, not a generic provider default.
   - The desktop app uses `recent -> provider default`.
   - The user request here is more opinionated: top selector -> CLI selection -> Kilo auto.
   - A generic provider-default fallback can be a later enhancement, but it should not replace the explicit Kilo fallback in v1.

## Current Implementation Risks In The Draft Diff

1. `selected()` validates overrides, but `getSessionModel()` still returns raw stored overrides.
   - That can leak stale models into Agent Manager flows.

2. `resolveDefault()` never returns `null`.
   - That breaks the existing `No providers` label path in `packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts:34`.

3. `computeDefaultSelection()` races with `configLoaded`.
   - On first load the provider message can still be built before CLI config is cached.

4. `isModelValid()` currently mixes visibility and usability.
   - The product may want Kilo models to stay visible even when not connected.
   - That does not necessarily mean those models are valid as an automatic fallback.

## Recommended V1 Fallback Chain

Use the first valid result from this chain:

1. UI override from the selector
2. per-agent CLI config (`config.agent.<agent>.model`)
3. global CLI config (`config.model`)
4. recent model, if we decide to keep desktop-like recents
5. `kilo/kilo-auto/free`
6. `null`

`null` is important. It preserves the existing `No providers` UI state instead of forcing a misleading raw model label.

## Validity Rules

Treat these as separate concepts:

- `visible`: a model can appear in the selector
- `usable`: a model is safe to auto-select or send

For fallback resolution we care about `usable`, not just `visible`.

Minimum `usable` rules:

- provider exists in the current provider map
- model exists under that provider
- provider is actually usable for requests

If Kilo should remain visible even while disconnected, keep that behavior in selector filtering only. Do not automatically treat visibility as fallback validity.

## Implementation Plan

### Phase 1: Centralize Resolution Logic

Add a small pure helper for model selection resolution, for example:

- `packages/kilo-vscode/webview-ui/src/context/model-selection.ts`

The helper should own:

- parsing `provider/model` strings
- validating usability
- resolving the fallback chain

The helper should return `ModelSelection | null`.

This should then be used by:

- `selected()`
- `configModel()`
- `getSessionModel()`
- the sync effect that initializes per-agent selections

### Phase 2: Keep CLI Resolution In The Webview

In `packages/kilo-vscode/webview-ui/src/context/session.tsx`:

- use `configLoaded` data as the authoritative CLI source
- resolve defaults in one place only
- allow the resolved value to become `null`
- never read raw `store.modelSelections[agent]` without passing it back through the shared resolver

In `packages/kilo-vscode/src/KiloProvider.ts`:

- keep provider loading focused on provider data
- if a `defaultSelection` field remains, treat it as an extension-owned fallback only
- do not duplicate CLI precedence logic there unless we explicitly serialize config loading before provider loading

### Phase 3: Recent Models (Optional But Recommended)

If we want desktop parity, persist recent models through extension `globalState`.

Implementation notes:

- keep the storage in extension `globalState` because the webview is ephemeral
- load recents through `requestRecents` / `recentsLoaded`
- update recents when the user selects a model, not only when a message is sent
- deduplicate and cap at 5 entries

If we want the smallest possible v1, this phase can be skipped and added after the basic fallback chain lands.

### Phase 4: Preserve No-Provider Behavior

Make the resolved model nullable all the way through the UI.

That ensures:

- `ModelSelector` can show `No providers`
- the selector stays disabled when no usable providers exist
- we do not show raw fallback strings for models that are not actually available

### Phase 5: Agent Manager Consistency

Even though the initial request is about the main extension chat, the session context is shared.

The same resolver should be used for:

- sidebar chat model display
- sidebar send path
- Agent Manager session model lookups

This avoids one surface showing a fallback while another still holds an invalid stale override.

## Tests To Add

Add focused unit coverage for the resolver matrix.

Suggested cases:

1. valid UI override wins
2. invalid UI override falls back to per-agent CLI config
3. invalid per-agent config falls back to global CLI config
4. invalid CLI config falls back to recent model when enabled
5. invalid recent model falls back to `kilo/kilo-auto/free`
6. invalid Kilo auto fallback returns `null`
7. no-provider state renders `No providers`
8. stale override does not leak through `getSessionModel()`

## Recommended Delivery Order

1. land the shared resolver + tests
2. switch `SessionProvider` consumers to the shared resolver
3. make null/no-provider behavior correct
4. add recent model persistence if we still want desktop parity

## Bottom Line

The overall direction is correct, but the current draft is a little too coupled to `KiloProvider` and never truly reaches an invalid state. The cleanest version is:

- keep the selector where it is today
- resolve defaults in the webview from CLI config
- keep Kilo auto as the explicit final fallback
- allow `null` when nothing is usable
- optionally add desktop-style recents after the core chain is correct
