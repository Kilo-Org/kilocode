# Kilo change-marker review — PR #13513

## Scope and methodology

Reviewed **all 59 files** in the actual PR comparison: **3 added, 56 modified**, including all **10 generated SDK files**. This is the marker-preservation/fork-delta lens, not an overall PR approval. File-by-file comparisons were performed internally; this report intentionally omits an exhaustive checklist.

All commands ran with `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports` as the tool working directory. Historical files were read from Git objects, without checking out another revision. Read root and applicable CLI, LLM-adapter, HTTP-handler, and test instructions, plus the upstream merge documentation; loaded `kilo-steer` and `kilocode-merge-minimizer`.

Pinned comparisons:

| Revision | SHA |
|---|---|
| Actual PR base and merge base | `bf1cf502a3c511e9daf6a43244568ae4e83473a8` |
| Reviewed HEAD | `6a7d6bc002319ac2987bcde3d6c63efcafc07021` |
| Main control | `62998965e9fb0d9ed89011c62498b39801dbbb4f` |
| Pristine upstream v1.18.18 | `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d` |
| Pristine upstream v1.18.19 | `2b72179c663cadcb54f54d9f19221b3fb3d11fb6` |
| Pristine upstream v1.18.20 | `7248bc1964b13fa67e601733f89ee9dc6dfa0563` |
| Recorded upstream merge | `91ca95bad927436131ea4783a470885a381ce6ad` |
| Transformed upstream parent | `9563af96a012effc25df5a11eaa1f7633161a742` |

The range contains **95 reachable commits and two first-parent merges**. The recorded merge has the base and pristine v1.18.20 as parents; its tree equals the base tree. HEAD merges that recorded commit with the transformed parent. Thus the first-parent recording commit itself did not remove source behavior.

For every changed file, compared base, main, merged HEAD, pristine upstream, and merge-parent blobs. In addition to raw diffs and blob equality, compared the Kilo residual against upstream before and after the merge, ignoring marker-only/whitespace changes for that secondary comparison. Inspected every actual marker removal/move separately and traced material adaptations through their implementations and tests. Generated files and the lockfile were compared as such, rather than treated as handwritten missing-marker violations.

## Lens verdict

**Safe to merge from the marker-preservation lens, with two P3 annotation follow-ups.** No demonstrated runtime behavior loss resulted from the marker removals. One inherited provider-limit decision warrants human confirmation; it is not an established PR-introduced defect.

## Findings

### P3 — Newly adapted ripgrep assertion lacks its Kilo marker

- **Location:** `packages/core/test/ripgrep.test.ts:94`.
- **Evidence/control:** Pristine v1.18.20 and transformed parent assert `matches[0]?.text`; HEAD correctly asserts `matches.items[0]?.text`. Kilo's real implementation returns the metadata-bearing object at `packages/core/src/ripgrep.ts:301`. The existing equivalent adaptations at test lines 59–60 have inline markers; line 94 is outside the block ending at line 78 and has none.
- **Provenance:** Introduced by this PR's adaptation of a new upstream test. The test is absent from both the actual base and pinned main.
- **Impact:** Test behavior is correct today. The necessary fork-specific result-shape adaptation is invisible to marker-oriented merge review, making an upstream reset liable to restore the wrong assertion. The actual-base guard skips this PR, so its successful exit does not detect the omission.
- **Minimal action:** Add a single inline marker to line 94, matching the existing assertions. Do not mark the entire upstream test or move it merely to avoid this one-line adaptation.

### P3 — New SDK compatibility postprocessing is unmarked in shared handwritten code

- **Location:** `packages/sdk/js/script/build.ts:107` and `:111–122`.
- **Evidence/control:** The base and transformed parent require the old SSE replacement to change the generated text. HEAD intentionally accepts an already-correct signature and adds a postprocessor restoring required `request`/`response` fields. The latter block is absent from pristine upstream, the transformed parent, the actual base, and pinned main. It is not generated code and has no `kilocode_change` annotation. The resulting contract is visible at `packages/sdk/js/src/v2/gen/client/types.gen.ts:121`.
- **Provenance:** The compatibility adaptation is introduced in this PR; other unmarked customizations elsewhere in this build script predate it and are not charged to this PR.
- **Impact:** A still-required Kilo postprocessor can be mistaken for upstream code during a later SDK build-script reconciliation. Restoring the upstream guard would reject the newer generator's already-correct SSE output; losing the result-field postprocessor would remove this PR's intentional source-compatibility contract. The annotation checker does not include the SDK package in its scopes.
- **Minimal action:** Narrowly annotate the changed acceptance condition and the new compatibility block in the handwritten build script. Do not hand-annotate generated SDK files. The in-memory control below confirms the actual patch accepts base/main/HEAD fixtures and is idempotent; this is not a claim that the SDK generator is broken now.

## Human verification — not an established defect

### HV1 — Confirm the retained GPT-5.6 OAuth context-limit override

- **Location:** `packages/opencode/src/plugin/openai/codex.ts:433–437`.
- **Severity:** Unscored pending confirmation; potentially P2 if the backend limit is lower than the advertised Kilo limit.
- **Evidence/control:** Upstream v1.18.18 used 500,000 context / 372,000 input for GPT-5.6; v1.18.20 deliberately reduces these to 400,000 / 272,000. Kilo retains its marked 1,050,000 / 922,000 override, byte-for-byte from both base and pinned main. The model filter permits suffixed GPT-5.6 IDs even though it rejects the exact `gpt-5.6` alias. Kilo's tests deliberately expect the larger limits.
- **Provenance:** Pre-existing Kilo/main behavior retained across a new upstream limit change, not a newly introduced override or accidentally deleted marker.
- **Possible impact/action:** If upstream's smaller limit also applies to Kilo's eligible OAuth models, compaction could start too late. Confirm the model-specific backend limits and retain or adjust the existing marked override accordingly. No live provider-limit probe was performed, so this is a product/API verification concern, not proof of a regression.

## Notable non-findings

- **All actual removals accounted for:** The base-to-HEAD diff removes four marker-bearing lines across two production files. Three are in `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`: an adjacent end/start pair is consolidated, and a redundant inline marker is removed. The surviving block at lines 62–87 still covers prompt-training filtering, failed-provider retention, provider metadata, default selection, and the adapted connected-provider expression. None of those behaviors disappeared.
- **Websearch marker moved, not lost:** The fourth removal is the old marked return in `packages/opencode/src/tool/registry.ts:85–90`. Its replacement marks the Kilo-specific provider predicate at line 86. The `opencode-go` branch comes from pristine upstream; Kilo still replaces the ordinary OpenCode default provider and retains explicit search flags. The newly worded test title is a cosmetic branding difference, not a lost feature.
- **Compatibility resets deliberately preserved:** Upstream removes the context-epoch import and two reset calls. HEAD retains and newly annotates them in `packages/core/src/session/projector.ts:16`, `:276`, and `:475`. Kilo still has the table, runner initialization/prepare calls, and history reads; retaining the resets is coherent with that surviving implementation, not an obsolete-markers defect.
- **Task failure handling reconciled:** `packages/opencode/src/tool/task.ts:271–280` adopts upstream terminal-tool-error detection while preserving Kilo's resumable `task_id` error hint. The corresponding tests retain Kilo-specific assertions. Background-process finalization and cost propagation remain wired. Some newly upstream-equivalent lines remain inside existing broader blocks; that is not missing behavior.
- **Main-only Task fix is not removed by this PR:** The synthetic/ignored/empty-text filtering present on pinned main is already absent from the actual base. Both the implementation and its regression-test difference are inherited stack/main drift, not marker removal in this 59-file PR. This is not a claim that the missing main fix is unnecessary; it belongs in later main reconciliation.
- **Retry improvement reaches the Kilo-owned replacement:** Upstream adds a broad fallback to its shared provider-error parser. Kilo instead retains its existing marked `KiloError.fallback` hook at `packages/opencode/src/provider/error.ts:170` and extends capacity/temporary-unavailability matching in `packages/opencode/src/kilocode/provider/error.ts:56–57`. The new upstream regression test exercises that public parser. The shared file being absent from the changed-file list is not evidence that the improvement was silently dropped.
- **Cloudflare deletion is an upstream replacement:** Removing the old output-token-cap hook is paired with native OpenAI/Anthropic passthrough routing and native SDK selection. This is upstream behavior adoption, not deletion of a Kilo-marked feature.
- **TUI routed-model integration survives:** Opaque reasoning rendering is adopted while the marked part-ID propagation and `RoutedModelMeta.View` remain in `packages/tui/src/routes/session/index.tsx:1832–1834` and `:1891–1893`.
- **SDK regeneration is not wholesale Kilo loss:** Seven of the ten changed generated files are byte-identical to pinned main. The remaining main differences were inspected: required result fields are intentional compatibility postprocessing, and the missing snapshot-removal endpoint is already absent from the actual base. The new generator's SSE correction makes the old mandatory-change assumption obsolete, not the final SSE contract.

## Commands and results

The following commands were run with the review-root working directory specified above. No dependency installation or source regeneration was performed by this reviewer.

```sh
git status --short
git rev-parse HEAD
git merge-base bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD
git diff --name-status bf1cf502a3c511e9daf6a43244568ae4e83473a8...HEAD
git diff --stat bf1cf502a3c511e9daf6a43244568ae4e83473a8...HEAD
git log --first-parent --format='%H %P %s' bf1cf502a3c511e9daf6a43244568ae4e83473a8..HEAD
git rev-list --count bf1cf502a3c511e9daf6a43244568ae4e83473a8..HEAD
git diff --quiet bf1cf502a3c511e9daf6a43244568ae4e83473a8 91ca95bad927436131ea4783a470885a381ce6ad
git diff --check bf1cf502a3c511e9daf6a43244568ae4e83473a8...HEAD
```

Results: initially clean; expected HEAD/base; 59 files, 1,524 insertions, 647 deletions; 95 reachable commits; two recorded first-parent merges; recording-tree equality and diff whitespace check exit 0.

```sh
git rev-parse refs/review/pr-13513/upstream-v1.18.18 refs/review/pr-13513/upstream-v1.18.19 refs/review/pr-13513/upstream-v1.18.20
git cat-file -t refs/review/pr-13513/upstream-v1.18.18
git cat-file -t refs/review/pr-13513/upstream-v1.18.19
git cat-file -t refs/review/pr-13513/upstream-v1.18.20
git merge-base --is-ancestor 31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d 7248bc1964b13fa67e601733f89ee9dc6dfa0563
git merge-base --is-ancestor 2b72179c663cadcb54f54d9f19221b3fb3d11fb6 7248bc1964b13fa67e601733f89ee9dc6dfa0563
```

Results: exact pinned upstream SHAs above; each ref resolves directly to `commit`. Coordinator verification corrected the initial ancestry summary: **both `.18 → .20` and `.19 → .20` ancestry checks exit 1**, not 0. The `.18` and `.19` tags are release-only sibling commits; their parents/common ancestors with `.20` are `14b37df39168eaf6a6faf862ec4a7bbe9c825bbd` and `f4a89683da2fb5fd1b37995402100ca7a24a8484`, respectively. Pristine `.20` itself is a verified ancestor of the reviewed HEAD through the recording merge. This is not a wrong-target finding.

```sh
bun run /Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports/script/check-opencode-annotations.ts --base bf1cf502a3c511e9daf6a43244568ae4e83473a8
```

Exit 0, exact output:

```text
Skipping shared upstream annotation check — upstream merge detected.
```

**This is a skipped check, not an annotation pass.** The implementation at `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports/script/check-opencode-annotations.ts:257–259` skips merge ranges; it also exempts whole files with marker removals at line 274. Manual upstream/parent comparisons therefore supplied the substantive coverage. The read-only in-memory scan of new HEAD lines against both base and transformed upstream identified the ripgrep assertion, cosmetic websearch title, and SDK build postprocessor as unmarked fork-specific additions; each was inspected manually.

The exact in-memory SDK implementation control was:

```sh
node -e 'const {execFileSync}=require("node:child_process"); const vm=require("node:vm"); const assert=require("node:assert/strict"); const cwd="/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports"; const show=(ref,file)=>execFileSync("git",["show",`${ref}:${file}`],{cwd,encoding:"utf8"}); const build=show("6a7d6bc002319ac2987bcde3d6c63efcafc07021","packages/sdk/js/script/build.ts"); const block=build.slice(build.indexOf("const sseTypesPatched ="),build.indexOf("await Bun.write(sseTypesPath, compatible)")); const apply=sseTypesSource=>vm.runInNewContext(block+"; compatible",{sseTypesSource,sseTypesPath:"generated fixture"}); const path="packages/sdk/js/src/v2/gen/client/types.gen.ts"; for(const [label,ref] of [["base","bf1cf502a3c511e9daf6a43244568ae4e83473a8"],["main","62998965e9fb0d9ed89011c62498b39801dbbb4f"],["head","6a7d6bc002319ac2987bcde3d6c63efcafc07021"]]) {const input=show(ref,path);const output=apply(input);assert(output.includes("=> Promise<ServerSentEventsResult<TData>>"));assert(/request: Request\s+response: Response/.test(output));assert.equal(apply(output),output);console.log(label+": current build patch accepts historical blob, preserves required fields, and is idempotent");} assert.throws(()=>apply("unexpected generator output"),/SseFn patch did not apply/); console.log("malformed control: rejects changed generator signature");'
```

Exit 0, exact output:

```text
base: current build patch accepts historical blob, preserves required fields, and is idempotent
main: current build patch accepts historical blob, preserves required fields, and is idempotent
head: current build patch accepts historical blob, preserves required fields, and is idempotent
malformed control: rejects changed generator signature
```

The script evaluates the actual build-script patch block, not a reimplementation, and performs no filesystem writes.

```sh
gh pr view 13513 --repo Kilo-Org/kilocode --json headRefOid,baseRefOid,baseRefName,url
git diff --quiet
git diff --cached --quiet
git rev-parse HEAD
```

Results: remote HEAD/base still match the reviewed pins, base branch remains `johnnyeric/kilo-opencode-v1.18.18`; both tracked-cleanliness checks exit 0; local HEAD unchanged.

## Limitations

- Static marker/behavior-preservation review plus the read-only SDK patch control; no full runtime, UI, database compatibility, live-provider, lint, typecheck, or package-test run is claimed by this lens. Reviewed tests are evidence of intended coverage, not reported as executed.
- No SDK regeneration, dependency install, marker-rewriter execution, source edits, commits, pushes, branch switching, Git configuration changes, or GitHub mutations. The upstream refs supplied for this review were verified locally, not fetched again by this reviewer.
- Exact rerere/mergiraf/manual-resolution attribution is not recoverable from the inspected committed trees alone; no automation-count claim is made.
- Main comparisons distinguish inherited stack drift from changes in this PR; they do not certify that this branch already contains every later main fix.
- The shared review checkout acquired other reviewers' untracked report/diagnostic files during review. They were not edited or removed. Tracked sources stayed clean; this reviewer's only written artifact is `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports/KILOCODE_CHANGE_MARKERS.md`.
