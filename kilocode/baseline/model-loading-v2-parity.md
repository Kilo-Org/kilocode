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

The v1 CLI TUI at the Kilo repo's `origin/main` `ecccd1f` uses Favorites, Recent, and Kilo Recommended (`packages/tui/src/kilocode/model-picker.ts`); it has no Most Used group. VS Code’s separate Most Used section persists a count/timestamp usage map (`packages/kilo-vscode/src/kilo-provider/model-usage.ts`), so it is not a CLI acceptance requirement and native CLI Recents remain the equivalent surface.

## Routed Auto target

V1’s `packages/opencode/src/session/llm/ai-sdk.ts` reads the gateway's `finish-step` response model, rather than inferring a target from catalog `autoRouting`. Default/OpenRouter Auto entries use the Kilo-owned `packages/ai/src/kilocode/openrouter-routed.ts` provider. Explicit OpenAI-compatible Auto entries now use the Kilo-owned `packages/ai/src/kilocode/openai-compatible-routed.ts` provider, which reuses the native OpenAI-compatible Chat protocol route/parser seam with the same Kilo-owned routed wrapper: it retains only the actual response model alongside native parser state, adds it to terminal metadata under the same `kilo` provider-metadata namespace, lifts source settings into providerOptions through a supported-option allowlist (the OpenAI-compatible reasoning/generation fields such as `reasoningEffort`), and strips the closed Kilo account key set from the `http.body` overlay exactly like the OpenRouter wrapper. Both wrappers reuse their native request body and OpenAI Chat framing/parser; neither duplicates parsing, tees the response, or invents a target from the request ID. Core already persists the route's metadata namespace as public assistant `providerState`; the sidebar only renders it for the latest settled Kilo Auto assistant.

The local launched-host fixture uses the normal Kilo host registration (no fixture plugin injection), a fake authenticated Gateway SSE stream with `model: "provider/actual"` on an earlier chunk but not the terminal chunk, and public `message.list`. It proves both provider paths preserve `routedModelID`, requests retain the selected Auto ID rather than the routed ID, and no routed state appears for an ordinary Kilo model. Both native wrappers retain raw usage metadata rather than deleting it to force the retired AISDK extractor's smaller routedModelID-only object shape, so compatible Auto assistants now carry usage fields alongside `routedModelID` in `providerState`. Unit coverage rejects unsafe response/display strings and hides a prior Auto target when a newer ordinary assistant has settled; the retired extractor-composition cases went away with the alias. This is sidebar selector coverage, not a full terminal rendering test.

The native wrappers use the existing file-URL provider seam, resolved per installation by `import.meta.resolve` from Kilo CLI's explicit workspace AI dependency. Bare dynamic imports otherwise resolve inside `util`, which does not depend on AI. No shared Core provider registry override was added. Source-launched execution is verified; the preview bootstrap build is not proof of a fully distributed interactive package, whose packaging row remains open — the compiled-artifact probe found `import.meta.resolve` file-URL specifiers throw in a compiled headless bundle, so packaging remains a separate tracked gate rather than a current source-mode break. The compatible runtime alias (`@ai-sdk/openai-compatible/kilo`), its SDK-hook metadata extractor, and its provider-option key derivation are removed; compatible Auto is a native route like the OpenRouter Auto wrapper. Neither path has a live deployment canary.

Because Core's model resolver merges credential metadata into the resolved settings (and, for key credentials, the body overlay) before calling the wrapper's `model()`, the OpenRouter wrapper lifts source settings into OpenRouter `providerOptions` through a supported-option allowlist (`debug`, `models`, `plugins`, `provider`, `reasoning`, `usage`, `web_search_options` — source `user` is deliberately excluded as it collides with profile metadata; explicit `providerOptions` overlays pass through unchanged) and strips the closed Kilo account key set from the `http.body` overlay; the compatible wrapper applies the same isolation with the OpenAI-compatible option allowlist. Unit coverage proves the compiled body and the actual transport wire body both exclude server/organizationID/email/profile/token while preserving routing, reasoning, and BYOK `api_keys` header payloads.

Both wrappers share one Kilo-owned helper module, `packages/ai/src/kilocode/routed.ts`: the closed account key set and body isolation, the bounded response-model reader, the terminal routedModelID metadata decoration, and the routed chat-protocol wrapper. Only the per-dialect option allowlists, settings shapes, and facades remain per route. Explicit `extraBody` config passes both wrappers through unchanged — provenance reviewed — while only Core's merged body overlay is isolated; because the closed account set includes top-level `name`/`user`, a deliberately configured body `name` or `user` is also stripped, the same documented collision the Gateway hook already records. The launched-host fixture's account sentinels include the live loopback Gateway origin and an exact serialized `server` key, so a server-field regression cannot hide behind an inert placeholder host.

## Gateway catalog discovery

The original v2 Gateway transform only rewrote headers and the base URL for models already present in the native catalog; its Kilo-model RPC could label those rows but could not create API-only Auto or catalog models. The Kilo Gateway now fetches the same authenticated personal (`/api/openrouter/models`) or selected-team (`/api/organizations/:id/models`) catalog during its account refresh and adds each supported model through `editor.model.update`. The source record fields follow the Kilo repo's v1 `ecccd1f` `packages/kilo-gateway/src/api/models.ts`: `name` and a positive integer `context_length` are required, malformed optional `autoRouting` is discarded per record, explicit non-tool models are excluded, and context/output limits plus input/output modalities are mapped. Prices must parse as a complete finite numeric string and remain finite after conversion from per-token to dollars per million; overflowing and suffix-bearing values become unknown rather than a branded infinity. Missing architecture gets conservative text-only capabilities rather than the native image-capable default.

The snapshot is retained only inside one successful refresh and is discarded before every reload; there is no cross-account, cross-server, or cross-organization cache. A failed or empty personal fetch leaves the explicit native baseline available. A failed or empty selected-team fetch disables all native Kilo rows for that scope, instead of leaking personal/static models into the team selection. Existing account selection and credential events already cause the refresh, so the same selected organization header and base URL apply to new entries.

Gateway remains host-agnostic: the catalog chooses a native-compatible provider package, while the Kilo CLI registers its routed-model plugin after the post-phase Gateway plugin to add Auto response metadata. A direct Gateway test covers API-only Auto creation, field mapping, required-field rejection, malformed-routing tolerance, conservative capabilities, nonfinite-price omission, the exact team request scope, unsupported-tool exclusion, failed-team eviction, and personal fallback. A launched Kilo host test confirms that a configured `providers.kilo.models.<id>.disabled: true` remains disabled even when that API-only model is discovered; the model-picker TUI fixture additionally performs a successful personal→team switch, proves team inventory replacement, and checks a fresh cold metadata state before showing team groups. Routed SSE coverage separately proves the enabled dynamic Auto path.

The Gateway now forwards source `hasUserByokAvailable` and `mayTrainOnYourPrompts` exactly through `KiloModels.Entry`, including explicit `false`; absent source data remains absent, so no privacy or BYOK state is inferred. It also maps v1 `opencode.variants` into the public `Model.Variant` overlays. Source variants are applied first and an existing variant with the same ID wins, matching v1's configured-model precedence and avoiding a dynamic catalog refresh overwriting local configuration. The direct Gateway test covers an API source variant, configuration collision, both disclosure fields, and strict price rejection. The launched Kilo-host fixture selects the API's `high` Auto variant and proves the fake Gateway receives OpenRouter `reasoning.effort: "high"` or compatible `reasoning_effort: "high"`, according to the selected protocol. This is request-path coverage rather than catalog-shape-only coverage.

API-derived `name`/`limit`/`cost`/`capabilities` enrichment follows the v1 config fold: explicitly configured fields win, and every other model (API-only, native-baseline default, or static) takes the current account's API values. The plugin Context cannot reach the location-scoped Config service, so the embedding host injects a `configEntries` reader (`GatewayOptions.configEntries`, resolved through `LocationServiceMap`) that the Gateway folds — lowest to highest priority — into an explicit-field map at setup and on every `config.updated` (name, whole cost/capabilities, and each `limit` subfield independently, mirroring the host fold's shallow limit merge). The transform runs after ConfigProvider on each rebuild, so preservation needs no stale cross-rebuild memory and account refresh replaces non-explicit values deterministically. Direct coverage: API-only/default enrichment, configured-field precedence, account refresh without stale retention, and config-update re-reads. The hook ordering also keeps security routing (baseURL, organization headers, activation) always applied.

`opencode.prompt` remains unsupported. The [prompt audit](model-prompt-v2-audit.md)
corrects the earlier blanket claim that v2 has no usable prompt seam: a context
hook exists, but several historical prompt assets assume nonexistent tools or
conflict with v2 delegation rules. Tolerantly dropping the selector preserves
native v2 guidance until those assets and precedence are properly adapted.

## Catalog-selected protocols

The source audit found that the cloud repo's dev-line HEAD `c32be17d` and the cloud repo's `origin/main` at `08c4887fa68738f19089284101084f404eb6c9b8` (the Kilo repo's own `origin/main` is the unrelated `ecccd1f`; these are different repositories and the SHAs are not interchangeable)
catch-all route support Chat Completions, Responses and Messages through the
Gateway alias. This is source evidence, **not deployed endpoint verification**.
The catalog's closed `opencode.ai_sdk_provider` enum now selects the matching
native v2 provider, without model-name heuristics or another SDK dependency:

| Source tag | Native compatibility package | Gateway suffix |
|---|---|---|
| `anthropic` | `aisdk:@ai-sdk/anthropic` | `/messages` |
| `openai` | `aisdk:@ai-sdk/openai` | `/responses` |
| `openai-compatible` | `aisdk:@ai-sdk/openai-compatible` | `/chat/completions` |
| `openrouter`, absent or malformed | `aisdk:@openrouter/ai-sdk-provider` | `/chat/completions` |

An explicit configured model package still wins over this catalog-derived
choice, matching v1 config precedence; only an otherwise-unpackaged catalog
model receives the source-selected native package. The Kilo Auto wrapper then
recognizes the native OpenRouter package without changing explicit protocol
choices.

Three source-backed request deltas live in the existing public HTTP request
hook, scoped to Kilo and the loaded Gateway server's exact POST endpoints.
Anthropic key authentication promotes the SDK's existing `x-api-key` to the
Bearer header expected by Kilo, winning over any configured or foreign
`Authorization` header exactly like v1's unconditional Bearer override; an
existing OAuth Bearer without `x-api-key` is retained. Gateway request bodies
(`/messages`, `/chat/completions`, `/responses`) are stripped of the closed
reserved Kilo account/credential key set at the top level only, because Core's
model resolver merges credential metadata into model settings and (for key
credentials) the request-body overlay before any adapter serializes a request.
Nested provider routing (`provider`, `models`), BYOK payloads, reasoning, and
arbitrary user content are preserved; stripping reserved top-level `user`/`name`
is a documented collision — neither is a supported Kilo Gateway dialect field.
Stateless Responses requests additionally drop `item_reference` entries and
provider item IDs, matching v1 `kilo-gateway/src/responses.ts`, while retaining
encrypted reasoning; `store:true` keeps item references but is not a
credential-hygiene exemption. Malformed JSON and foreign endpoints are not
rewritten. No credential is added to a catalog, model settings, or RPC response.

Resolved boundary: an independent source review corrected the earlier claim
that title generation bypasses the hook middleware — `session/title.ts` runs
through `SessionContext.prepare`, which is `SessionModelRequest.prepare`, so
its `StreamOptions.http` middleware applies the hook there too. The only real
bypass was the compatible Auto alias `@ai-sdk/openai-compatible/kilo`, kept on
the AISDK adapter for its routedModelID metadata extractor; AISDK-adapter
transports (`packages/core/src/aisdk.ts` `modelFromLanguage`) never apply
`StreamOptions.http`. That alias is retired: compatible Auto models resolve to
the Kilo-owned native `packages/ai/src/kilocode/openai-compatible-routed.ts`
route, which isolates credential metadata at the provider-package boundary and
transports through the same hook middleware as every other native route. The
launched-host gate `routed-model-title-leak.test.ts` is converted from the
known-failing bypass measurement into a positive all-wire regression: the
fixture requires a title request, both Auto requests, and the ordinary request
to be present, and asserts every wire body excludes the reserved account
fields and the credential itself. Startup and fixture-marker failures fail the
test normally.

The normal execution-host fixture (`test/gateway-protocol.test.ts`) runs two
requests through each source-selected protocol with deliberately opaque model
IDs, checks settled assistant history and Bearer/team headers, and verifies
encrypted reasoning survives the stateless Responses replay with item IDs
removed. It then switches to personal scope where the same model ID has a
different protocol, proving both its transport and organization header refresh.
All endpoints are loopback fixtures; no account or paid inference is used.
The direct Gateway suite covers this batch with its execution-host protocol
integration coverage kept separate; the launched routed-model host additionally
imports a hostile-metadata key credential and asserts every wire body —
title, both Auto paths, and ordinary — excludes account fields and the
credential itself.
