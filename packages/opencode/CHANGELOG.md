# @kilocode/cli

## 7.3.33

### Patch Changes

- [#10935](https://github.com/Kilo-Org/kilocode/pull/10935) [`6cab5f1`](https://github.com/Kilo-Org/kilocode/commit/6cab5f18e76b5ab0f738c2e20e93f12f3679b5dc) - Prevent the macOS Apple Silicon CLI from failing to start because of malformed bundled exports.

## 7.3.30

### Patch Changes

- [#10862](https://github.com/Kilo-Org/kilocode/pull/10862) [`c4de1ac`](https://github.com/Kilo-Org/kilocode/commit/c4de1acdf0aef967b5795fde006c6f61e16328f3) - Support reasoning with Mistral Medium 3.5 models, including the latest alias.

- [#10895](https://github.com/Kilo-Org/kilocode/pull/10895) [`2e1945c`](https://github.com/Kilo-Org/kilocode/commit/2e1945c287971f26bec67b7e60de6c282a5c8865) - Allow plan approval submissions to complete after planning finishes.

## 7.3.29

### Patch Changes

- [#10822](https://github.com/Kilo-Org/kilocode/pull/10822) [`8b1ee66`](https://github.com/Kilo-Org/kilocode/commit/8b1ee6628c7ee552814980465af7233522dd5528) - Preserve worktree routing for Kilo HTTP API clients and keep inherited task-subagent restrictions active.

## 7.3.28

### Patch Changes

- [#10847](https://github.com/Kilo-Org/kilocode/pull/10847) [`cdf46c9`](https://github.com/Kilo-Org/kilocode/commit/cdf46c97354630e2f1b392092ee0ffcc18b19640) - Clarify when free-model data may be used for training and identify it with a brain circuit icon.

- [#10833](https://github.com/Kilo-Org/kilocode/pull/10833) [`8696edc`](https://github.com/Kilo-Org/kilocode/commit/8696edcb542a5a499018184cfc9aa15cc896e5de) - Keep Kilo Console terminals and worktree changes visible while refreshing diffs.

- [#10833](https://github.com/Kilo-Org/kilocode/pull/10833) [`fbacc31`](https://github.com/Kilo-Org/kilocode/commit/fbacc312f747b6f2284d23c9f58bdc7a843a81cd) - Use the updated favicon in Kilo Console.

- [#10865](https://github.com/Kilo-Org/kilocode/pull/10865) [`9c56107`](https://github.com/Kilo-Org/kilocode/commit/9c561074b624925d14ee0e7d9e64d0a6f5958531) - Show the animated Kilo logo while the console and dashboard finish loading.

- [#10864](https://github.com/Kilo-Org/kilocode/pull/10864) [`557d6ad`](https://github.com/Kilo-Org/kilocode/commit/557d6ad02392dac9138d9788da1476a7ff9cc8e2) - Preserve upstream error statuses for cloud session and KiloClaw gateway requests.

- [#10831](https://github.com/Kilo-Org/kilocode/pull/10831) [`837a875`](https://github.com/Kilo-Org/kilocode/commit/837a87509cb323dbf212cbf40af112f218221dd0) - Keep post-compaction tool calls and follow-up messages ordered after the compaction summary in the CLI and VS Code transcript.

- [#10849](https://github.com/Kilo-Org/kilocode/pull/10849) [`a6b005d`](https://github.com/Kilo-Org/kilocode/commit/a6b005dfede302731dcbb00ac74e744333db9104) - Restore Cloud Agent transcripts in VS Code session previews and stop cloud session previews or continuation from loading indefinitely when a request stalls.

- [#10883](https://github.com/Kilo-Org/kilocode/pull/10883) [`1cdc398`](https://github.com/Kilo-Org/kilocode/commit/1cdc39856f461b4dc183fe5b273b7fc1314b9a64) - Restore `kilo console` startup in packaged CLI builds.

- [#10863](https://github.com/Kilo-Org/kilocode/pull/10863) [`35aa9bb`](https://github.com/Kilo-Org/kilocode/commit/35aa9bbbb38557df292f105fd5324bf37807f518) - Restore Kilo Gateway-backed Mercury Next Edit completions.

- [#10829](https://github.com/Kilo-Org/kilocode/pull/10829) [`e64c1fb`](https://github.com/Kilo-Org/kilocode/commit/e64c1fb65ec6895f7e97786f52806195f25606c0) - Restore full-session forks in Agent Manager after the HTTP API migration.

- Updated dependencies [[`fc4cf10`](https://github.com/Kilo-Org/kilocode/commit/fc4cf10b0a65ec2b2949dd695ebec6ebb619cd15), [`a6b005d`](https://github.com/Kilo-Org/kilocode/commit/a6b005dfede302731dcbb00ac74e744333db9104)]:
  - @kilocode/sdk@7.3.23
  - @kilocode/kilo-gateway@7.3.23
  - @kilocode/plugin@7.3.23
  - @kilocode/kilo-indexing@7.3.23
  - @kilocode/kilo-telemetry@7.3.23

## 7.3.21

### Minor Changes

- [#10298](https://github.com/Kilo-Org/kilocode/pull/10298) [`ac7e46d`](https://github.com/Kilo-Org/kilocode/commit/ac7e46d67a7015469bf2edeb573c284308ea05d5) Thanks [@Githubguy132010](https://github.com/Githubguy132010)! - Add a `kilo profile` command for checking the active Kilo account or team balance.

- [#10310](https://github.com/Kilo-Org/kilocode/pull/10310) [`c265fa4`](https://github.com/Kilo-Org/kilocode/commit/c265fa4c4ef18204f8e2741c66953c24bf012f2a) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Show running spinner in subagent footer to indicate when subagent is processing

### Patch Changes

- [#10191](https://github.com/Kilo-Org/kilocode/pull/10191) [`b590f8c`](https://github.com/Kilo-Org/kilocode/commit/b590f8c25f1af82e7df854b5b969ae8749118bba) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Handle newlines in DialogAlert messages

- [#10306](https://github.com/Kilo-Org/kilocode/pull/10306) [`aca8aeb`](https://github.com/Kilo-Org/kilocode/commit/aca8aeb2b91679b52937562d45986562440ac1de) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Toggle export dialog checkboxes on mouse click

## 7.3.20

### Patch Changes

- [#10792](https://github.com/Kilo-Org/kilocode/pull/10792) [`cb1fdb3`](https://github.com/Kilo-Org/kilocode/commit/cb1fdb3b1b824c6f91cb05dc568bd37f6bf494f5) - Allow clearing agent model and variant overrides from settings.

- [#10786](https://github.com/Kilo-Org/kilocode/pull/10786) [`7dd8aab`](https://github.com/Kilo-Org/kilocode/commit/7dd8aabadeb1b5bcf69f5fb9545a57ac91daf54f) - Limit inferred background-process port discovery to the TUI and stop scanning after startup to avoid unnecessary Bun subprocess polling.

- [#10735](https://github.com/Kilo-Org/kilocode/pull/10735) [`593903f`](https://github.com/Kilo-Org/kilocode/commit/593903fb5ce8843d1a84a64787f8103b92a31fee) - Fix Claude Opus 4.8 reasoning on Amazon Bedrock by treating it as an adaptive thinking model like Opus 4.7. This resolves the "thinking.type.enabled is not supported for this model" error and exposes the full low/medium/high/xhigh/max reasoning effort range.

- [#10789](https://github.com/Kilo-Org/kilocode/pull/10789) [`316a662`](https://github.com/Kilo-Org/kilocode/commit/316a6627dc9eccd40bf7aa45366fca40b35f1879) - Fix queued plan prompts stalling in VS Code after a completed turn.

- [#9499](https://github.com/Kilo-Org/kilocode/pull/9499) [`c1c3af8`](https://github.com/Kilo-Org/kilocode/commit/c1c3af8bf42e911d9d2a2cf06937fdf056d851d2) Thanks [@truffle-dev](https://github.com/truffle-dev)! - Fix empty TUI session list when launching kilo from inside a git submodule. `git worktree list --porcelain` reports the submodule's gitdir (`<repo>/.git/modules/<sub>`) instead of the working tree, so the worktree-family filter dropped every session whose directory was the actual submodule path. Include `Instance.worktree` in the returned set so submodule sessions stay in scope.

## 7.3.18

### Patch Changes

- [#10736](https://github.com/Kilo-Org/kilocode/pull/10736) [`57bc6ee`](https://github.com/Kilo-Org/kilocode/commit/57bc6eea583e22e4c3b8b00ad1c64fed62dc85e8) - Use Kilo session share links when sharing conversations from the CLI.

- [#10737](https://github.com/Kilo-Org/kilocode/pull/10737) [`f574294`](https://github.com/Kilo-Org/kilocode/commit/f5742940ccd06bafd2708e32af30023eef241241) - Support reading text from DOCX files through the read tool.

- [#10740](https://github.com/Kilo-Org/kilocode/pull/10740) [`2081af2`](https://github.com/Kilo-Org/kilocode/commit/2081af2b3344890481cb4bd44260e60a8cccba80) - Support reading XLSX spreadsheets as labelled tabular text

## 7.3.17

### Patch Changes

- [#10721](https://github.com/Kilo-Org/kilocode/pull/10721) [`2efa216`](https://github.com/Kilo-Org/kilocode/commit/2efa216ee5bfffa6e01f51ae5add7c5b9034833c) - Keep Agent Manager turns running while slow snapshot baselines initialize instead of stopping for an interactive question.

- [#10703](https://github.com/Kilo-Org/kilocode/pull/10703) [`eeff6d9`](https://github.com/Kilo-Org/kilocode/commit/eeff6d9df8d378c561c4ca212d650be1dfbd912a) Thanks [@barzhomi](https://github.com/barzhomi)! - Fix LanceDB metadata corruption that caused a full re-index on every VS Code restart

- [#10733](https://github.com/Kilo-Org/kilocode/pull/10733) [`4967c22`](https://github.com/Kilo-Org/kilocode/commit/4967c228611f58bb84c0b762eee88d306ab1b624) - Read Jupyter notebooks as ordered markdown and code cell content instead of raw notebook payloads.

- [#10669](https://github.com/Kilo-Org/kilocode/pull/10669) [`0107a01`](https://github.com/Kilo-Org/kilocode/commit/0107a0163cf73004ee13b0ae5fd46811a273d80a) - Guide Agent Manager orchestration to recall completed session context only when needed.

- [#10668](https://github.com/Kilo-Org/kilocode/pull/10668) [`ef2390d`](https://github.com/Kilo-Org/kilocode/commit/ef2390d7a4ffafc379d1e15db94d3a2cd6dcce9b) - Access semantic indexing without an experimental feature toggle while keeping indexing disabled until enabled globally or for a project.

## 7.3.16

## 7.3.15

## 7.3.14

### Patch Changes

- [#8761](https://github.com/Kilo-Org/kilocode/pull/8761) [`74e01b1`](https://github.com/Kilo-Org/kilocode/commit/74e01b1d485ee77943d2d46f05dce1c7cd2daf82) Thanks [@brendandebeasi](https://github.com/brendandebeasi)! - Fix packaged CLI startup crashes caused by duplicate OpenTUI/Solid renderer instances.

- [#10648](https://github.com/Kilo-Org/kilocode/pull/10648) [`9fbd547`](https://github.com/Kilo-Org/kilocode/commit/9fbd5479b09739b21ca636612a85501f0d0f548f) - Keep the extension responsive while semantic indexing processes large workspaces.

- [#10619](https://github.com/Kilo-Org/kilocode/pull/10619) [`117691e`](https://github.com/Kilo-Org/kilocode/commit/117691e4d6fe48f91223bb7d7e24103c67cde73f) - Use supported hosted model presets for Kilo indexing and clear obsolete model and dimension overrides.

- [#10657](https://github.com/Kilo-Org/kilocode/pull/10657) [`d883ad9`](https://github.com/Kilo-Org/kilocode/commit/d883ad96ab7bd1b31a83d227065ad231a225a4c4) - Keep the extension usable on fresh startup when semantic indexing is enabled globally.

- [#10618](https://github.com/Kilo-Org/kilocode/pull/10618) [`dcfadac`](https://github.com/Kilo-Org/kilocode/commit/dcfadac83ed45a109a402a2f71f4d214347804f1) - Prevent saved global indexing provider changes from temporarily reverting in active workspaces.

- Updated dependencies [[`117691e`](https://github.com/Kilo-Org/kilocode/commit/117691e4d6fe48f91223bb7d7e24103c67cde73f), [`db38888`](https://github.com/Kilo-Org/kilocode/commit/db388889e867021c6bae42cbd03df6b67941b208)]:
  - @kilocode/kilo-indexing@7.3.13
  - @kilocode/sdk@7.3.13
  - @kilocode/kilo-gateway@7.4.0
  - @kilocode/plugin@7.3.13
  - @kilocode/kilo-telemetry@7.3.13

## 7.3.11

### Patch Changes

- [#10485](https://github.com/Kilo-Org/kilocode/pull/10485) [`7025c77`](https://github.com/Kilo-Org/kilocode/commit/7025c779f74b2c68afa05bd2f70ce1123ae9cecc) - Surface failed sub-agent tasks as tool errors so parent sessions can recover.

- [#10443](https://github.com/Kilo-Org/kilocode/pull/10443) [`8e76807`](https://github.com/Kilo-Org/kilocode/commit/8e7680794da86c6d938d6626066157c9cd18adbb) - Support configuring the default task subagent model and reasoning effort while safely inheriting the calling agent model when the override is unavailable.

## 7.3.10

### Patch Changes

- [#10302](https://github.com/Kilo-Org/kilocode/pull/10302) [`8ba138d`](https://github.com/Kilo-Org/kilocode/commit/8ba138def73897d7c19208a067f8a2b4be947fd6) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Export all messages from TUI instead of truncated store

## 7.3.9

### Minor Changes

- [#10500](https://github.com/Kilo-Org/kilocode/pull/10500) [`4ef3717`](https://github.com/Kilo-Org/kilocode/commit/4ef371768a1b8cc2cea895339b46d4a1322a6738) - Support xAI Grok OAuth and device-code login for SuperGrok users.

### Patch Changes

- [#10510](https://github.com/Kilo-Org/kilocode/pull/10510) [`c076058`](https://github.com/Kilo-Org/kilocode/commit/c076058bfcbd4f561abc634f3aa109dee598f396) - Use the fallback logo in old Windows terminal emulators while keeping the Unicode logo available over SSH.

- [#9951](https://github.com/Kilo-Org/kilocode/pull/9951) [`0d12909`](https://github.com/Kilo-Org/kilocode/commit/0d12909a9edb49482365d826d0d91e908d40eb24) - Support optional review focus for `/local-review` and `/local-review-uncommitted`, optional base selection for `/local-review`, and focus both prompts on high-confidence security, performance, business logic, deploy safety, duplication, and dead-code findings.

- [#10510](https://github.com/Kilo-Org/kilocode/pull/10510) [`656572c`](https://github.com/Kilo-Org/kilocode/commit/656572c2cfeff16034769381acfb60f9f85091a1) - Avoid leaving mouse and advanced keyboard modes enabled after exiting the TUI in mintty and MINGW terminals.

## 7.3.8

### Patch Changes

- [#8403](https://github.com/Kilo-Org/kilocode/pull/8403) [`42844e5`](https://github.com/Kilo-Org/kilocode/commit/42844e505475650c16f92251421ad792c6429184) Thanks [@saschabuehrle](https://github.com/saschabuehrle)! - Accept `env` as an alias for `environment` in local MCP server configuration. Configurations using the more common `env` key (matching Docker, npm, and VS Code conventions) are now normalised on load instead of failing strict validation.

- [#10495](https://github.com/Kilo-Org/kilocode/pull/10495) [`ae0fbe8`](https://github.com/Kilo-Org/kilocode/commit/ae0fbe89dc5859fcea3c5d1e459a77eb459a8f71) - Show recent and favorited models in provider-specific model lists.

## 7.3.7

### Patch Changes

- [#10297](https://github.com/Kilo-Org/kilocode/pull/10297) [`74e8604`](https://github.com/Kilo-Org/kilocode/commit/74e860431f3f9fcbfcea764711b8c1487d9a8f8d) Thanks [@IamCoder18](https://github.com/IamCoder18)! - Vertically center TUI dialogs on screen

## 7.3.5

### Patch Changes

- Updated dependencies [[`205e22e`](https://github.com/Kilo-Org/kilocode/commit/205e22ee4672305d3cb2e0c34b607a4950f8f4e8)]:
  - @kilocode/kilo-indexing@7.3.5

## 7.3.3

### Patch Changes

- [#10155](https://github.com/Kilo-Org/kilocode/pull/10155) [`371b7e8`](https://github.com/Kilo-Org/kilocode/commit/371b7e8ae6057f0fefae3982eee6923f2c0a61f0) - Resolve bundled tree-sitter WASM resources from the installed CLI layout so codebase indexing works in packaged CLI and VS Code builds.

## 7.3.2

## 7.3.1

### Patch Changes

- [#10285](https://github.com/Kilo-Org/kilocode/pull/10285) [`d23e162`](https://github.com/Kilo-Org/kilocode/commit/d23e162051f118beb993f84cebad1002d974ad79) - Capture aggregate usage telemetry for experimental Morph-backed codebase search.

- [#10358](https://github.com/Kilo-Org/kilocode/pull/10358) [`413222f`](https://github.com/Kilo-Org/kilocode/commit/413222f0137a29c5cf09666ea3b515032c81f9b8) - Resume interrupted CLI turns automatically after network recovery while giving users 10 seconds to cancel.

- [#10293](https://github.com/Kilo-Org/kilocode/pull/10293) [`af115af`](https://github.com/Kilo-Org/kilocode/commit/af115afe20893f4d24d22a40411ebdbd398781d7) - Harden Mermaid diagram rendering with upstream security fixes.

## 7.3.0

### Patch Changes

- [#10279](https://github.com/Kilo-Org/kilocode/pull/10279) [`a3769d8`](https://github.com/Kilo-Org/kilocode/commit/a3769d83de3e1121c05877f5673dbcb5d3429c6b) - Keep Enhance Prompt focused on rewriting draft prompts instead of answering question-shaped drafts directly.

## 7.2.54

### Minor Changes

- [#10218](https://github.com/Kilo-Org/kilocode/pull/10218) [`4860e65`](https://github.com/Kilo-Org/kilocode/commit/4860e654ca1cc46c4e99acc3f40d4f1302e34944) - Support setting an auto-compaction threshold percentage so long sessions can compact before the context window is full.

### Patch Changes

- [#10136](https://github.com/Kilo-Org/kilocode/pull/10136) [`8af638e`](https://github.com/Kilo-Org/kilocode/commit/8af638e7e20c645b22d96da5e30665e8e9cbf6ad) - Show ChatGPT sign-in again when Codex authentication expires.

- [#8754](https://github.com/Kilo-Org/kilocode/pull/8754) [`e498c02`](https://github.com/Kilo-Org/kilocode/commit/e498c02f7acc5c228bbd45f9e4f294bf5def21ca) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Fix TUI diff rendering when header-like content lines appear inside a unified diff hunk.

- [#10158](https://github.com/Kilo-Org/kilocode/pull/10158) [`d8245a0`](https://github.com/Kilo-Org/kilocode/commit/d8245a0ceb0989b8596c5a5d17fd1095ba9521be) - Fix Mermaid diagrams rendering with empty text inside every shape by restoring the `foreignObject` HTML integration point that DOMPurify dropped in 3.1.7.

- [#10197](https://github.com/Kilo-Org/kilocode/pull/10197) [`1ea86fb`](https://github.com/Kilo-Org/kilocode/commit/1ea86fb6e15cbe486cb0af6f26995d0b1b2745a2) - Prevent Kilo Gateway Responses requests from replaying transient provider item IDs when request storage is disabled.

- Updated dependencies [[`4860e65`](https://github.com/Kilo-Org/kilocode/commit/4860e654ca1cc46c4e99acc3f40d4f1302e34944), [`1af7973`](https://github.com/Kilo-Org/kilocode/commit/1af79731a8ed925f1f69aa536ba90a53b89e8dfb), [`1ea86fb`](https://github.com/Kilo-Org/kilocode/commit/1ea86fb6e15cbe486cb0af6f26995d0b1b2745a2), [`f5dc95b`](https://github.com/Kilo-Org/kilocode/commit/f5dc95b99394c17ad7140bb034bc15a0f9de60b6)]:
  - @kilocode/sdk@7.3.0
  - @kilocode/kilo-gateway@7.3.0
  - @kilocode/plugin@7.2.53
  - @kilocode/kilo-indexing@7.2.53
  - @kilocode/kilo-telemetry@7.2.53

## 7.2.51

### Patch Changes

- [#10121](https://github.com/Kilo-Org/kilocode/pull/10121) [`9963b02`](https://github.com/Kilo-Org/kilocode/commit/9963b0271a78244f773e6192721376618d0a3549) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Auto-approve Task subagent tool permissions when running `kilo run --auto`.

- [#10114](https://github.com/Kilo-Org/kilocode/pull/10114) [`0676243`](https://github.com/Kilo-Org/kilocode/commit/0676243df3afcd97fa7fc40da3c8bf9b092156c3) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Remove `--dangerously-skip-permissions` CLI flag which did nothing

- [#10137](https://github.com/Kilo-Org/kilocode/pull/10137) [`33a233f`](https://github.com/Kilo-Org/kilocode/commit/33a233fd117f23ce967bda7318dc6b3aa3c83e11) - Prevent subagents from spawning nested subagents.

- [#10142](https://github.com/Kilo-Org/kilocode/pull/10142) [`00313bf`](https://github.com/Kilo-Org/kilocode/commit/00313bfcd4326cf24ffda674da3befe493633b20) Thanks [@truffle-dev](https://github.com/truffle-dev)! - Clarify that semantic search returns matching code snippets with paths, line ranges, and relevance scores.

## 7.2.50

## 7.2.49

### Patch Changes

- [#10076](https://github.com/Kilo-Org/kilocode/pull/10076) [`c48b31c`](https://github.com/Kilo-Org/kilocode/commit/c48b31c3ec077ea88549a1f1f025b558a1f8abf6) - Fix garbled diff and additions/deletions counts shown by `apply_patch` when updating a non-UTF-8 file.

- [#10077](https://github.com/Kilo-Org/kilocode/pull/10077) [`1cf0943`](https://github.com/Kilo-Org/kilocode/commit/1cf09437f9d6cf8227f28d6a85a84d4766f26bc0) - Speed up reading large files: the `read` tool now streams UTF-8 content from disk and stops once the line/byte cap is reached, instead of loading the whole file into memory first.

## 7.2.48

### Patch Changes

- [#10051](https://github.com/Kilo-Org/kilocode/pull/10051) [`2d50e1f`](https://github.com/Kilo-Org/kilocode/commit/2d50e1f2dda5533196425b55e5915ee2a49334b6) - Harden git operations against malicious repositories and environment variables by upgrading the underlying git library.

- [#10050](https://github.com/Kilo-Org/kilocode/pull/10050) [`f1ae973`](https://github.com/Kilo-Org/kilocode/commit/f1ae973c537045d7b41766563aaa24b51be1072e) - Suggest local code reviews after more completed changes while still avoiding small edits and repeated suggestions.

- [#10060](https://github.com/Kilo-Org/kilocode/pull/10060) [`0cc0415`](https://github.com/Kilo-Org/kilocode/commit/0cc04158d0cd256ddce306bd330af3c3a328f8be) - Harden markdown rendering against malicious HTML by picking up the latest DOMPurify security fixes.

- Updated dependencies [[`924f034`](https://github.com/Kilo-Org/kilocode/commit/924f034e12f3455f8cb69bb112541f887f4adfe5)]:
  - @kilocode/kilo-indexing@7.2.48

## 7.2.47

### Minor Changes

- [#9851](https://github.com/Kilo-Org/kilocode/pull/9851) [`9de7c98`](https://github.com/Kilo-Org/kilocode/commit/9de7c986e78683015631d14fabd513c3123ff330) - Support Kilo-hosted embeddings as a selectable code indexing provider.

### Patch Changes

- [#10016](https://github.com/Kilo-Org/kilocode/pull/10016) [`d2ae16a`](https://github.com/Kilo-Org/kilocode/commit/d2ae16a9216f0de6e1cb08950f739108515e7998) - Support configuring Azure OpenAI resource names or endpoint URLs from the provider settings flow, and document using the native Azure provider for GPT-5 family deployments.

- [#10014](https://github.com/Kilo-Org/kilocode/pull/10014) [`4b88379`](https://github.com/Kilo-Org/kilocode/commit/4b883792fb8219cf5c4d811ce23b930f6a597ddf) - Improved accuracy of Kilo Gateway cost reporting.

- [#10012](https://github.com/Kilo-Org/kilocode/pull/10012) [`0363006`](https://github.com/Kilo-Org/kilocode/commit/03630064ad865b31cb9e3ed591acd6f07ece4d0c) - Recover compaction when large tool results or media attachments exceed provider payload limits.

- [#9969](https://github.com/Kilo-Org/kilocode/pull/9969) [`eb77fbc`](https://github.com/Kilo-Org/kilocode/commit/eb77fbc13b382eb46c5158165124c6e015449a21) - Prevent an infinite agent loop when a provider ends the response stream without a terminal stop reason.

## 7.2.44

### Minor Changes

- [#9764](https://github.com/Kilo-Org/kilocode/pull/9764) [`9886674`](https://github.com/Kilo-Org/kilocode/commit/98866740afd7f6c2fd06fecda1ffc69c1703974e) - Migrate KiloClaw chat to the new kilo-chat backend. Replaces the single-channel Stream Chat integration with a multi-conversation experience that matches the web UX at app.kilo.ai/claw/kilo-chat: conversation list, reactions, typing indicators, editing, and action approvals. The TUI continues to render a single chat view backed by the user's primary conversation.

- [#9718](https://github.com/Kilo-Org/kilocode/pull/9718) [`dcaccf3`](https://github.com/Kilo-Org/kilocode/commit/dcaccf38658415819b72390255b9f6555e4795e5) - Rate assistant responses with thumbs up/down. Click the thumbs buttons next to the copy button on any assistant message, or press `<leader>=` / `<leader>-` in the terminal UI. Only shown when telemetry is enabled; feedback is sent to Kilo to help improve model and prompt quality.

### Patch Changes

- [#9915](https://github.com/Kilo-Org/kilocode/pull/9915) [`bcb47be`](https://github.com/Kilo-Org/kilocode/commit/bcb47be3b0cf71990fd3ee1ec562a716aefe3571) - Preserve the selected thinking level after compacting a session.

- [#9997](https://github.com/Kilo-Org/kilocode/pull/9997) [`de9f11e`](https://github.com/Kilo-Org/kilocode/commit/de9f11e3990a818ff6d7184f5ea85ee1409a475f) - Fix gpt-5 models failing with `Unsupported parameter: max_tokens` when accessed through custom OpenAI-compatible providers such as LiteLLM.

- [#9993](https://github.com/Kilo-Org/kilocode/pull/9993) [`98f5f65`](https://github.com/Kilo-Org/kilocode/commit/98f5f65c1a8a543687ae5b308805eec1a2c23dca) - Support global and per-project codebase indexing enablement.

- [#9975](https://github.com/Kilo-Org/kilocode/pull/9975) [`c1ea810`](https://github.com/Kilo-Org/kilocode/commit/c1ea8100e13f44a260edf2ac2c027bd69f72deb3) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Honor configured permission overrides in Ask and Plan modes, including persisted always-allow rules.

- [#10006](https://github.com/Kilo-Org/kilocode/pull/10006) [`9e17137`](https://github.com/Kilo-Org/kilocode/commit/9e17137870556c69a141a6e18c63e67919375305) - Recover sessions when providers end a response with an error finish but no error details.

- [#9921](https://github.com/Kilo-Org/kilocode/pull/9921) [`e5e9d0b`](https://github.com/Kilo-Org/kilocode/commit/e5e9d0ba37bd1065aea5a9a83834c6749121e5bd) - Remove custom providers from settings when disconnecting them so they do not reappear after being disabled and re-enabled.

- Updated dependencies [[`9886674`](https://github.com/Kilo-Org/kilocode/commit/98866740afd7f6c2fd06fecda1ffc69c1703974e), [`e5e9d0b`](https://github.com/Kilo-Org/kilocode/commit/e5e9d0ba37bd1065aea5a9a83834c6749121e5bd)]:
  - @kilocode/kilo-gateway@7.3.0
  - @kilocode/sdk@7.3.0
  - @kilocode/kilo-indexing@7.2.43
  - @kilocode/kilo-telemetry@7.2.43
  - @kilocode/plugin@7.2.43

## 7.2.42

### Minor Changes

- [#9909](https://github.com/Kilo-Org/kilocode/pull/9909) [`9ffd047`](https://github.com/Kilo-Org/kilocode/commit/9ffd047962039d6b73d301d5d4e67560cd501c4f) - Detect and preserve UTF-32 (LE and BE) with BOM when reading and editing files. UTF-16 and UTF-32 without a BOM remain unsupported.

### Patch Changes

- [#9887](https://github.com/Kilo-Org/kilocode/pull/9887) [`d9453f0`](https://github.com/Kilo-Org/kilocode/commit/d9453f0da2b063041f6f98235220cde9129e162d) - Fix queued-turn auto-compaction so overflow recovery runs instead of exhausting compaction attempts.

- [#9855](https://github.com/Kilo-Org/kilocode/pull/9855) [`59e8eff`](https://github.com/Kilo-Org/kilocode/commit/59e8effc3df8a03146f5ceddf95f79989b813417) - Respect project-specific semantic indexing decisions instead of enabling indexing globally across workspaces.

- [#9928](https://github.com/Kilo-Org/kilocode/pull/9928) [`520922f`](https://github.com/Kilo-Org/kilocode/commit/520922ff39354c2df72317dee0f70035c52c24c5) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Prevent VS Code empty windows from starting codebase indexing against the home directory.

- [#9843](https://github.com/Kilo-Org/kilocode/pull/9843) [`27d14d4`](https://github.com/Kilo-Org/kilocode/commit/27d14d432c33051e4bdd5863ea14b207758e9234) - Prompt before reading `.env` files even after broad read permissions were previously approved.

- [#9924](https://github.com/Kilo-Org/kilocode/pull/9924) [`914bbdf`](https://github.com/Kilo-Org/kilocode/commit/914bbdfd0575e40554c39c6691e4264a63109953) Thanks [@shssoichiro](https://github.com/shssoichiro)! - Restore Skill tool access for Plan, Ask, Explore, and other non-system agents so skill workflows are available by default.

- [#9907](https://github.com/Kilo-Org/kilocode/pull/9907) [`d9d4dcd`](https://github.com/Kilo-Org/kilocode/commit/d9d4dcd37c6719652252da66b6a1ce27049beb47) - Recover sessions left unable to continue after an assistant turn was created but never started.

## 7.2.39

### Patch Changes

- [#9840](https://github.com/Kilo-Org/kilocode/pull/9840) [`db26be6`](https://github.com/Kilo-Org/kilocode/commit/db26be6b5d3ac77a729ea5242c8330b9146352a7) - Restore the `KILO=1` environment variable so plugins and tooling can distinguish the Kilo CLI from upstream OpenCode.

## 7.2.36

### Patch Changes

- [#9869](https://github.com/Kilo-Org/kilocode/pull/9869) [`d5fd42c`](https://github.com/Kilo-Org/kilocode/commit/d5fd42c3d736329c27de06d52154701f6f4608fb) - Fix question tool being unavailable in code mode

- [#9838](https://github.com/Kilo-Org/kilocode/pull/9838) [`f499257`](https://github.com/Kilo-Org/kilocode/commit/f499257c3287274473db801edba1852dbcdbd92a) - Honor approved external directory read access in Ask and Plan modes.

- [#9778](https://github.com/Kilo-Org/kilocode/pull/9778) [`33476e5`](https://github.com/Kilo-Org/kilocode/commit/33476e50508f39c232731613fd9d74a7aa19e748) - Show an "Initializing snapshot…" line in the chat while the initial snapshot is running on very large repositories, and add an interactive prompt when it stalls. After 10 seconds (configurable via `KILO_SNAPSHOT_TRACK_TIMEOUT_MS`) the prompt asks whether to keep waiting or disable snapshots for the project; choosing to disable writes `"snapshot": false` to `.kilo/kilo.json` so future sessions skip snapshots entirely.

- [#9833](https://github.com/Kilo-Org/kilocode/pull/9833) [`614bca7`](https://github.com/Kilo-Org/kilocode/commit/614bca7cff862ec96e4707a97f43b540210ab699) - Prevent macOS Spotlight from indexing Kilo-generated data directories.

## 7.2.35

### Patch Changes

- [#9820](https://github.com/Kilo-Org/kilocode/pull/9820) [`a858f00`](https://github.com/Kilo-Org/kilocode/commit/a858f001ba8b2de561c69ba8a42d9d3347b1e66f) - Warn when a model hits its output limit before finishing a response.

- [#8910](https://github.com/Kilo-Org/kilocode/pull/8910) [`8472f90`](https://github.com/Kilo-Org/kilocode/commit/8472f9052883d9acf643e0786e3819936c44a61a) Thanks [@eolbrych](https://github.com/eolbrych)! - Restore the Sign in action for MCP servers that require OAuth authentication in VS Code settings.

## 7.2.33

### Minor Changes

- [#9737](https://github.com/Kilo-Org/kilocode/pull/9737) [`d5fb9eb`](https://github.com/Kilo-Org/kilocode/commit/d5fb9eb2265c03127e776c99020b03bb770255a1) - Support starting Agent Manager local sessions and worktree sessions from an experimental agent tool.

### Patch Changes

- [#9746](https://github.com/Kilo-Org/kilocode/pull/9746) [`80535d4`](https://github.com/Kilo-Org/kilocode/commit/80535d4ed6266888988a66ca28706260ee89e533) - Avoid repeated command approval prompts when multiple sessions request the same saved command permission, without widening bash permission matching.

- [#9460](https://github.com/Kilo-Org/kilocode/pull/9460) [`26e4c11`](https://github.com/Kilo-Org/kilocode/commit/26e4c1148f4e7a734bb8e535e02a1a9ad75be584) - Scope the custom commit message prompt to the current project. Setting it in the VS Code settings now writes to the workspace's `kilo.json` so different repositories can have different conventions, instead of silently applying globally. Also fixes the project-level config update endpoint, which previously wrote to a file that wasn't loaded.

- [#9626](https://github.com/Kilo-Org/kilocode/pull/9626) [`5dbf91c`](https://github.com/Kilo-Org/kilocode/commit/5dbf91cc167c16e04bb41e8af68108f8865a18c8) - Honor allowed read-only external-directory access to Kilo config paths without repeated permission prompts.

- [#9745](https://github.com/Kilo-Org/kilocode/pull/9745) [`da3d79a`](https://github.com/Kilo-Org/kilocode/commit/da3d79a6886944b4ad311211e3f67c350958a6ca) - Use a GPT-5.5-specific coding prompt that improves autonomous task handling while keeping older Codex generations on their existing prompt.

- [#9729](https://github.com/Kilo-Org/kilocode/pull/9729) [`1493d65`](https://github.com/Kilo-Org/kilocode/commit/1493d656c9afcafd41a13b45bdf734fb881536df) - Keep Remote status visible in the TUI while remote control is connecting.

- [#9669](https://github.com/Kilo-Org/kilocode/pull/9669) [`0bf14eb`](https://github.com/Kilo-Org/kilocode/commit/0bf14eb2ff5ef59f9dc98342218addc670a87481) - Stop emitting `ai.*` and `gen_ai.*` OpenTelemetry spans from AI SDK calls, and remove the PostHog bridge that forwarded them. Tool/session/indexing telemetry is unchanged.

## 7.2.31

### Patch Changes

- [#9687](https://github.com/Kilo-Org/kilocode/pull/9687) [`9028174`](https://github.com/Kilo-Org/kilocode/commit/9028174cfd5fdd0cf2f3dd87d5ace7cfa780cc4d) - Show compact todo update cards when checking off items in long todo lists.

## 7.2.30

### Patch Changes

- [#9625](https://github.com/Kilo-Org/kilocode/pull/9625) [`1e01ac3`](https://github.com/Kilo-Org/kilocode/commit/1e01ac3ce09070a42c079daf0ff8f07a0e6f7b23) - Respect configured agent models when reopening the CLI or switching projects.

- [#9434](https://github.com/Kilo-Org/kilocode/pull/9434) [`a995b94`](https://github.com/Kilo-Org/kilocode/commit/a995b94d311a4ff8c49437369d4a0a468fc5f74f) - Fix sessions with large image attachments becoming unusable after compaction. When a conversation includes big inline images, the outgoing request can exceed the gateway's body-size limit even after a successful summary. The CLI now trims pre-summary messages for all successful summaries (including manual `/compact`) and strips media attachments from older turns once a summary exists, so follow-up prompts stay under the gateway limit and the session keeps working.

- [#9450](https://github.com/Kilo-Org/kilocode/pull/9450) [`2032fe4`](https://github.com/Kilo-Org/kilocode/commit/2032fe4c4e574aa0664a1ab91e34633ce5b261f9) - Fix a session hang that could occur when multiple Kilo panels showed the same permission prompt, or when a subagent's permission was replied to from the wrong worktree. Replies are now routed to the exact CLI instance that holds the pending permission, and stale/unknown permissions surface a clear error so the UI doesn't leave buttons permanently disabled.

- [#9635](https://github.com/Kilo-Org/kilocode/pull/9635) [`cbe5510`](https://github.com/Kilo-Org/kilocode/commit/cbe55103b10cda881ab39f2932a856f4ea36fce3) - Rename the published Docker image from `ghcr.io/kilo-org/kilo` to `ghcr.io/kilo-org/kilocode` so it lives alongside the active `kilocode` repo instead of the archived `kilo` one.

- [#9628](https://github.com/Kilo-Org/kilocode/pull/9628) [`6130a3e`](https://github.com/Kilo-Org/kilocode/commit/6130a3ea66c6a323710fdc2d325fac87011f6b85) - Show paid Kilo models to signed-out users so selecting one prompts them to log in.

- [#9556](https://github.com/Kilo-Org/kilocode/pull/9556) [`eae081a`](https://github.com/Kilo-Org/kilocode/commit/eae081a0c7404aa8a2516739c3f6725e8c4ff115) - Prevent Ask and Plan modes, including saved or allow-all approvals, from editing files before an explicit implementation step.

- [#9615](https://github.com/Kilo-Org/kilocode/pull/9615) [`0907c6f`](https://github.com/Kilo-Org/kilocode/commit/0907c6f46e2e3d8f7601dcaac9de60dd8c0e02ee) - Keep interactive tools available when semantic indexing fails to load.

- [#9603](https://github.com/Kilo-Org/kilocode/pull/9603) [`4145e48`](https://github.com/Kilo-Org/kilocode/commit/4145e48e82d862178102386cd8a1c874b9415696) - Improve Windows worktree cleanup reliability when file handles are released slowly.

- Updated dependencies [[`28a0eae`](https://github.com/Kilo-Org/kilocode/commit/28a0eae4b0b940482222f6671a6885b575b2ad9c), [`6130a3e`](https://github.com/Kilo-Org/kilocode/commit/6130a3ea66c6a323710fdc2d325fac87011f6b85)]:
  - @kilocode/kilo-indexing@7.1.4
  - @kilocode/kilo-gateway@7.2.27
  - @kilocode/kilo-telemetry@7.2.27

## 7.2.26

### Patch Changes

- [#9549](https://github.com/Kilo-Org/kilocode/pull/9549) [`a5bca01`](https://github.com/Kilo-Org/kilocode/commit/a5bca011a16077d4394f9b5650a387f235cc77b2) - Prefer ChatGPT OAuth credentials over inherited OpenAI environment variables and make ChatGPT sign-in easier to find.

- [#9448](https://github.com/Kilo-Org/kilocode/pull/9448) [`73ab363`](https://github.com/Kilo-Org/kilocode/commit/73ab363f9a1592721d4ce4b92d1a083b7bc8176b) - Fix session cost display missing subagent costs. The TUI footer, sidebar, web context panel, and ACP usage reports now include the cost of every subagent the session spawned, including nested ones.

- [#9484](https://github.com/Kilo-Org/kilocode/pull/9484) [`dbf1135`](https://github.com/Kilo-Org/kilocode/commit/dbf113524ed27e2aaac9afc5441e70339edaa164) - Prompt before agents access files outside the active directory when a workspace boundary resolves to a filesystem root.

## 7.2.25

### Patch Changes

- [#9526](https://github.com/Kilo-Org/kilocode/pull/9526) [`c8113f2`](https://github.com/Kilo-Org/kilocode/commit/c8113f27b190f5c08ce642da57d68646132e1828) - Fix multi-turn DeepSeek reasoning round-tripping on OpenRouter by bumping `@openrouter/ai-sdk-provider` to 2.8.1 in both the CLI and Kilo Gateway packages and letting the SDK handle reasoning details, plus pulling in upstream DeepSeek variant, reasoning-effort, and assistant-reasoning fixes. New DeepSeek conversations are fixed; existing sessions that already stored empty reasoning metadata may still need to be restarted.

- Updated dependencies [[`c8113f2`](https://github.com/Kilo-Org/kilocode/commit/c8113f27b190f5c08ce642da57d68646132e1828)]:
  - @kilocode/kilo-gateway@7.2.25
  - @kilocode/kilo-telemetry@7.2.25

## 7.2.23

### Minor Changes

- [#9418](https://github.com/Kilo-Org/kilocode/pull/9418) [`12c2d86`](https://github.com/Kilo-Org/kilocode/commit/12c2d86c84ecfce118ffb5b4db7ed4155bbca8fc) - Show the open GitHub PR for the current branch in the session sidebar.

### Patch Changes

- [#9470](https://github.com/Kilo-Org/kilocode/pull/9470) [`7fe4508`](https://github.com/Kilo-Org/kilocode/commit/7fe4508eecf7e7da8336f75c0884d1b310af6c6e) - Fix multi-turn tool calls with DeepSeek thinking mode by preserving empty `reasoning_content` in the interleaved transform.

## 7.2.22

### Patch Changes

- [#9455](https://github.com/Kilo-Org/kilocode/pull/9455) [`567ca0d`](https://github.com/Kilo-Org/kilocode/commit/567ca0d34178a6a896aa58c10cc946565c116d4e) - Fix a 1-2 second startup delay before home content (agents, news, tips) appears in the TUI.

- [#9425](https://github.com/Kilo-Org/kilocode/pull/9425) [`6ee160f`](https://github.com/Kilo-Org/kilocode/commit/6ee160f89c10293d635990798779988d34b092b4) - Preserve typed text in the main prompt when a blocking question, suggestion, permission, or network overlay is shown and then dismissed.

## 7.2.21

### Minor Changes

- [#8587](https://github.com/Kilo-Org/kilocode/pull/8587) [`010a946`](https://github.com/Kilo-Org/kilocode/commit/010a94698e449bdd9270f44e53aa209dd4c7a248) - The agent now detects and preserves the original text encoding of files when reading and editing them, so non-UTF-8 files are displayed correctly to the model and written back in their original encoding. New files are still created as UTF-8 without BOM — detection only applies when overwriting or editing an existing file.

  Supported: UTF-8 (with or without BOM), UTF-16 with BOM, and common legacy Latin and CJK encodings (Shift_JIS, EUC-JP, GB2312, Big5, EUC-KR, Windows-1251, KOI8-R, ISO-8859, and others).

  Not supported: UTF-16 without BOM, UTF-32.

### Patch Changes

- [#9298](https://github.com/Kilo-Org/kilocode/pull/9298) [`8d06a08`](https://github.com/Kilo-Org/kilocode/commit/8d06a083bce0d87ad55adeb57b043cc5607979eb) - CLI suggestions now render inline in the conversation at the position of the suggest tool call, instead of as a separate bar above the prompt input. The inline bar renders as a single full-width row with a subtle background and clickable action buttons, matching the VS Code extension. Dismissal happens automatically when you send a new prompt. Blocking suggestions still use the above-prompt overlay.

- [#9298](https://github.com/Kilo-Org/kilocode/pull/9298) [`2ba203b`](https://github.com/Kilo-Org/kilocode/commit/2ba203b6bdad1b759b26501e74d278d13f77f69b) - CLI suggestions now render above an active input prompt. You can keep typing and submit a new message while a suggestion is on screen — sending a message auto-dismisses the pending suggestion, matching the VS Code extension behavior. The redundant "Dismiss" row has been removed; click an option to accept, or press Esc to dismiss.

- [#9344](https://github.com/Kilo-Org/kilocode/pull/9344) [`c032fc2`](https://github.com/Kilo-Org/kilocode/commit/c032fc2021c55589ff7aee747d8f8a871e77bc56) - Fix an infinite "busy" loop that could occur when a model kept reporting context overflow after every compaction. Each turn now caps compactions at three attempts and closes the turn with a visible context-overflow error instead of silently looping forever.

- [#9408](https://github.com/Kilo-Org/kilocode/pull/9408) [`c214d63`](https://github.com/Kilo-Org/kilocode/commit/c214d63afb426df0b3499b5240fe5ce525561497) - Narrow when the CLI suggests a local code review so it no longer surfaces after PR-comment replies, reactive fixes (CI/lint failures, reported issues), trivial edits, non-implementation work (research, commits, docs), or review-adjacent turns.

## 7.2.19

### Patch Changes

- Updated dependencies [[`3b73cf4`](https://github.com/Kilo-Org/kilocode/commit/3b73cf474ee7bd81ac1cb4a0153906059f3a2d3a)]:
  - @kilocode/kilo-gateway@7.2.19
  - @kilocode/kilo-telemetry@7.2.19

## 7.2.18

### Patch Changes

- [#9300](https://github.com/Kilo-Org/kilocode/pull/9300) [`0d0dabe`](https://github.com/Kilo-Org/kilocode/commit/0d0dabe59838e48ec8633227c508531e2296dde9) - Fix the "Start new session" button on the plan follow-up prompt not switching the VS Code Agent Manager to the new session when handover generation is slow. The new session now opens immediately, shows the plan text right away, stays visibly busy while the handover summary is being prepared, and appends that summary once it finishes generating.

## 7.2.17

### Patch Changes

- [#9276](https://github.com/Kilo-Org/kilocode/pull/9276) [`e6310c5`](https://github.com/Kilo-Org/kilocode/commit/e6310c5292b43745c3c6e75a08bb584f7f1fd6d5) - Add Alibaba to `kiloProviderOptions` so thinking is enabled correctly when routing through the Kilo gateway with `ai_sdk_provider: "alibaba"`.

- [#9120](https://github.com/Kilo-Org/kilocode/pull/9120) [`d40fc1c`](https://github.com/Kilo-Org/kilocode/commit/d40fc1c71cde67568c37f30a9653ec1ac2a84131) - Make the `description` parameter of the bash tool optional.

- [#9239](https://github.com/Kilo-Org/kilocode/pull/9239) [`2b17a7b`](https://github.com/Kilo-Org/kilocode/commit/2b17a7b4e80bb2bd30bd95d047c31ad17dd339b6) - Fix custom provider model and variant deletions being silently reverted on save. Removing a model or reasoning variant from a custom provider now actually removes it from your config.

- [#9193](https://github.com/Kilo-Org/kilocode/pull/9193) [`f025e34`](https://github.com/Kilo-Org/kilocode/commit/f025e34b6a91d3e5bd6e5b174105a77ea6d87f6d) - Clarify suggest tool guidance so the assistant writes its final summary before offering a local review.

- [#9164](https://github.com/Kilo-Org/kilocode/pull/9164) [`448dba8`](https://github.com/Kilo-Org/kilocode/commit/448dba8ca595ff95220ab660cbc93ca40b90a19b) - Update `@ai-sdk/anthropic` to 3.0.71, adding `xhigh` effort for Opus 4.7 adaptive thinking (3.0.70) and fixing fine-grained tool streaming beta header for Opus 4.7 (3.0.71)

- [#9170](https://github.com/Kilo-Org/kilocode/pull/9170) [`297b988`](https://github.com/Kilo-Org/kilocode/commit/297b988a211933e106bf2864518e3542587d3f0b) - Update `@ai-sdk/amazon-bedrock` to 4.0.96 and `@ai-sdk/google-vertex` to 4.0.112, both of which include Opus 4.7 support with `xhigh` adaptive thinking effort

- Updated dependencies [[`8b90eec`](https://github.com/Kilo-Org/kilocode/commit/8b90eec6d0852305ae4379088b1003c1d4e74e6a), [`448dba8`](https://github.com/Kilo-Org/kilocode/commit/448dba8ca595ff95220ab660cbc93ca40b90a19b)]:
  - @kilocode/kilo-gateway@7.3.0
  - @kilocode/kilo-telemetry@7.2.15

## 7.2.14

### Patch Changes

- [#9118](https://github.com/Kilo-Org/kilocode/pull/9118) [`343455b`](https://github.com/Kilo-Org/kilocode/commit/343455b87895a0551760b5710b1ffe58fae21efd) - Respect per-agent model selections when an agent has a `model` configured in `kilo.jsonc`. Switching the model for such an agent now sticks across agent switches and CLI restarts. To pick up a newly edited agent default, re-select the model once (or clear `~/.local/share/kilo/storage/model.json`).

- [#9067](https://github.com/Kilo-Org/kilocode/pull/9067) [`959a8b4`](https://github.com/Kilo-Org/kilocode/commit/959a8b498de6efd28756683162296dd40eb9b454) - Fix "assistant prefill" errors when a user queues a prompt while the previous turn is still streaming. The queued message no longer lands in the middle of the prior turn's history, so the next request always ends with the user prompt.

- [#9023](https://github.com/Kilo-Org/kilocode/pull/9023) [`5301258`](https://github.com/Kilo-Org/kilocode/commit/530125828e891d3c50fe8d783201b65e3c4db8e4) - Support mentioning folders in the prompt with @ references, including top-level folder file contents.

## 7.2.12

### Patch Changes

- [#9068](https://github.com/Kilo-Org/kilocode/pull/9068) [`e65c2d9`](https://github.com/Kilo-Org/kilocode/commit/e65c2d99c0d234d3dc1dff2e75e58e22bea8ce7f) Thanks [@kilo-code-bot](https://github.com/apps/kilo-code-bot)! - Hide Kilo Gateway models that do not support tool calling from the model list.

- [#9069](https://github.com/Kilo-Org/kilocode/pull/9069) [`e60c326`](https://github.com/Kilo-Org/kilocode/commit/e60c3263191c5746bea6bd93cd291c28f5d1ab0f) Thanks [@kilo-code-bot](https://github.com/apps/kilo-code-bot)! - Support adaptive reasoning for Claude Opus 4.7 and expose the `xhigh` effort level for adaptive Anthropic models

- Updated dependencies [[`e65c2d9`](https://github.com/Kilo-Org/kilocode/commit/e65c2d99c0d234d3dc1dff2e75e58e22bea8ce7f)]:
  - @kilocode/kilo-gateway@7.2.12
  - @kilocode/kilo-telemetry@7.2.12

## 7.2.11

### Patch Changes

- [#8898](https://github.com/Kilo-Org/kilocode/pull/8898) [`4a69a3e`](https://github.com/Kilo-Org/kilocode/commit/4a69a3e0d11a041827c1c68e1a47f84ed0f4c893) - Fixed default model falling back to the free model after login or org switch by invalidating cached provider state when auth changes.

- [#8996](https://github.com/Kilo-Org/kilocode/pull/8996) [`58ff01a`](https://github.com/Kilo-Org/kilocode/commit/58ff01a2bcac172ae93e4213046a3e9c6c353f59) Thanks [@kilo-code-bot](https://github.com/apps/kilo-code-bot)! - Include pnpm-lock.yaml and yarn.lock in the .kilo/.gitignore so lockfiles from alternative package managers don't appear as untracked files

- [`4937759`](https://github.com/Kilo-Org/kilocode/commit/4937759bf46737a9300d4effedd627676ab4ca68) - Merged upstream opencode changes from v1.3.10:
  - Subagent tool calls stay clickable while pending
  - Improved storage migration reliability
  - Better muted text contrast in Catppuccin themes

- [`4937759`](https://github.com/Kilo-Org/kilocode/commit/4937759bf46737a9300d4effedd627676ab4ca68) - Merged upstream opencode changes from v1.3.6:
  - Fixed token usage double-counting for Anthropic and Amazon Bedrock providers
  - Fixed variant dialog search filtering

- [`4937759`](https://github.com/Kilo-Org/kilocode/commit/4937759bf46737a9300d4effedd627676ab4ca68) - Merged upstream opencode changes from v1.3.7:
  - Added first-class PowerShell support on Windows
  - Plugin installs now preserve JSONC comments in configuration files
  - Improved variant modal behavior to be less intrusive

- [#9047](https://github.com/Kilo-Org/kilocode/pull/9047) [`bea8878`](https://github.com/Kilo-Org/kilocode/commit/bea88788f4530f57d210b98cd7205168cd8f9ae9) - Continue queued follow-up prompts after the active session turn finishes.

- Updated dependencies [[`4d2f553`](https://github.com/Kilo-Org/kilocode/commit/4d2f55343b7403625c60de09460d01ab8ae268f7)]:
  - @kilocode/kilo-gateway@7.2.11
  - @kilocode/kilo-telemetry@7.2.11
