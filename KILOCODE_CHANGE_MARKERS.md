# `kilocode_change` Audit: PR #12204, Third Pass

Audited immutable PR HEAD `790affb98f75832a33b680885e4d5fa7586a7290` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`, including the latest 51-file compatibility fix.

## Findings

### High: shared Kilo changes have incomplete marker coverage

A standalone marker comment covers only its physical line; it does not annotate the following expression, object, callback, or test. Confirmed incomplete coverage remains in:

- `packages/core/src/config.ts:177-178`
- `packages/core/src/config/plugin/reference.ts:25-27`
- `packages/core/src/connector.ts:499-500`
- `packages/core/src/credential.ts:3-4`
- `packages/core/src/filesystem/search.ts:76`, `:103`, and the Kilo wrappers at `:182-222`
- `packages/core/src/session/projector.ts:23-24`
- `packages/core/src/tool/glob.ts:24-29`
- `packages/core/src/tool/grep.ts:27-35`
- `packages/core/test/config/config.test.ts:165-200`
- `packages/core/test/credential.test.ts:100-101`
- `packages/core/test/reference.test.ts:14-18`, `:44`, `:68`, `:97`, and `:102-123`
- `packages/core/test/session-projector.test.ts:269-271`
- `packages/opencode/src/tool/grep.ts:75-80`

Use trailing inline markers for single-line changes and balanced blocks for multi-line expressions and tests.

### Medium: five nested marker blocks are malformed under the checker

The checker tracks block state with a boolean, not nesting depth. An inner `end` therefore closes the outer block and leaves subsequent outer content uncovered.

Nested blocks remain in:

- `.github/workflows/test.yml:139-144`
- `packages/core/src/tool/glob.ts:122-130`
- `packages/core/test/connector.test.ts:507-552`
- `packages/llm/src/schema/messages.ts:81-92`
- `packages/opencode/src/agent/agent.ts:122-128`

The workflow had malformed nesting at the base, but this PR adds another nested Darwin pair. Remove redundant inner delimiters or split the outer blocks.

### Low: new markers were added in Kilo-owned paths

The latest fixes add unnecessary markers in checker-exempt Kilo-owned paths:

- `packages/core/src/kilocode/session-message.ts:13`, `:32`, and `:40`
- `packages/core/test/kilocode/grep-tool.test.ts:39`

`packages/tui/src/component/kilo-logo.tsx:1` is also PR-introduced and unnecessary because `packages/tui` is Kilo-owned. Remove these comments without changing surrounding code.

## Resolved Functional Items

All functional first- and second-pass marker findings remain resolved: TUI arbitration and dismissed questions, OpenTUI preload wiring, process metadata, Darwin test selection, and OpenRouter variants.

## Evidence And Limitations

The PR changes 1,007 files; marker text changes in 161 paths. No new raw start/end count imbalance exists, and `git diff --check` is clean. The annotation check is not authoritative because upstream merges skip it and its scopes omit `packages/core`, `packages/llm`, and `packages/tui`.

This was a read-only immutable-object audit. No interactive runtime validation was performed.
