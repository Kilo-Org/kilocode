# Plan: Pull reasoning variants from models.dev

## Decision

Add an explicit **Pull reasoning variants** action to the custom-provider dialog.

This should use structured `reasoning_options` from models.dev rather than expanding the hardcoded model-family heuristics in `ProviderTransform.variants()`.

The approach has two separate confidence levels:

1. The variant values are catalog data, not guesses. For example, models.dev currently describes OpenAI `gpt-5.2` with `none`, `low`, `medium`, `high`, and `xhigh` effort values.
2. Matching a custom-provider model to the correct models.dev provider entry can be uncertain. Exact provider and model matches can be applied directly; broad name matches must be presented for confirmation.

This means the button is useful and substantially more reliable than family heuristics, but it must not silently configure a fuzzy match.

## Available data

The current models.dev provider catalog includes:

```ts
type ReasoningOption =
  | { type: "effort"; values: Array<string | null> }
  | { type: "toggle" }
  | { type: "budget_tokens"; min?: number; max?: number }
```

Important constraints:

- `reasoning_options` is provider-specific. Different providers serving the same model ID can expose different options.
- `models.json` contains provider-independent model facts but not `reasoning_options`.
- `api.json` and `catalog.json.providers` contain the provider-specific options needed here.
- The repo's `packages/core/src/models-dev.ts` schema does not yet include `reasoning_options`, although the live catalog and current upstream schema do.
- The custom-provider `/models` fetch currently retains only `id` and `name`; it discards `owned_by`, which could help disambiguate matches.

## User flow

1. The user fetches or manually adds models in the custom-provider dialog.
2. The user clicks **Pull reasoning variants** once for the provider, not once per model.
3. Kilo matches all configured models against the cached models.dev provider catalog in one request.
4. The UI shows a stable summary, for example:

   `5 models checked | 3 matched | 11 variants found | 1 needs review | 1 unmatched`

5. Each model gets one compact row:

   - `gpt-5.2: 5 variants, exact OpenAI match`
   - `claude-sonnet-latest: 3 possible matches, review required`
   - `internal-code-model: no catalog match`

6. Exact, high-confidence matches are preselected. Ambiguous or broad matches remain unselected until the user chooses a catalog candidate.
7. **Apply selected** adds the variants to the form. Nothing is persisted until the user saves the custom provider.

The existing detailed per-variant editor remains available after applying suggestions, but it is collapsed by default. This avoids rendering and updating every variant control while discovery is in progress.

## Matching rules

Return candidates with `confidence`, `reason`, and the selected models.dev provider/model identity. Do not return only a guessed variant list.

### High confidence

Preselect these matches:

1. The custom provider `baseURL` matches a models.dev provider API URL after normalizing trailing slashes, and the model ID matches exactly.
2. The fetched model ID is provider-scoped, such as `openai/gpt-5.2`, and both the provider prefix and remaining model ID match exactly.
3. `owned_by` maps to a models.dev provider and the model ID matches exactly. Treat this as high confidence only for recognized provider IDs; LiteLLM deployments may return custom `owned_by` values.

### Medium confidence

Show these as preselected suggestions only when all eligible catalog entries agree on the same non-empty effort list:

1. Exact unscoped model ID match across providers.
2. Exact normalized model name match with the same version and size tokens.

If matching entries disagree, require review instead. For example, catalog providers currently disagree about `gpt-5.2`, and some advertise no configurable reasoning options at all.

### Low confidence

Never preselect these:

1. Prefix or suffix removal, such as matching `team-gpt-5.2-prod` to `gpt-5.2`.
2. Punctuation-normalized aliases, such as `claude-sonnet-4.6` versus `claude-sonnet-4-6`, when multiple provider entries remain.
3. Broad token or fuzzy name matches.

Numeric model version, parameter size, date, and `pro`/`mini`/`flash`/`thinking` qualifiers must match. A broad match must never cross these tokens.

## Mapping catalog options to custom-provider variants

### First version: effort variants only

For `@ai-sdk/openai-compatible` and `@ai-sdk/openai`, map each non-null effort value to:

```json
{
  "low": { "reasoningEffort": "low" },
  "medium": { "reasoningEffort": "medium" },
  "high": { "reasoningEffort": "high" }
}
```

- Add `max` and `default` to the custom-provider form types if the catalog value needs them.
- Skip `null`; omission already represents provider-default behavior.
- Consider skipping catalog `default` as a selectable variant unless it maps to a meaningful provider option.
- Set the model's `reasoning` capability to `true` when applying an effort match.

### Defer toggle and token-budget generation

Do not automatically synthesize variants for these in the first version:

- `toggle` says reasoning can be enabled or disabled, but it does not specify the wire field. Depending on the upstream this may be `enable_thinking`, `thinking`, `chat_template_args`, or another parameter.
- `budget_tokens` supplies a valid range but not meaningful preset values or the provider-specific request field.

Show these capabilities in the summary instead:

- `Thinking toggle available, manual mapping required`
- `Reasoning budget 1,024-32,768, manual mapping required`

A later provider-specific translator can map these shapes when the transport encoding is known.

## Merge behavior

- Never replace an existing variant automatically.
- Add missing catalog variants only.
- If a catalog variant name already exists with different configuration, mark it as a conflict and keep the user's value selected by default.
- Allow the user to choose **Replace**, **Keep existing**, or **Skip model** from the review summary.
- Applying suggestions updates only the dialog form. The normal provider save flow persists the result to `kilo.json`.

This avoids hidden ephemeral state and makes the generated configuration inspectable and portable.

## Backend work

### 1. Preserve models.dev reasoning metadata

- Add `ReasoningOption` and `reasoning_options` to `packages/core/src/models-dev.ts`, aligned with the current models.dev schema.
- Continue using the existing `ModelsDev.Service` cache. Do not fetch the 3 MB catalog separately from the webview.

### 2. Add a Kilo-owned matcher

Create `packages/opencode/src/kilocode/provider/variant-discovery.ts` with pure functions for:

- URL and identifier normalization.
- Candidate collection and confidence classification.
- Agreement checks across exact-ID candidates.
- Converting effort options into target-package variant configuration.
- Merging suggestions with existing model variants without overwriting them.

Keep this out of shared upstream provider code.

### 3. Expose one batch API

Add an instance API endpoint accepting:

```ts
{
  baseURL: string
  npm: "@ai-sdk/openai-compatible" | "@ai-sdk/openai" | "@ai-sdk/anthropic"
  models: Array<{
    id: string
    name?: string
    ownedBy?: string
    variants?: Record<string, Record<string, unknown>>
  }>
}
```

Return, per model:

```ts
{
  modelID: string
  status: "matched" | "review" | "unmatched" | "unsupported"
  selected?: {
    providerID: string
    modelID: string
    confidence: "high" | "medium" | "low"
    reason: string
    variants: Record<string, Record<string, unknown>>
    reasoningOptions: ReasoningOption[]
  }
  candidates: Array<{
    providerID: string
    modelID: string
    confidence: "high" | "medium" | "low"
    reason: string
    reasoningOptions: ReasoningOption[]
  }>
}
```

Regenerate the SDK after adding the endpoint.

## Extension and UI work

### 1. Preserve provider ownership metadata

Update `packages/kilo-vscode/src/shared/fetch-models.ts` to retain optional `owned_by` as `ownedBy` in fetched model entries and pass it through the dialog's temporary fetched-model state.

Do not persist `ownedBy` into the provider model configuration; it is matching evidence only.

### 2. Add the batch action

- Add **Pull reasoning variants** beside the model section actions in `CustomProviderDialog.tsx`.
- Send all current models in one request.
- Keep the previous model cards mounted while the request runs to avoid flicker.
- Show a spinner only in the button and summary area.

### 3. Add a compact review summary

Use a collapsed summary card with:

- Total models checked.
- Models matched.
- Effort variants found.
- Ambiguous matches requiring review.
- Unsupported toggle/budget-only models.
- Unmatched models.

Expand a row only when the user wants to inspect candidates or resolve a conflict. Do not render every variant editor in the discovery result.

## Testing

### Unit tests

- Exact base URL plus exact ID selects the matching provider entry.
- Provider-scoped IDs select the correct catalog provider.
- Exact unscoped IDs auto-select only when all eligible effort lists agree.
- Conflicting exact-ID entries require review.
- Fuzzy aliases never auto-apply.
- Numeric/version qualifiers cannot be crossed during normalization.
- Effort values map to `reasoningEffort` for OpenAI-compatible providers.
- Toggle and budget-only entries are reported but not synthesized.
- Existing variants are preserved and conflicts are reported.

### Integration tests

- The endpoint reads `reasoning_options` from the cached models.dev catalog.
- A fetched LiteLLM model with `owned_by: "openai"` receives the expected exact candidate.
- An internal alias returns review candidates without changing configuration.

### Manual test

- Add a LiteLLM provider and fetch several models.
- Pull reasoning variants and confirm the summary remains stable while loading.
- Apply an exact GPT match and verify the effort variants appear in the existing editor.
- Verify an ambiguous Claude alias requires selection.
- Save, reopen the provider, and confirm applied variants persisted.

## Scope recommendation

Implement the explicit, catalog-backed button with effort variants first. Do not broaden the runtime hardcoded heuristics as part of this work.

This delivers a reliable variant list after a user-approved catalog match, gives useful summaries for every model, and avoids pretending that broad LiteLLM alias matching is authoritative.
