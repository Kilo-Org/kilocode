# TUI Custom OpenAI-Compatible Provider Wizard

## Goal

Mimic the VS Code extension's custom provider dialog in the CLI/TUI. Today the TUI's "Connect a provider" → "Other" flow only stores an API key and tells the user to hand-edit `kilo.json`. Replace it with a guided wizard that collects the provider definition, auto-fetches models, and persists everything — plus edit/delete for existing config-defined custom providers.

## Decisions (resolved with user)

- **Surface**: TUI wizard only. No new `kilo auth` CLI flags/subcommands.
- **Scope**: Core fields — id, name, baseURL, API key (with `{env:VAR}` support), models auto-fetched from `{baseURL}/models` with manual entry fallback. `npm` fixed to `@ai-sdk/openai-compatible`. No headers, no npm-package choice, no per-model variants/modalities in the wizard (those remain config-file-only and must be preserved on edit since the config update merges).
- **Config target**: Global config only (`~/.config/kilo/kilo.json` via `PATCH /global/config`), exactly like the extension.
- **Operations**: Add + edit + delete.

## Background / verified facts

- Extension reference implementation (source of truth to port from):
  - `packages/kilo-vscode/src/shared/custom-provider.ts` — zod schema, `parseCustomProviderSecret` (`{env:VAR}` → `env` array), `withCustomProviderDeletions` (null-sentinel patch), `resolveCustomProviderAuth` (`set|clear|preserve`).
  - `packages/kilo-vscode/src/provider-actions.ts` — `saveCustomProvider` (lines ~425–491) and `removeCustom` (~265–281).
  - `packages/kilo-vscode/src/shared/fetch-models.ts` — `fetchOpenAIModels`: `GET {baseURL}/models`, `Authorization: Bearer <key>`, 15s timeout, returns `{id, name}[]`.
  - Extension id pattern: `/^[a-z0-9][a-z0-9-_]*$/` (`packages/kilo-vscode/src/shared/provider-model.ts`).
- CLI runtime already supports the config shape; no server/SDK changes needed:
  - Config schema: `ConfigProviderV1.Info` in `packages/core/src/v1/config/provider.ts` (`npm`, `name`, `env`, `options.baseURL`, `options.apiKey`, `models`; npm defaults to `@ai-sdk/openai-compatible` at `packages/opencode/src/provider/provider.ts:1424-1429`).
  - SDK v2 (`@kilocode/sdk/v2`, used by the TUI) exposes `global.config.get/update`, `global.dispose()` (`POST /global/dispose`), `auth.set`/`auth.remove`.
  - TUI sync store already holds the global config at `sync.data.globalConfig` (kilocode_change, `packages/tui/src/context/sync.tsx:90`).
- Existing TUI flow to modify: `packages/tui/src/component/dialog-provider.tsx` — "Other" option (`CUSTOM_PROVIDER_OPTION_VALUE`, `promptCustomProviderID`, `ApiMethod` credential-only path at lines ~84–121, 402–409).
- Kilo TUI overrides live in `packages/opencode/src/kilocode/cli/cmd/tui/component/` (imported from shared TUI files via the `@/kilocode/...` alias; `packages/tui/tsconfig.json` maps `@/*` → `../opencode/src/*`). Files under `kilocode` need no `kilocode_change` markers.

## Data flow (mimics extension `saveCustomProvider`)

1. Wizard collects: id (add only), name, baseURL, API key (or `{env:VAR}`), models.
2. Fetch global config, build patch with null sentinels for removed models/keys (port of `withCustomProviderDeletions`).
3. `sdk.client.global.config.update({ config: { provider: { [id]: patch }, disabled_providers: <id removed> } })`.
4. Key handling (port of `resolveCustomProviderAuth`): `{env:VAR}` → keep `env: [VAR]` in config + `auth.remove(id)`; new key → `auth.set(id, {type:"api", key})`; blank on edit → preserve.
5. `sdk.client.global.dispose()`, `sync.bootstrap()`, then `dialog.replace(() => <DialogModel providerID={id} />)`.
6. Delete: `global.config.update({ provider: { [id]: null }, disabled_providers: <id removed> })` + `auth.remove(id)` + dispose + bootstrap.

Config written (must match runtime schema exactly):

```jsonc
{
  "provider": {
    "vllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "vLLM",
      "env": ["MY_VAR"],                // only when key entered as {env:MY_VAR}
      "options": { "baseURL": "http://host:8000/v1" },
      "models": { "qwen35": { "name": "Qwen 3.5" } }
    }
  }
}
```

## Tasks (in order)

1. **Pure logic module** — new file `packages/opencode/src/kilocode/cli/cmd/tui/component/custom-provider.ts` (no JSX, unit-testable):
   - `PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/`, `normalizeProviderID` (trim, strip `@ai-sdk/` prefix — keep parity with existing `normalizeCustomProviderID`).
   - `validate(form)` → `{ npm, name, env?, options: { baseURL }, models }` | error string (port of extension `validateCustomProvider`, core fields only; baseURL must be http/https; ≥1 model).
   - `parseSecret(value)` → `{ kind: "env", name } | { kind: "key", key } | { kind: "preserve" }` (port of `parseCustomProviderSecret`).
   - `buildPatch(existing, sanitized)` → config patch with explicit `null`s for removed models/keys (port of `withCustomProviderDeletions`).
   - `fetchModels(baseURL, key)` → direct `fetch` of `{baseURL trimmed of trailing /}/models` with `Authorization: Bearer` when key present, 15s `AbortSignal.timeout`, map to `{id, name}[]` (port of extension-host `fetchOpenAIModels`).
2. **Wizard UI** — new file `packages/opencode/src/kilocode/cli/cmd/tui/component/dialog-custom-provider.tsx`:
   - `launchCustomProvider(opts)` exported entry supporting add mode and edit mode (prefill from `sync.data.globalConfig.provider[id]`).
   - Steps via existing `DialogPrompt`/`DialogSelect`: provider id (add only; error if already in global config `provider` map) → display name → baseURL → API key (placeholder: add = "API key or {env:VAR}"; edit = "leave blank to keep current") → model step.
   - Model step: attempt `fetchModels`; show looping `DialogSelect` with ✓ toggles on selected models, an "Add model manually" entry, and a "Done" entry; on fetch failure toast + fall back to manual-only. Require ≥1 model. In edit mode, preserve existing per-model config (limit/reasoning/variants/etc.) for model ids still selected; drop (null-sentinel) deselected ones.
   - Save pipeline and delete function per Data flow above, with toast error handling (reuse `errorMessage` from `@/util/error`).
3. **Hook into shared dialog** — `packages/tui/src/component/dialog-provider.tsx`, one `kilocode_change` block:
   - "Other" `onSelect` → call `KiloProvider.launchCustomProvider({ dialog, mode: "add" })` instead of the credential-only `ApiMethod` path (remove/replace `promptCustomProviderID` usage for this option).
   - Provider `onSelect` → before the auth-method flow, if `sync.data.globalConfig.provider?.[providerID]` exists, show a `DialogSelect` with "Select model" (existing behavior/`DialogModel`), "Edit provider", "Delete provider" (with a confirm prompt); otherwise fall through unchanged.
   - Keep the shared-file diff minimal; all logic lives in the kilocode files.
4. **Tests** — new file `packages/opencode/test/kilocode/cli/cmd/tui/component/custom-provider.test.ts`:
   - id normalization/validation, baseURL validation, `{env:VAR}` vs key vs preserve parsing.
   - `buildPatch`: removed model → `null` sentinel; removed `env` → `null`; untouched fields preserved.
   - `fetchModels`: success mapping, non-2xx/timeout error path (use a local `Bun.serve` fixture, no mocks of implementation logic).
5. **Docs** — update `packages/kilo-docs/pages/ai-providers/openai-compatible.md`: document the TUI wizard (Connect a provider → Other → guided steps) alongside the manual config example.
6. **Changeset** — `bunx changeset add`, `minor` for `@kilocode/cli`, user-facing description e.g. "Add a guided TUI wizard for creating, editing, and deleting custom OpenAI-compatible providers (Connect a provider → Other)".

## Failure modes / edge cases

- Duplicate id in add mode → toast error; user must pick another id or select the existing provider to edit.
- Model fetch failure (offline, auth required, non-OpenAI server) → manual model entry must still work.
- Edit mode with key stored in `auth.json` → never read/echo the key; blank preserves.
- Provider edited that has config-file-only fields (headers, variants) → merge semantics preserve them; do not strip unknown keys when sanitizing for edit prefill.
- `disabled_providers` containing the id → scrub it on save/delete (extension parity).

## Validation

- `bun run typecheck` from `packages/tui/`.
- `bun test` from `packages/tui/` (ensure existing dialog tests pass).
- `bun test test/kilocode/cli/cmd/tui/component/custom-provider.test.ts` from `packages/opencode/`.
- `bun run script/check-opencode-annotations.ts` from repo root (shared `packages/tui` file uses `kilocode_change` markers; kilocode dirs are exempt).
- Manual smoke: `bun run dev` → `/connect` → Other → add a provider against a local OpenAI-compatible endpoint (or `http://localhost:11434/v1` Ollama), verify model selectable; edit and delete round-trip; inspect `~/.config/kilo/kilo.json`.

## Out of scope

- Non-interactive CLI commands/flags for provider management.
- npm package selection (`@ai-sdk/openai` / `@ai-sdk/anthropic`), custom headers, per-model variants/modalities editing in the TUI.
- Project-level (`.kilo/kilo.jsonc`) custom providers via the wizard.
