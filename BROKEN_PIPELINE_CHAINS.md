# BROKEN_PIPELINE_CHAINS Review

## Scope and Method

Reviewed only end-to-end semantic pipeline chains for PR #13368 at head `5d120f0696a83b354804e0848f1c1af4b0088a4f`, against Kilo base `6175210c0fd0092a86aa475e4d8d7616711a1464` and pristine upstream v1.18.18 `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`. Traced every `kilocode_change` in PR-changed shared files and custom behavior in changed Kilo-owned files through producers, intermediate state/types/options/events, and final consumers or effects. Searched call sites beyond the diff and ran focused implementation tests and static checks.

## Findings

### P2: Unknown-field warnings are dropped for every trusted config source

**Chain:** trusted config text or object -> `loadFile`/`loadConfig` -> `Excess.keys` -> optional `configWarnings` accumulator -> `Config.Service.warnings()` -> `/config/warnings` and post-edit config validation.

`loadConfig` detects excess keys only inside `if (configWarnings)` at `packages/opencode/src/config/config.ts:335-347`. Project files pass the instance accumulator at `packages/opencode/src/config/config.ts:707`, but trusted sources do not: global files at `packages/opencode/src/config/config.ts:415-421`, `KILO_CONFIG` at `packages/opencode/src/config/config.ts:687`, trusted config directories at `packages/opencode/src/config/config.ts:758-764`, `KILO_CONFIG_CONTENT` at `packages/opencode/src/config/config.ts:828-836`, org config at `packages/opencode/src/config/config.ts:868-876`, managed files at `packages/opencode/src/config/config.ts:898`, and managed preferences at `packages/opencode/src/config/config.ts:909-917`. The final warning consumer is real: `packages/opencode/src/kilocode/config-validation.ts:142-148` reads `Config.Service.warnings()` and surfaces the result in edit/write/apply-patch output; the HTTP warning route consumes the same state.

At the base, `ConfigParse.schema` rejected excess top-level keys, so trusted-source loading either produced a caught warning or failed that source. Upstream v1.18.18 intentionally changed parsing to ignore unknown fields. HEAD's Kilo adaptation preserves valid project config while warning, but only for untrusted/project paths. A typo such as `modle` in `~/.config/kilo/kilo.json`, `KILO_CONFIG`, enterprise configuration, or org configuration is now silently removed and never reaches any warning consumer.

Static execution at HEAD confirmed the split: `ConfigParse.schema(ConfigV1.Info, { model: "test/model", unknownField: true }, "trusted")` returned `{"model":"test/model"}`, while `Excess.keys` returned `["unknownField"]`; without the omitted accumulator that detectable issue is discarded. The new regression test covers only `.kilo` project config (`packages/opencode/test/kilocode/config-resilience.test.ts:372-392`), so it does not exercise a trusted source.

**Impact:** global, environment-selected, organization, and managed configuration typos silently fall back to defaults. This weakens Kilo's existing resilient-config contract and can hide material misconfiguration while the rest of the file appears to load successfully.

**Minimal direction:** pass the per-instance `warnings` accumulator through every trusted `loadConfig`/`loadFile` call made during `loadInstanceState`, or return excess-key diagnostics from parsing and merge them into instance warnings independently of trust. Add one global or `KILO_CONFIG_CONTENT` regression test proving both that valid fields load and the unknown field is reported.

**Provenance:** introduced by Kilo's adaptation of upstream's unknown-field compatibility change, including the incomplete follow-up in `5d120f0696`.

### P2: The upstream five-retry cap silently overrides Kilo's configured retry limit

**Chain:** `KILO_SESSION_RETRY_LIMIT` -> `Flag.KILO_SESSION_RETRY_LIMIT` -> `KiloSessionProcessor.retryOpts().limit` -> spread into `SessionRetry.policy` -> retry schedule -> provider requests and retry status events.

Kilo computes the remaining configured budget at `packages/opencode/src/kilocode/session/processor.ts:205-214`, forwards it from the production processor at `packages/opencode/src/session/processor.ts:967-980`, and checks it first at `packages/opencode/src/session/retry.ts:148-152`. The newly merged unconditional `RETRY_MAX_RETRIES = 5` check at `packages/opencode/src/session/retry.ts:31,157` then terminates the same schedule even when the explicit Kilo limit is higher.

An executed schedule using `limit: 10` produced retry attempts `[1,2,3,4,5]`, not ten. Existing Kilo tests establish that any positive integer is accepted and that the configured value controls the provider budget (`packages/opencode/test/kilocode/session-processor-retry-limit.test.ts:238-265`), but the changed tests cover the default five-attempt cap and a configured value of only two; they do not test a configured limit above five.

**Impact:** installations that deliberately set `KILO_SESSION_RETRY_LIMIT` above five now stop early, contrary to the explicit runtime override. This is most visible with transient provider failures where operators chose a larger retry budget.

**Minimal direction:** make the upstream five-attempt value the default only when Kilo's limit is unset, or compute one authoritative effective limit before constructing the schedule. Add a production-policy test with `KILO_SESSION_RETRY_LIMIT=10` (and retain the default-five test).

**Provenance:** introduced by the upstream retry-cap change and not reconciled with Kilo's pre-existing configurable limit during adaptation.

## Human Verification

### Retained `defaultModel` UI type has no Kilo producer or consumer

Upstream added `NormalizedProviderListResponse.defaultModel` in `packages/session-ui/src/context/data.tsx:8-12` as part of a standalone-app fix. Its upstream producer and consumers lived in `packages/app`, which Kilo intentionally omits. Kilo's retained VS Code producer at `packages/kilo-vscode/webview-ui/src/App.tsx:77-80` still supplies only `all`, `connected`, and per-provider `default`; no retained `session-ui` code reads `defaultModel` either. This is currently a one-sided type addition rather than a demonstrated runtime regression.

Human verification is needed on product intent: if VS Code should adopt upstream's "current server default beats legacy config" behavior, the producer and model-selection consumer are missing. Otherwise this field is inert fork residue and should not be treated as shipped Kilo behavior.

## Notable Non-Findings

- Compaction and recovery are wired end to end. Selected history and prior summaries flow through `buildPrompt`; plugin context remains outside serialized conversation; `render` is re-run after payload stripping and chunk reduction; the resulting summary is persisted, auto-continuation/replay remains connected, and compatibility compaction events carry `include` through the schema and event storage. Focused payload recovery, chunk fallback, projector, and message-updater tests passed.
- Prompt selection is consumed. Muse IDs render `{{MODEL_NAME}}` as Spark or Glimmer, official Kimi provider IDs select the Kimi prompt, and `SystemPrompt.provider` feeds the request system messages. Focused system tests passed.
- Provider reasoning and capability chains are connected. Models.dev reasoning metadata becomes variants, selected variants merge into request options, MERGE Gateway options are remapped to `mergeGateway`, and the Groq/Mistral/xAI patches are registered in `package.json`/`bun.lock` and produce the expected wire fields in executed SDK tests. DeepSeek V4 Flash `topP` reaches `LLMRequest.prepare`; Copilot discovery's PDF flag reaches the model capability and `ProviderTransform.message`, which preserves supported PDFs and converts unsupported ones to an explanatory text part.
- Project-local unknown fields remain non-fatal and visible: `Excess.keys` adds a warning while decoded known fields continue loading. Config resilience and post-edit validation tests passed.
- Retry jitter, default five-attempt termination, retry status updates, offline handling hooks, and the existing configured limit at or below five remain connected and tested.
- Core compaction prompt, full-message boundary selection, persistence event projection, and released-reader `include` compatibility are all exercised by focused tests.

## Commands and Results

- `git merge-base 6175210c... 5d120f0696...` -> `6175210c0fd0092a86aa475e4d8d7616711a1464`; local `HEAD` and GitHub PR head both remained `5d120f0696a83b354804e0848f1c1af4b0088a4f`.
- `gh pr view 13368 --repo Kilo-Org/kilocode ...` -> base/head match the supplied SHAs; `MERGEABLE`, merge state `BLOCKED`; all reported CI checks completed successfully or were neutral/skipped.
- `bun run typecheck` in `packages/opencode` -> pass.
- `bun run typecheck` in `packages/core` -> pass.
- Config tests: `131 pass, 0 fail` across `config.test.ts`, `config-resilience.test.ts`, and `config-validation.test.ts`.
- Retry tests: `56 pass, 0 fail` across `retry.test.ts` and `session-processor-retry-limit.test.ts`.
- Provider/system tests in `packages/opencode`: `543 pass, 0 fail` across transform, provider, Copilot models, and system prompt tests.
- Provider patch/core compaction tests: `98 pass, 0 fail` across Groq, Mistral, xAI, core compaction, and session runner tests.
- Compaction/recovery combined run: `76 pass, 1 skip, 1 timeout`; the sole timeout was `serializes repeated compaction history as one user message` at the test's 5-second boundary during concurrent load. The exact test passed alone: `1 pass, 0 fail` in 4.99 seconds. Classified as load-sensitive, not a demonstrated semantic failure.
- Compatibility event tests: `12 pass, 0 fail` in core; message-updater/context tests: `10 pass, 3 skip, 0 fail` in opencode.
- `bun run script/check-opencode-annotations.ts --base 6175210c...` -> guard intentionally reported `Skipping shared upstream annotation check — upstream merge detected.` CI's annotation check is successful.
- Direct retry schedule with `limit: 10` -> `[1,2,3,4,5]`, confirming the finding.
- Direct config decode/excess probe -> `{"parsed":{"model":"test/model"},"excess":["unknownField"]}`, confirming that parsing drops a key the warning helper can detect.
- `git diff --check 6175210c.....5d120f0696...` -> pass.

## Limitations

- This was only the BROKEN_PIPELINE_CHAINS lens, not a full merge review or conflict-resolution audit.
- No live provider credentials or real user configuration/state were used. Provider verification used actual installed SDK implementations with local request capture.
- Trusted-source warning loss was proven from executed parsing plus production call-site tracing; no diagnostic source edit was made to inject a global config because the review contract allowed only the requested report file.
- The standalone upstream app/desktop packages are intentionally absent in Kilo, so the retained `defaultModel` type's desired VS Code product behavior cannot be inferred from compilation or upstream tests.
- Other review agents created `CONFIG_REGRESSION.md` and `OPENCODE_MENTIONS.md` while this review ran. They were not read, modified, or removed.

No GitHub state was mutated, and no commit or push was performed.
