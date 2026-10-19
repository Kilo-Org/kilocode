# Gateway model-prompt policy v2 parity

Prompt-selector policy parity for the catalog `opencode.prompt` closed enum. Read against Kilo
`origin/main` `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`, the audit in
[model-prompt-v2-audit](model-prompt-v2-audit.md), and the v2 source at `61a8707c03`.

## What landed

- `packages/kilo-cli/src/model-prompt-policy.ts` (Kilo-owned). A post-phase
  `ctx.session.hook("context")` plugin gated to the `kilo` provider. For all eight catalog closed-enum
  tags (`anthropic`, `trinity`, `anthropic_without_todo`, `codex`, `gemini`, `ling`, `gpt55`, `beast`)
  it replaces `event.system[0]` with the appropriate maintained, verified, or adapted v2 asset while
  preserving native composition (instruction/project/history parts and native OpenAI appends). For
  unknown tags and Object prototype names, it makes no override and leaves the native heuristic or
  default baseline in place.
- `packages/kilo-cli/test/model-prompt-policy.test.ts` + `model-prompt-policy-fixture.ts` (Kilo-owned).
  Direct unit tests for `promptFor` and a real launched interactive-server against a loopback
  `Bun.serve` Gateway under bundled Bun 1.4.0, asserting on captured wire request bodies.
- `packages/kilo-gateway/test/prompt-selector.test.ts` (Kilo-owned). Direct Gateway tests driving
  `registerGateway` with multiple Locations across all 8 closed-enum selectors.

## Selector dispositions (all eight catalog enum values)

| Catalog selector | Disposition | Justification & implementation |
|---|---|---|
| `anthropic` | Maintained v2 asset | Reuses `SystemPromptPlugin.AnthropicPrompt` via public export. |
| `trinity` | Maintained v2 asset | Reuses `SystemPromptPlugin.TrinityPrompt` via public export. |
| `anthropic_without_todo` | Verified v2 equivalent | In v1, this tag mapped to `default.txt` (the baseline prompt) rather than `anthropic.txt`. On v2, it restores the native v2 baseline via `SessionSystemPrompt.make(tools)` with actual tool guidance, overriding conflicting `claude` heuristics without legacy tool names. |
| `codex` | Adapted v2 asset | Source-backed port of v1 `codex.txt` (`origin/main` `ecccd1f`), adapting actual v2 tool names (`read`, `edit`, `write`, `glob`, `grep`, `shell`), removing `apply_patch` (replaced with `edit`/`write`), and removing `Bash`. Composes cleanly with native `OpenAIPlugin` (`gpt-extension.txt`) append at `system[1]`. |
| `gemini` | Adapted v2 asset | Source-backed port of v1 `gemini.txt`, adapting background shell execution to the v2 `background: boolean` parameter on `shell` (replacing `&` in command strings), adapting file-path arguments to the `path` parameter, replacing `Bash` with `shell`, replacing guaranteed confirmation-dialogue claims with respecting actual configured permission rules and user refusals, and preserving all core engineering mandates and workflows. |
| `ling` | Adapted v2 asset | Source-backed port of v1 `ling.txt`, omitting the non-existent shell `description` schema parameter requirement, adapting long-running processes to `background: true` on `shell`, replacing `Bash` with `shell`, and preserving all objectivity, edit stop-signal, and brevity rules. |
| `gpt55` | Adapted v2 asset | Source-backed port of v1 `kilocode-gpt-5.5.txt`, adapting tool names to v2 (`read`, `edit`, `write`, `glob`, `grep`, `shell`), removing `apply_patch`, and reconciling subagent delegation with native v2 delegation rules (replaces proactive Task delegation with adhering to configured delegation rules and avoiding proactive subagent spawning). Composes with native `OpenAIPlugin` (`gpt-extension.txt`) append. |
| `beast` | Adapted v2 asset | Source-backed port of v1 `beast.txt`, preserving autonomous iteration, thorough reflection, and rigorous verification, while replacing legacy Task/Todo assumptions and mandatory recursive web crawling with native v2 tools (`glob`, `grep`, `edit`, `write`, `shell`) and omitting mandatory recursive web crawling and hardcoded `.github/instructions/memory.instruction.md` paths. |

## Selector provenance — typed reader, not family

The catalog tag is not read from `Model.Info.family` or any catalog field. `family` is not
`opencode.prompt` provenance, and no implicit family→selector mapping or Gateway family
overwrite is used anywhere. The plugin takes a typed reader the host injects:

```ts
export type ModelPromptSelector = (location: Location.Ref, model: Model.Ref) => string | undefined

createModelPromptPolicy({ selector })
```

`selector` is called per context event with the plugin's own activation `Location` (mapped the
same way as the Gateway's `configuredLocation`: directory plus optional workspace identity) and
the event's model reference, and returns the current `opencode.prompt` tag for that Location, or
`undefined` when the Location's Gateway cache carries none. The plugin does no fetch, no cache,
and no `model.settings` writes; the reader is the only source of the tag. Only verified or adapted
selectors map to an asset (`promptFor`); unknown values resolve to no override.

## Location-scoped metadata handoff (implemented)

`createGatewayPlugin` activates per Location and each activation owns its own account-scoped
catalog cache (`loaded.current.models`), so a single host variable overwritten by the last setup
would be wrong. The handoff is a host-owned, Location-keyed reader registry:

- `packages/kilo-gateway/src/models.ts` — `CatalogModel.prompt?: GatewayPrompt`, decoded
  tolerantly from the already-parsed `opencode.prompt` with a closed v1-enum schema
  (`Schema.Literals` of the pinned eight values, `decodeUnknownOption` per record). A malformed
  or out-of-enum value decodes to no tag and the model is kept. The tag is never written into
  model family, settings, or credentials.
- `packages/kilo-gateway/src/gateway.ts` — `GatewayOptions.promptSelector?: { register(location,
  read): Effect<void, never, Scope.Scope> }`.
- `packages/kilo-gateway/src/plugin.ts` — `registerGateway` calls `register` once per activation
  with `configuredLocation(ctx.location)` and a reader that reads `loaded.current?.models`
  directly (no duplicated selector map or second cache). The reader reports no selector whenever
  the cache is absent (failed or revoked scope), matching the catalog transform. Registration is
  yielded inside the plugin scope so the host's cleanup runs on Location teardown.
- `packages/kilo-cli/src/interactive-server.ts` (root-owned) — a per-launch `Map` keyed by
  `JSON.stringify([location.directory, location.workspaceID ?? null])`; the `register` callback
  sets the reader and adds a scope finalizer that removes it only when it is still the registered
  reader (an obsolete scope cannot remove a successor). The policy is registered post-phase after
  the Gateway with `selector: (location, model) => readers.get(key(location))?.(model.id)`.

## Shared-file exception (root-approved Option A)

The maintained Anthropic/Trinity v2 assets were not publicly resolvable from `kilo-cli` (the
core package map is `"./*" -> "./src/*.ts"` and the `.txt` files are only imported relatively
inside core). Root approved a narrow marked exception: two added public exports of the existing
assets in the shared file `packages/core/src/plugin/system-prompt.ts`:

- `packages/core/src/plugin/system-prompt.ts:38-42` — a `kilocode_change` comment plus
  `export const AnthropicPrompt = PROMPT_ANTHROPIC` (line 41) and
  `export const TrinityPrompt = PROMPT_TRINITY` (line 42).

No text was copied, no package `exports` map was edited, and the native
`SystemPromptPlugin.Plugins` behavior is unchanged. The policy imports them via
`SystemPromptPlugin.AnthropicPrompt` / `SystemPromptPlugin.TrinityPrompt`, so a future upstream
edit to the assets propagates without a kilo-cli change.

## Composition guarantees (tested)

The native v2 composition is preserved, not cleared:

- Custom `agent.system` always wins: a truthy custom agent system skips the override entirely,
  mirroring the native replace plugins (`ctx.agent.get(...).data.system` guard).
- Only the base part `event.system[0]` is replaced; instruction, project, history, and native
  supplementary parts (e.g. the environment block, baseline tool-guidance, and native OpenAI appends)
  survive into the request.
- Native heuristic plugins still run first (they are internal `pre` builtins; this plugin is a
  post-phase SDK registration), so an untagged model keeps the native heuristic or
  native-default result, and an explicit tag wins over a conflicting model-name heuristic.
- Models with `codex` tag and a name matching the `gpt` heuristic receive both the adapted Codex
  base prompt at `system[0]` and the native `OpenAIPlugin` append (`gpt-extension.txt`) at `system[1]`.
- Models with `anthropic_without_todo` tag and a name matching the `claude` heuristic override
  the native Anthropic heuristic back to the native baseline with tool-dependent guidance.

## Test coverage

**Launch acceptance** — `packages/kilo-cli/test/model-prompt-policy.test.ts` +
`model-prompt-policy-fixture.ts` run under the bundled `dist/interactive/bun` 1.4.0. The fixture
launches the real interactive-server with the production `promptSelector` wiring (no test-only
registry) against a loopback `Bun.serve` Gateway that serves `opencode.prompt` tags in its
catalog records, and asserts on captured wire request bodies:

| Case | Model id | Catalog tag | Expected base / composition |
|---|---|---|---|
| Tag beats no heuristic | `tagged-anthropic` | `anthropic` | Anthropic asset |
| Trinity tag | `tagged-trinity` | `trinity` | Trinity asset |
| Tag beats conflicting name heuristic | `conflict-claude-trinity` | `trinity` | Trinity asset, not claude/Anthropic |
| anthropic_without_todo beats claude heuristic | `tagged-without-todo-claude` | `anthropic_without_todo` | Native baseline prompt with tool guidance, not Anthropic asset |
| Codex adapted prompt | `tagged-codex` | `codex` | Adapted Codex asset (v2 tool names, no apply_patch, no Bash) |
| Codex + GPT composition | `tagged-codex-gpt` | `codex` | Adapted Codex base + native `OpenAIPlugin` gpt-extension append |
| Gemini adapted prompt | `tagged-gemini` | `gemini` | Adapted Gemini asset (v2 tool schemas, background: true, path parameter) |
| Ling adapted prompt | `tagged-ling` | `ling` | Adapted Ling asset (omits shell description requirement, background: true) |
| Gpt55 adapted prompt | `tagged-gpt55` | `gpt55` | Adapted GPT-5.5 asset + native `OpenAIPlugin` gpt-extension append |
| Beast adapted prompt | `tagged-beast` | `beast` | Adapted Beast asset (v2 tools, deep autonomy, no mandatory web crawling) |
| Unknown/out-of-enum tag | `tagged-unknown` | `unknown-selector` | Native default baseline |
| Untagged keeps native heuristic | `heuristic-claude-opus` | none | Native Anthropic (claude) heuristic |
| Custom agent wins | `tagged-anthropic` + `ask` agent | `anthropic` | Custom `ask` system |
| Preservation | `tagged-anthropic` | `anthropic` | Environment block + tool-guidance retained |
| Account/location refresh | `tagged-anthropic`, team→personal | `anthropic`→`trinity` | Override follows personal tag; team header dropped |
| Account/location refresh (without_todo) | `tagged-without-todo-claude`, team→personal | `without_todo`→`anthropic` | Override follows personal tag to Anthropic asset |
| Account/location refresh (codex) | `tagged-codex`, team→personal | `codex`→`without_todo` | Override follows personal tag to native baseline |
| Account/location refresh (gemini) | `tagged-gemini`, team→personal | `gemini`→`ling` | Override follows personal tag to Ling asset |
| Account/location refresh (ling) | `tagged-ling`, team→personal | `ling`→`gemini` | Override follows personal tag to Gemini asset |
| Account/location refresh (gpt55) | `tagged-gpt55`, team→personal | `gpt55`→`beast` | Override follows personal tag to Beast asset |
| Account/location refresh (beast) | `tagged-beast`, team→personal | `beast`→`gpt55` | Override follows personal tag to GPT-5.5 asset |

**Direct Gateway tests** — `packages/kilo-gateway/test/prompt-selector.test.ts` drives the real
`registerGateway` with two simultaneous Locations and a host registry mirroring the production
wiring (JSON-tuple key, exact-reader scoped cleanup). It covers: independent per-Location readers
with no last-setup overwrite; live-cache reads across all 8 closed-enum tags (`anthropic`, `trinity`,
`anthropic_without_todo`, `codex`, `gpt55`, `gemini`, `ling`, `beast`); out-of-enum and non-string
tags decoding to no selector without dropping the model; the tag never reaching the materialized
record's family/settings/headers; no per-request fetch (models endpoint hit only on refresh); and
scoped disposal (closing one Location's scope removes only its reader and cannot clobber a sibling or
successor). A second test covers a failed/revoked account cache clearing the selector while the
Location reader stays registered.

## Validation

- Bundled Bun 1.4.0 launch acceptance (`packages/kilo-cli/test/model-prompt-policy.test.ts`): 2 passed (61 assertions).
- Direct Gateway tests (`packages/kilo-gateway/test/prompt-selector.test.ts`): 2 passed (38 assertions).
- Full Gateway test suite (`packages/kilo-gateway/test/`): 65 passed across 6 files (697 assertions).
- Typecheck: clean for `packages/kilo-gateway` (`tsgo --noEmit`) and `packages/core` (`tsgo -b tsconfig.json tsconfig.tests.json`).
- Kilo-cli prompt policy files (`src/model-prompt-policy.ts`, `test/model-prompt-policy.test.ts`, `test/model-prompt-policy-fixture.ts`) have zero type errors.

## Whole-row remaining gates

The Gateway prompt-policy capability acceptance is complete across all eight closed-enum selectors:
- 2 maintained v2 assets (`anthropic`, `trinity`)
- 1 verified v2 equivalent (`anthropic_without_todo` → native baseline with tool guidance)
- 5 source-backed adapted assets (`codex`, `gemini`, `ling`, `gpt55`, `beast` → adapted to actual v2 tool schemas)
- 0 unported selectors remaining.

Remaining whole-row gates for Row 5 (Gateway catalog, BYOK, org routing):
- The Auto acceptance item from the canonical plan ("verify eligible catalogs and unavailable selections across real scopes, and show a routed model only when response metadata actually supplies it") has local loopback fixture verification, but product-level deployed-account verification remains an open question/interpretation.
- Whole-row closure remains subject to root acceptance; no fabricated completion count or premature whole-row closure is claimed.

### Constraint preservation — final parent review

The Beast adaptation explicitly respects user constraints (including local-only
work), cancellation, denied tools and unavailable capabilities. Persistence is
conditional on those boundaries; blocked work is disclosed rather than falsely
claimed complete. URL retrieval requires permitted network access. Direct and
real loopback wire assertions pass: 2 tests / 62 assertions.
