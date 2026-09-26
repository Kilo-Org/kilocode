# OpenCode mentions — PR #13513

## Scope and method

Reviewer 3/7, branding and OpenCode-web-property lens only. Reviewed all 59 changed paths, including complete handwritten production diffs, changed prompt/documentation text, package/lock metadata, test literals, generated SDK files, and unchanged context in the changed files. Followed suspect strings into CLI and builtin-skill registration, OAuth rendering, web-search descriptions/transports, provider listing, retry-action UI, and committed OpenAPI. Read root/package guidance, `REVIEW.md`, `kilo-steer`, merge-review guidance, merge-minimizer guidance, and `script/upstream/README.md`.

Compared the actual base to HEAD, pristine upstream `.18` to `.20`, pristine/transformed upstream to HEAD, and both final merge parents to HEAD; used pinned main as an additional provenance control, not as this stacked PR's base. Performed read-only Git-blob assertions rather than initializing the application or installing dependencies.

**Verdict: safe to merge for this lens. No verified merge-introduced user-facing OpenCode identity or OpenCode-link regression.** This is not a verdict on the other six review lenses. Existing residual branding and a non-blocking product-policy ambiguity are separated below.

Pins verified locally and against read-only PR metadata:

| Reference | SHA |
|---|---|
| Actual base / merge base, `johnnyeric/kilo-opencode-v1.18.18` | `bf1cf502a3c511e9daf6a43244568ae4e83473a8` |
| Reviewed HEAD | `6a7d6bc002319ac2987bcde3d6c63efcafc07021` |
| Pinned main control | `62998965e9fb0d9ed89011c62498b39801dbbb4f` |
| Pristine upstream v1.18.18 | `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d` |
| Pristine upstream v1.18.19 | `2b72179c663cadcb54f54d9f19221b3fb3d11fb6` |
| Pristine upstream v1.18.20 | `7248bc1964b13fa67e601733f89ee9dc6dfa0563` |
| First-parent recording merge | `91ca95bad927436131ea4783a470885a381ce6ad` |
| Transformed upstream / final second parent | `9563af96a012effc25df5a11eaa1f7633161a742` |

The recording merge has actual base and pristine `.20` as parents. HEAD has the recording merge and transformed upstream as parents. Scope is 95 reachable commits, two first-parent merges, and 59 files / 1,524 insertions / 647 deletions. The parent supplied independently fetched upstream refs; this reviewer verified their local object IDs without fetching or changing refs.

## Findings

None introduced by this merge in the assigned branding/link lens. In particular, the two newly changed OpenCode-facing literals are not registered product paths, and the new `opencode-go` literal identifies a third-party provider rather than Kilo itself.

## Notable non-findings and human verification

### Changed OpenCode console URL is dormant, not the Kilo Console destination

- **Location:** `packages/opencode/src/cli/cmd/account.ts:18`, consumed by its local `LoginCommand` at `:177-189`.
- **Literal change:** `https://console.opencode.ai` → `https://opencode.ai/console`.
- **Exposure proof:** Kilo's entrypoint omits the upstream account import and registration at `packages/opencode/src/index.ts:3` and `:108`. `KiloCli.register` instead registers `KiloConsoleCommand` at `packages/opencode/src/kilocode/cli/setup.ts:46`; its lazy loader points to the Kilo-owned command at `packages/opencode/src/kilocode/cli/lazy-kilo-commands.ts:3-6`. Repository reference searches found no production consumer that reinstates the upstream account command. The account unit test imports the URL directly, which does not prove CLI registration.
- **Control/provenance:** Actual base, pinned main, and the recording merge contain the old URL and the same Kilo registration exclusions. Pristine `.20`, transformed upstream, and HEAD contain the new URL. Upstream origin is `2cba7e227d68a7e7e4a2aa9c85b808e8ecb14daf` (`fix(cli): update default console URL (#43043)`). The entire Kilo entrypoint and registration setup are byte-identical base→HEAD.
- **Classification:** Statically verified dormant upstream maintenance; no demonstrated shipped user redirection. No correction required for this merge. Preserve the registration exclusion rather than blindly substituting a Kilo website into an incompatible upstream account protocol.

### Updated `customize-opencode.md` remains unregistered

- **Location:** `packages/core/src/plugin/skill/customize-opencode.md:43`.
- The file still contains OpenCode config names and `https://opencode.ai/config.json`, but file presence is not runtime exposure. Its only embedding module, `packages/core/src/plugin/skill.ts:9-25`, defines the upstream plugin; production registration at `packages/core/src/plugin/internal.ts:107-120` deliberately omits that plugin. The direct upstream unit test explicitly invokes `SkillPlugin.Plugin.effect`, not the production registration graph.
- Kilo's loader seeds `BUILTIN_SKILLS` at `packages/opencode/src/skill/index.ts:301-309`. That registry contains one builtin, `kilo-config`, with Kilo-specific description/content at `packages/opencode/src/kilocode/skills/builtin.ts:14-20`. The registry, loader, registered Kilo content, and core registration file are unchanged from actual base.
- **Control/provenance:** Base and pinned main already retained the dormant document and disabled registration. Pristine `.18` and `.20` register it; transformed upstream still registers it; HEAD preserves Kilo's exclusion. The document's changed line comes from upstream `62387f39d4ccbe8672eb57a9a69d26e0ffa42b54` (`fix(skills): Update global config path in documentation (#42337)`).
- **Classification:** Statically verified non-exposure in shipped registration; not a runtime branding finding. No correction required. Exact changed text is recorded below rather than claiming there were no prompt-file changes.

### `opencode-go` enables the existing search tool; it does not rename Kilo

- **Location:** `packages/opencode/src/tool/registry.ts:81-90`, used by the actual model tool filter at `:364-370`.
- The added `providerID === ProviderV2.ID.make("opencode-go")` enables `websearch` for an explicitly selected OpenCode Go provider without requiring the Exa/Parallel enable flags. `ProviderV2.ID.kilo` remains enabled, and the ordinary `opencode` provider is not newly enabled. The changed test records precisely this distinction at `packages/opencode/test/tool/websearch.test.ts:33-39`.
- The newly available description is the unchanged, provider-neutral `packages/opencode/src/tool/websearch.txt:1-14`. Display labels are `Parallel Web Search`, `Exa Web Search`, and `Web Search` at `packages/opencode/src/tool/websearch.ts:49-52`. The transports remain Kilo REST or the existing Exa/Parallel endpoints; see `:143-165`, `:188-201`, and `packages/opencode/src/tool/mcp-websearch.ts:7-11`. No OpenCode web property is added as a search destination.
- **Control/provenance:** Base/main/recording merge enable Kilo or explicit flags only. Pristine `.20` and transformed upstream add Go beside upstream's own provider; HEAD retains Kilo in the first arm and adopts only the Go addition. Upstream origin: `4643e65ad6334de3e4e68dedc201d5fbb828c9fe` (`fix(opencode): enable web search for Go (#42630)`).
- **Classification:** Verified provider-compatibility/tool-availability change, not product-identity regression. **Human verification, non-blocking:** product owners may confirm whether Go should receive automatic search eligibility while other third-party providers still require configuration/flags. Intent beyond the code is not proven. If that asymmetry is unwanted, the minimal correction is removing only the Go eligibility arm and its expectation, not renaming the provider or changing Kilo branding. No severity-bearing defect is asserted on that policy question.

### OAuth identity and retry links survive the touched paths

- Codex success/error pages still say `Kilo - Codex Authorization Successful`, `You can close this window and return to Kilo.`, and `Kilo - Codex Authorization Failed` at `packages/opencode/src/plugin/openai/codex.ts:176`, `:209`, and `:222`. The callback serves this retained page at `:328`; the comment mentioning an OpenCode-branded *shared* page is not the HTML being served. The authorize request keeps `originator: "kilo"` at `:116`. These Kilo overrides exist in base/main and survive against pristine/transformed upstream controls.
- The new `https://api.openai.com/auth` occurrence at `packages/opencode/src/plugin/openai/codex.ts:100` is a JWT claim namespace, not an OpenCode property or a new browser destination.
- Existing `opencode` user-agent/originator headers in Codex (`:591`, `:615`, `:674-675`) and Cloudflare (`packages/opencode/src/provider/provider.ts:793`, `:862`; `packages/core/src/plugin/provider/cloudflare-ai-gateway.ts:80`) are transport identity, not newly added UI copy. They predate this PR. Whether every such header should eventually identify Kilo requires provider/protocol compatibility verification; this review does not assume a blind rename is safe.
- The unchanged TUI Go-upsell identifiers at `packages/tui/src/routes/session/index.tsx:104-127` do not establish a newly exposed upsell. The consumer requires `status.action` at `:463-475`, while Kilo's `packages/opencode/src/session/retry.ts:85-120` still returns messages without producing upstream Go actions. Its retry-regex changes do not restore the upstream upsell builders. The existing retry dialog's special pricing URL remains `https://kilo.ai/pricing` at `packages/tui/src/component/dialog-retry-action.tsx:10`. The changed reasoning header at `packages/tui/src/routes/session/index.tsx:1876-1880` renders `Thought`, not OpenCode branding.

### Existing Snowflake instruction is a real residual, but not introduced here

- **Location:** `packages/opencode/src/plugin/snowflake-cortex.ts:478`:

  > Complete Snowflake sign-in in your browser. OpenCode will capture the OAuth callback and store the bearer token automatically.

- **Exposure/effect:** The Snowflake plugin is in the existing internal plugin list (`packages/opencode/src/plugin/index.ts:91`); provider login prints automatic authorization instructions at `packages/opencode/src/cli/cmd/providers.ts:103-105`. Thus this text can identify the Kilo client as OpenCode during Snowflake sign-in. It is not merely a provider brand or a dormant documentation mention.
- **Control:** The exact instruction exists at the same line in actual base, pinned main, pristine `.18`, pristine `.20`, the recording merge, transformed upstream, and HEAD. The whole Kilo Snowflake file is byte-identical base→HEAD; this PR adds Cerebras to the plugin list, not Snowflake registration.
- **Classification:** Static verification; **pre-existing Kilo branding residual inherited from upstream**, low/P3 follow-up, explicitly excluded from this merge's findings/verdict. If addressed separately, the minimal correction is changing only `OpenCode will capture` to `Kilo will capture`. No new OAuth behavior or credential failure is claimed.

### Public package, SDK, OpenAPI, and help identity are preserved

- Package identity metadata (`name`, description, version, private flag, bin, repository, homepage, bugs, keywords) is unchanged in all three edited package manifests. Public CLI and SDK remain `@kilocode/cli` / `kilo` (`packages/opencode/package.json:4`, `:20`) and `@kilocode/sdk` with the Kilo repository (`packages/sdk/js/package.json:3`, `:39`). Core's `@opencode-ai/core` name and `opencode` development bin are pre-existing private-package metadata (`packages/core/package.json:4`, `:7`, `:17`), not a new public package rename.
- Scanning every changed generated SDK file found identical branding/URL line multisets before and after. The generated API still uses `KiloClient`; its missing-client error explicitly recommends `new KiloClient()` (`packages/sdk/js/src/v2/gen/sdk.gen.ts:666`). Representative descriptions still say `Kilo system`, `Kilo server`, and `Kilo configuration` (`:781`, `:886`, `:1512`). No OpenCode product name or OpenCode web URL was found in the v2 generated tree by the targeted identity scan.
- `packages/sdk/openapi.json` is byte-identical to actual base. Config/OpenAPI descriptions were not silently replaced during the SDK generator upgrade. Regeneration freshness and SDK source compatibility are other reviewers' concerns, not inferred from this branding check.
- The executable help entrypoint remains `.scriptName("kilo")` (`packages/opencode/src/index.ts:58`). No public docs/help file is changed besides the dormant upstream skill document. Provider IDs, protocol/service identifiers, `@opencode-ai/*` imports, and existing third-party auth-package names were not misclassified as Kilo product names.

### Exact prompt text and meaningful behavior exposure

The sole changed prompt/skill-document literal is the global-config table cell at `packages/core/src/plugin/skill/customize-opencode.md:43` (table padding omitted, text preserved exactly):

```text
Before: `~/.config/opencode/opencode.json` (NOT `~/.opencode/`)
After:  `~/.config/opencode/opencode.json` or `~/.config/opencode/opencode.jsonc` (NOT `~/.opencode/`)
```

This document remains unregistered as established above. No active system-prompt or tool-description wording was changed. That does **not** mean model-visible behavior is identical:

- OpenCode Go sessions gain the existing `websearch` description/schema through the provider gate; Kilo sessions retain their existing eligibility.
- `packages/opencode/src/tool/task.ts:276-278` now propagates the last failed child tool as a task error, rather than returning only final child text when no assistant-level error exists. The new output template is exactly `` `${failed.state.error}\n${resumeHint(nextSession.id)}` ``. Its already-existing hint (`packages/opencode/src/kilocode/task-resume.ts:3-4`) is exactly `This subagent session can be resumed: call the task tool again with task_id="${sessionID}" and a prompt describing how to continue or recover. Its prior context is preserved.` This is newly exposed error/recovery context, not an OpenCode identity instruction.
- Core runner affinity headers and compaction HTTP propagation change request metadata, not system/summary wording (`packages/core/src/session/runner/llm.ts:207-214`, `packages/core/src/session/compaction.ts:205`). Retry changes and the new `Provider finish_reason: network_error` diagnostic (`packages/opencode/src/session/llm/ai-sdk.ts:94`) alter recovery/error exposure, not product branding. Provider-returned arbitrary text is not treated as an authored Kilo→OpenCode replacement.

## Command outputs and verification

All commands ran with workdir `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports`.

```text
git status --short                         # initial: no output
git rev-parse HEAD
6a7d6bc002319ac2987bcde3d6c63efcafc07021

git merge-base bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD
bf1cf502a3c511e9daf6a43244568ae4e83473a8

git diff --stat bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD
59 files changed, 1524 insertions(+), 647 deletions(-)

git rev-list --count bf1cf502a3c511e9daf6a43244568ae4e83473a8..HEAD
95

git log --first-parent --merges --format='%H %P %s' bf1cf502a3c511e9daf6a43244568ae4e83473a8..HEAD
6a7d6bc002319ac2987bcde3d6c63efcafc07021 91ca95bad927436131ea4783a470885a381ce6ad 9563af96a012effc25df5a11eaa1f7633161a742 resolve merge conflicts
91ca95bad927436131ea4783a470885a381ce6ad bf1cf502a3c511e9daf6a43244568ae4e83473a8 7248bc1964b13fa67e601733f89ee9dc6dfa0563 merge: record upstream v1.18.20
```

Read-only Python scanners consumed `git diff --unified=0` and `git show HEAD:<path>` for every changed path. Added/deleted-line scan for `opencode|anomalyco|sst.dev|https?://|You are|instructions|description`: **33 matching lines**, including tests and removed lines. Full changed-file OpenCode scan: **451 matching lines**, of which the mechanical import/dependency filter identified 327 and the remaining test/fixture filter identified 35; the other 89 contextual matches were inspected for exposure. These are line counts, not defect counts.

The read-only Git-blob assertion run exited 0. Selected stdout (the omitted lines are individual unchanged-file confirmations):

```text
PASS: all 59 changed paths enumerated and scanned
PASS: account console and customize-opencode absent from production registration; kilo-config retained
PASS: committed OpenAPI byte-identical to actual base
PASS: package identity metadata unchanged: packages/core/package.json
PASS: package identity metadata unchanged: packages/opencode/package.json
PASS: package identity metadata unchanged: packages/sdk/js/package.json
PASS: branding/URL line multisets unchanged in all 10 changed generated SDK files
PASS: Snowflake instruction is pre-existing in actual base and pinned main
Static checks only; no runtime initialization or filesystem writes performed
```

Final `git diff --exit-code` and `git diff --cached --exit-code` both exited 0. Status contained only untracked `.review-config-r6/` (other parallel work) and this report.

`gh pr view 13513 --repo Kilo-Org/kilocode --json number,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus` returned the exact reviewed head/base, `MERGEABLE`, and `CLEAN`. The final local HEAD recheck also remained `6a7d6bc002319ac2987bcde3d6c63efcafc07021`.

## Limitations and integrity

- Static branding/registration review only: no live OAuth, browser/TUI smoke, model request, dependency install, SDK generation, lint, typecheck, or application test suite was run. Only this report was authored; running application/test initialization could create state outside the report, contrary to this reviewer's write restriction. These checks establish source reachability and provenance, not full runtime correctness.
- No live models.dev/provider catalog capture, external service redirect check, arbitrary user-plugin evaluation, or independent remote-tag refetch was performed. External provider names/instructions can remain visible intentionally. Provider/header product-policy ambiguity is explicitly left for human verification, not promoted to a regression.
- No exhaustive repo-wide pre-existing-branding cleanup or full-PR correctness verdict is claimed. Other reviewers own configuration, pipeline, marker, and infrastructure lenses. CI suite results and resolution-tool/rerere accounting were not independently audited by this lens.
- The checkout was initially clean. A later status check showed an externally created untracked `.review-config-r6/` during parallel work; it was not created, read, edited, or removed by this reviewer. No tracked source changes were made. The only reviewer-authored file is `OPENCODE_MENTIONS.md`.
- No caller-checkout access/modification, source edits, commits, pushes, branch/ref changes, Git configuration edits, GitHub mutations, real user-state access, or credential access. No diagnostic files were created or required cleanup.
