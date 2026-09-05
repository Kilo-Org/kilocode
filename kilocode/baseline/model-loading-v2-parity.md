# Model-picker loading parity — 2026-09-05

This documents the bounded v2 fix for the Kilo model picker’s first-render reorder.

## Delivered behavior

- Opening a picker containing a Kilo catalog begins with a nonactionable `Loading Kilo model metadata…` state. Native model rows, filtering, selection, and actions remain unavailable until the request settles, so a user cannot select a row that later moves underneath the input.
- A successful metadata response groups only native Kilo catalog IDs: Kilo Auto from `kilo-auto/*` or legacy `auto-small`, and Recommended from actual `recommendedIndex` entries. `autoRouting` names targets for an Auto model; it does not make a regular model Auto.
- A metadata failure unlocks the normal native inventory, without fabricating recommendation data, and identifies that fallback in the dialog footer.
- Changing the location/catalog aborts the prior request; an aborted response cannot update the replacement dialog state.

## Scope and cache decision

The existing optional host presentation seam also carries a row footer, without
changing model identities or inference settings. Kilo renders source-positive
`BYOK` and `May train` disclosures (the exact v1 CLI labels) alongside native
Free labels. Favorites and Recents retain those disclosures. The real renderer
verifies both labels disappear when the account changes to a team whose catalog
does not report them; missing/false metadata never claims a privacy guarantee.
This uses the native row layout, not a port of the full v1 model-info panel.

`kilocode.models.list` makes its authenticated selected-account decision in the Gateway but returns only `KiloModels.Entry[]`. The response contains no account, organization, token, catalog revision, or other invalidation identity. A location is not an account identity and must not be used as one.

Accordingly, this slice deliberately adds **no metadata cache**. Every new picker effect asks the RPC for current metadata and passes the current location. It may be optimized only after the RPC supplies a proven account/catalog invalidation identity.

## Evidence and remaining gates

Loopback TUI coverage exercises delayed metadata, grouping, ready no-match rendering, and reopening after a confirmed close with native favorite behavior; the fixture asserts a second fresh metadata RPC on that reopen. A focused picker test confirms abort propagation, failure propagation to the TUI fallback boundary, and that each invocation passes its current location. It does not use an account or inference provider.

The v1 CLI TUI at `ecccd1f` uses Favorites, Recent, and Kilo Recommended (`packages/tui/src/kilocode/model-picker.ts`); it has no Most Used group. VS Code’s separate Most Used section persists a count/timestamp usage map (`packages/kilo-vscode/src/kilo-provider/model-usage.ts`), so it is not a CLI acceptance requirement and native CLI Recents remain the equivalent surface.

## Routed Auto target

V1’s `packages/opencode/src/session/llm/ai-sdk.ts` reads the gateway's `finish-step` response model, rather than inferring a target from catalog `autoRouting`. V2 normally maps an `aisdk:@ai-sdk/openai-compatible` model with a base URL to its native OpenAI-compatible adapter before an AISDK SDK hook can observe response chunks. The Kilo-owned routed plugin therefore gives only Kilo Auto catalog entries the internal `aisdk:@ai-sdk/openai-compatible/kilo` runtime package. It keeps the selected catalog ID and outbound request model unchanged, replaces the compatible SDK after its native hook, and merges only a bounded response `model` into the route's `openai-compatible/kilo` provider-metadata namespace. Core already persists that namespace as public assistant `providerState`; the sidebar only renders it for the latest settled Kilo Auto assistant.

The local launched-host fixture uses the normal Kilo host registration (no fixture plugin injection), a fake authenticated Gateway SSE stream with `model: "provider/actual"`, and public `message.list`. It proves `providerState: { routedModelID: "provider/actual" }`, that requests retain the selected Auto ID rather than the routed ID, and no state for an ordinary Kilo model. The unit coverage also rejects unsafe response/display strings, preserves pre-existing extractor metadata, rejects non-Auto capture, and hides a prior Auto target when a newer ordinary assistant has settled. This is sidebar selector coverage, not a full terminal rendering test.

The list-only response has no account/catalog invalidation identity, so caching beyond a picker lifetime remains out of scope. The internal runtime-alias technique relies on current v2 generic OpenAI-compatible hook and metadata-key derivation; an upstream change there needs a regression review. This bounded local contract has no live deployment canary.

## Gateway catalog discovery

The original v2 Gateway transform only rewrote headers and the base URL for models already present in the native catalog; its Kilo-model RPC could label those rows but could not create API-only Auto or catalog models. The Kilo Gateway now fetches the same authenticated personal (`/api/openrouter/models`) or selected-team (`/api/organizations/:id/models`) catalog during its account refresh and adds each supported model through `editor.model.update`. The source record fields follow v1 `ecccd1f` `packages/kilo-gateway/src/api/models.ts`: `name` and a positive integer `context_length` are required, malformed optional `autoRouting` is discarded per record, explicit non-tool models are excluded, and context/output limits plus input/output modalities are mapped. Prices must parse as a complete finite numeric string and remain finite after conversion from per-token to dollars per million; overflowing and suffix-bearing values become unknown rather than a branded infinity. Missing architecture gets conservative text-only capabilities rather than the native image-capable default.

The snapshot is retained only inside one successful refresh and is discarded before every reload; there is no cross-account, cross-server, or cross-organization cache. A failed or empty personal fetch leaves the explicit native baseline available. A failed or empty selected-team fetch disables all native Kilo rows for that scope, instead of leaking personal/static models into the team selection. Existing account selection and credential events already cause the refresh, so the same selected organization header and base URL apply to new entries.

Gateway remains host-agnostic: it preserves the configured compatible SDK package for API-only Auto rows. The Kilo CLI registers its routed-model plugin after the post-phase Gateway plugin, so its catalog transform sees dynamically created Auto entries and applies the Kilo CLI-only runtime adapter there. A direct Gateway test covers API-only Auto creation, field mapping, required-field rejection, malformed-routing tolerance, conservative capabilities, nonfinite-price omission, the exact team request scope, unsupported-tool exclusion, failed-team eviction, and personal fallback. A launched Kilo host test confirms that a configured `providers.kilo.models.<id>.disabled: true` remains disabled even when that API-only model is discovered; the model-picker TUI fixture additionally performs a successful personal→team switch, proves team inventory replacement, and checks a fresh cold metadata state before showing team groups. Routed SSE coverage separately proves the enabled dynamic Auto path.

The Gateway now forwards source `hasUserByokAvailable` and `mayTrainOnYourPrompts` exactly through `KiloModels.Entry`, including explicit `false`; absent source data remains absent, so no privacy or BYOK state is inferred. It also maps v1 `opencode.variants` into the public `Model.Variant` overlays. Source variants are applied first and an existing variant with the same ID wins, matching v1's configured-model precedence and avoiding a dynamic catalog refresh overwriting local configuration. The direct Gateway test covers an API source variant, configuration collision, both disclosure fields, and strict price rejection. The launched Kilo-host fixture selects the API's `high` Auto variant and proves the fake Gateway receives `reasoning_effort: "high"`, so this is request-path coverage rather than catalog-shape-only coverage.

Two `ecccd1f` `opencode` extensions remain intentionally unsupported. `prompt` selects V1 session system-prompt files (`packages/opencode/src/session/system.ts`), but v2 exposes no safe model-owned prompt selector. `ai_sdk_provider` selects a V1 provider constructor (`anthropic`, `openai`, or compatible) in `packages/opencode/src/kilocode/provider/provider.ts`; guessing a v2 package or runtime adapter would change transport behavior. Both fields are decoded tolerantly, like V1's `.catch(undefined)`, and neither is sent into a request. Their parity needs an explicit v2 model/runtime contract rather than a catalog-only conversion.
