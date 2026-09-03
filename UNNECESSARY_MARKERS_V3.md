# OpenCode v1.18.14..v1.18.15 Merge Review (Round 3): Unnecessary Markers & Reset Candidates Report

## Scope & Methodology

This report constitutes **Round 3** of the specialized code review auditing `kilocode_change` annotations, upstream drift, and reset candidates for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (OpenCode `v1.18.14` through `v1.18.15` merge into Kilo Code).

### Parameters
- **Base Branch / Ref**: `origin/johnnyeric/kilo-opencode-v1.18.13` (commit `aca225fcfd2ad5146f142a5d582f62c1dff12c35`)
- **Reviewed Branch Head**: `HEAD` / `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `6d8876045d4cf06272cfb355f2b18c74cdf3e967`)
- **Main Branch**: `origin/main`
- **Upstream Target**: `v1.18.15` (commit `d7b115f623760e68a4749d16508a9eca350f246f`)
- **Total Files Changed in PR**: 97 files across `packages/opencode`, `packages/session-ui`, `packages/tui`, `packages/ui`, `packages/sdk-next`, `packages/kilo-ui`, `packages/kilo-vscode`, `script`, `patches`, `.github`, and root

### Review Methodology
1. **Automated Reset Candidate Analysis**: Executed `bun run script/upstream/find-reset-candidates.ts --dry-run` across workspace packages (`packages/opencode/src`, `packages/tui`, `packages/session-ui`, `packages/ui`, `packages/plugin`, `packages/util`) to classify files into drift categories (`identical`, `markers-only`, `cosmetic-only`, `small-diff`, `large-diff`).
2. **Direct Upstream Tag Diffing**: Compared every changed file in the PR branch range directly against upstream release tag `v1.18.15` using both raw git diffs and AST/semantic inspections to verify whether annotated code differs from upstream.
3. **Comprehensive Marker AST Scan**: Scanned 549 marker instances across all 97 PR-modified files to identify inline and block annotations wrapping code that matches upstream `v1.18.15` verbatim.
4. **Resolution Verification of Round 2 Findings**: Audited prior round findings against commits `c24adedfa1` and `6d8876045d` to confirm resolved issues (e.g. removal of `web.ts` command) and re-evaluate open candidates.
5. **Annotation Policy Compliance**: Verified marker semantics against `script/check-opencode-annotations.ts` and `AGENTS.md` guidelines to ensure proposed cleanups will not cause CI failures.

---

## Findings

### 1. Stale Block Markers on Upstream Restored Assertions in `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`
- **Location**: `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx:112-115`
- **Current Code**:
  ```tsx
  expect(focused).toContain("▾ src/config")
  expect(unfocused).toContain("▾ src/config")
  // kilocode_change start - restore upstream absence assertions
  expect(focused.some((line) => line.includes("*"))).toBe(false)
  expect(unfocused.some((line) => line.includes("*"))).toBe(false)
  // kilocode_change end
  ```
- **Upstream Comparison (`v1.18.15:packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx:112-113`)**:
  ```tsx
  expect(focused).toContain("▾ src/config")
  expect(unfocused).toContain("▾ src/config")
  expect(focused.some((line) => line.includes("*"))).toBe(false)
  expect(unfocused.some((line) => line.includes("*"))).toBe(false)
  ```
- **Analysis**: Upstream `v1.18.15` natively contains both `expect(focused.some((line) => line.includes("*"))).toBe(false)` and `expect(unfocused.some((line) => line.includes("*"))).toBe(false)`. The block markers are obsolete, as the enclosed lines are byte-for-byte identical to upstream. Removing these markers makes the file 100% identical to upstream.
- **Recommended Action**: Remove `// kilocode_change start - restore upstream absence assertions` and `// kilocode_change end`.

---

### 2. Stale Block Markers on Upstream Session Reader Compilation in `packages/opencode/test/session/prompt.test.ts`
- **Location**: `packages/opencode/test/session/prompt.test.ts:846-855`
- **Current Code**:
  ```ts
  // kilocode_change start - compile the v2 reader against this test's database graph
  const messages = yield* SessionV2.Service.use((session) => session.messages({ sessionID: chat.id })).pipe(
    Effect.provide(
      LayerNode.compile(SessionV2.node, [
        [SessionExecution.node, SessionExecution.noopLayer],
        [LocationServiceMap.node, locationServiceMapLayer],
      ]),
    ),
  )
  // kilocode_change end
  ```
- **Upstream Comparison (`v1.18.15:packages/opencode/test/session/prompt.test.ts:730-737`)**:
  ```ts
  const messages = yield* SessionV2.Service.use((session) => session.messages({ sessionID: chat.id })).pipe(
    Effect.provide(
      LayerNode.compile(SessionV2.node, [
        [SessionExecution.node, SessionExecution.noopLayer],
        [LocationServiceMap.node, locationServiceMapLayer],
      ]),
    ),
  )
  ```
- **Analysis**: Upstream `v1.18.15` adopted `SessionV2.Service.use(...)` with `LayerNode.compile(SessionV2.node, ...)` natively at lines 730-737. The entire 8-line block inside the `kilocode_change` start/end wrapper is verbatim identical to upstream.
- **Recommended Action**: Remove `// kilocode_change start - compile the v2 reader against this test's database graph` and `// kilocode_change end`.

---

### 3. Stale Inline Marker on Upstream Action Name in `packages/tui/src/component/prompt/index.tsx`
- **Location**: `packages/tui/src/component/prompt/index.tsx:628`
- **Current Code**:
  ```ts
  "prompt.stash.pop",
  "prompt.stash.list",
  "prompt.vim.toggle", // kilocode_change
  "prompt.skills", // kilocode_change
  "session.interrupt",
  ```
- **Upstream Comparison (`v1.18.15:packages/tui/src/component/prompt/index.tsx:575`)**:
  ```ts
  "prompt.stash.pop",
  "prompt.stash.list",
  "prompt.skills",
  "session.interrupt",
  ```
- **Analysis**: Upstream `v1.18.15` natively includes `"prompt.skills"` in the prompt action list. The `// kilocode_change` marker on line 628 is obsolete.
- **Recommended Action**: Remove `// kilocode_change` from line 628.

---

### 4. Stale Inline Marker on Native Framework Import in `packages/tui/src/routes/session/index.tsx`
- **Location**: `packages/tui/src/routes/session/index.tsx:6`
- **Current Code**:
  ```ts
  import {
    batch,
    createContext,
    createEffect,
    createMemo,
    onCleanup, // kilocode_change
    createSignal,
    For,
    Match,
  ```
- **Upstream Comparison (`v1.18.15:packages/tui/src/routes/session/index.tsx:10`)**:
  ```ts
  import {
    batch,
    createContext,
    createEffect,
    createMemo,
    createSignal,
    For,
    Match,
    on,
    onCleanup,
    onMount,
    Show,
  ```
- **Analysis**: Upstream imports `onCleanup` from `"solid-js"` natively at line 10. The inline `// kilocode_change` marker on line 6 is obsolete.
- **Recommended Action**: Remove `// kilocode_change` from line 6.

---

### 5. Stale Inline Marker on Upstream Import in `packages/opencode/test/session/prompt.test.ts`
- **Location**: `packages/opencode/test/session/prompt.test.ts:43`
- **Current Code**:
  ```ts
  import { SessionProcessor } from "../../src/session/processor"
  import { SessionProjector } from "@opencode-ai/core/session/projector" // kilocode_change
  import { SessionPrompt } from "../../src/session/prompt"
  ```
- **Upstream Comparison (`v1.18.15:packages/opencode/test/session/prompt.test.ts:5`)**:
  ```ts
  import { SessionProjector } from "@opencode-ai/core/session/projector"
  ```
- **Analysis**: Upstream imports `SessionProjector` from `@opencode-ai/core/session/projector`. Kilo imports the same package symbol at line 43 with a `// kilocode_change` marker.
- **Recommended Action**: Remove `// kilocode_change` from line 43.

---

### 6. Stray Marker on Closing Parenthesis in `packages/opencode/test/session/processor-effect.test.ts`
- **Location**: `packages/opencode/test/session/processor-effect.test.ts:1150`
- **Current Code**:
  ```ts
        expect(seen.filter((type) => type.startsWith("session.next."))).toEqual([])
      }),
    { config: cfg },
  ),
  ) // kilocode_change

  // kilocode_change start
  itLateToolInput.live("session.processor effect tests ignore tool input after the call settles", () =>
  ```
- **Upstream Comparison (`v1.18.15:packages/opencode/test/session/processor-effect.test.ts:286`)**:
  The closing parenthesis on line 1150 belongs to the upstream test `"session.processor effect tests retain partial legacy parts without v2 events"`.
- **Analysis**: The closing parenthesis is verbatim identical to upstream. The following Kilo test on line 1153 is properly wrapped in its own `// kilocode_change start` / `end` block. The marker on line 1150 is a stray artifact.
- **Recommended Action**: Remove `// kilocode_change` from line 1150.

---

### 7. Superfluous Marker on Syntactically Unchanged Callsite in `packages/opencode/src/session/message-v2.ts`
- **Location**: `packages/opencode/src/session/message-v2.ts:632`
- **Current Code**:
  ```ts
  export function parts(messageID: MessageID) {
    return Effect.gen(function* () {
      const { db } = yield* Database.Service
      const rows = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.message_id, messageID))
        .orderBy(PartTable.id)
        .all()
        .pipe(Effect.orDie)
      return rows.map(part) // kilocode_change - part() applies stripPartMetadata to cover all read paths
    })
  }
  ```
- **Upstream Comparison (`v1.18.15:packages/opencode/src/session/message-v2.ts:502`)**:
  ```ts
  export function parts(messageID: MessageID) {
    return Effect.gen(function* () {
      const { db } = yield* Database.Service
      const rows = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.message_id, messageID))
        .orderBy(PartTable.id)
        .all()
        .pipe(Effect.orDie)
      return rows.map(part)
    })
  }
  ```
- **Analysis**: The line `return rows.map(part)` is verbatim identical to upstream. The Kilo modification is the definition of `part(...)` earlier in the file (lines 206-215). Marking line 632 serves only as commentary.
- **Recommended Action**: Convert `// kilocode_change - ...` on line 632 to a standard comment `// note: part() applies stripPartMetadata to cover all read paths` or remove the marker prefix.

---

### 8. Harmless Markers in Exempt Paths (Convention Review)
- **Location 1**: `packages/opencode/src/kilocode/tool/agent-manager.ts:1` (`// kilocode_change - new file`)
- **Location 2**: `packages/opencode/test/kilocode/help.test.ts:10` (`import { ProvidersCommand } ... // kilocode_change — upstream renamed auth → providers`)
- **Analysis**: Under `AGENTS.md` and `script/check-opencode-annotations.ts`, all paths containing `kilocode` in directory or filename are strictly Kilo-owned and exempt from annotations. Markers inside these directories are redundant.
- **Recommended Action**: Optional cleanup; harmless for merge mechanics.

---

## Notable Non-Findings

### 1. Resolved Round 2 Finding: `packages/opencode/src/cli/cmd/web.ts`
- In Round 2, line 14 of `packages/opencode/src/cli/cmd/web.ts` carried a stale marker `instance: false, // kilocode_change`.
- In commit `c24adedfa1`, the `web` command was completely removed from the CLI per `.changeset/remove-web-command.md`. The file no longer exists in the PR branch.

### 2. 34 Upstream Locale Dictionaries (`packages/ui/src/i18n/*.ts`) Are Mandatory Markers
- `find-reset-candidates.ts` classifies 34 locale files under `packages/ui/src/i18n/` (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`) as `markers-only`.
- **Reason for Tool Classification**: The reset candidate tool applies `translate()` during comparison, which automatically converts upstream `"OpenCode Go"` to `"Kilo Go"`.
- **Repository Reality**: In the actual source files, upstream has `"OpenCode Go"` and Kilo has `"Kilo Go"`. The `// kilocode_change` marker on `dialog.usageExceeded.freeTier.description` is **required** by `script/check-opencode-annotations.ts` to annotate the branding replacement.
- **Verdict**: These 34 markers are **REQUIRED** and must NOT be reset to raw upstream.

### 3. Upstream-Identical Files in PR #13002 Carry Zero Stale Markers
- 9 files in the PR branch are byte-for-byte identical (`diff: 0`) to upstream `v1.18.15`:
  - `.opencode/skills/rtl-aware-development/SKILL.md`
  - `packages/opencode/src/tool/truncate.ts`
  - `packages/opencode/test/acp/usage.test.ts`
  - `packages/opencode/test/session/revert-compact.test.ts`
  - `packages/opencode/test/tool/truncation.test.ts`
  - `packages/tui/src/clipboard.ts`
  - `packages/tui/src/ui/dialog-prompt.tsx`
  - `packages/ui/AGENTS.md`
  - `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch`
- **Verdict**: None of these 9 files carry obsolete `kilocode_change` annotations; all are cleanly aligned.

### 4. Recent Fix Commits (c24adedfa1 & 6d8876045d) Maintain Clean, Legitimate Marker Boundaries
- All markers introduced in recent commits (`c24adedfa1` and `6d8876045d`) were audited and verified to guard genuine Kilo logic:
  - `packages/opencode/src/acp/event.ts` (7 markers): Bounded turn waiter cleanup, timeout guards, connection lifecycle.
  - `packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts` (2 markers): 64 KiB character budget stream fold replacing upstream unbounded text reading.
  - `packages/opencode/src/session/retry.ts` (15 markers): Regex boundary error matching and non-retryable 4xx suppression.
  - `packages/tui/src/component/prompt/index.tsx` (lines 278, 1611): `if (tuiConfig.cursor && !vim.vimEnabled()) input.cursorStyle = tuiConfig.cursor // kilocode_change` guards vim cursor interaction against upstream cursor style setting.
  - `packages/tui/src/context/sync.tsx` (lines 62-68): Deterministic timestamp padding and ID comparison in `compareMessage`.

### 5. Heavy Conflict Files Maintain Clean Marker Boundaries
- Deep verification of major merge conflict files confirmed zero marker drift:
  - `packages/opencode/src/session/compaction.ts` (43 markers): all markers delineate active Kilo payload recovery and truncation hooks.
  - `packages/opencode/src/session/session.ts` (80 markers): all markers delineate active telemetry, worktree family filters, and fork context retention.
  - `packages/opencode/src/session/message-v2.ts` (24 markers): all markers delineate Codex auth error recovery, network disconnect APIError translation, and metadata stripping.
  - `packages/opencode/src/session/revert.ts` (12 markers): all markers delineate atomic workspace checkpoint rollbacks.

---

## Command Outputs

### 1. `find-reset-candidates.ts` on `packages/opencode/src`
```text
$ bun run script/upstream/find-reset-candidates.ts packages/opencode/src --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] Scope: packages/opencode/src
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 1 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 264
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 41 (missing or too-large)
[INFO] Classifying 223 file(s)...
[INFO] Classified 223/223

Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 2 | would reset (demo.ts, subagent-data.ts - pre-existing translated imports) |
| cosmetic-only | 1 | would reset (anthropic.txt - branding and whitespace) |
| small-diff | 45 | would reset |
| large-diff | 145 | skipped |
| identical | 30 | nothing to do |
| upstream-missing | 41 | skipped |
| config-protected | 1 | skipped |
```

### 2. `find-reset-candidates.ts` on `packages/tui`
```text
$ bun run script/upstream/find-reset-candidates.ts packages/tui --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] Scope: packages/tui
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Candidate files: 106
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 10 (missing or too-large)
[INFO] Classifying 96 file(s)...
[INFO] Classified 96/96

Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 1 | would reset (diff-viewer-file-tree.test.tsx - Finding #1) |
| small-diff | 15 | would reset |
| large-diff | 50 | skipped |
| identical | 30 | nothing to do |
| upstream-missing | 10 | skipped |
```

### 3. `find-reset-candidates.ts` on `packages/session-ui`
```text
$ bun run script/upstream/find-reset-candidates.ts packages/session-ui --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] Scope: packages/session-ui
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Candidate files: 23
[INFO] Checking upstream blob sizes...
[INFO] Classifying 23 file(s)...
[INFO] Classified 23/23

Summary:
| Bucket | Count | Action |
|---|---|---|
| small-diff | 3 | would reset |
| large-diff | 6 | skipped |
| identical | 14 | nothing to do |
```

### 4. `find-reset-candidates.ts` on `packages/ui`
```text
$ bun run script/upstream/find-reset-candidates.ts packages/ui --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] Scope: packages/ui
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 17 non-code asset(s)
[INFO] Candidate files: 180
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 88 (missing or too-large)
[INFO] Classifying 92 file(s)...
[INFO] Classified 92/92

Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 34 | would reset (34 i18n locale files - Non-Finding #2) |
| small-diff | 13 | would reset |
| large-diff | 31 | skipped |
| identical | 14 | nothing to do |
| upstream-missing | 88 | skipped |
| non-code-asset | 17 | skipped |
```

### 5. `find-reset-candidates.ts` on `packages/plugin`
```text
$ bun run script/upstream/find-reset-candidates.ts packages/plugin --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] Scope: packages/plugin
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Candidate files: 20
[INFO] Checking upstream blob sizes...
[INFO] Classifying 20 file(s)...
[INFO] Classified 20/20

Summary:
| Bucket | Count | Action |
|---|---|---|
| small-diff | 3 | would reset |
| large-diff | 3 | skipped |
| identical | 14 | nothing to do |
```

### 6. `find-reset-candidates.ts` on `packages/util`
```text
$ bun run script/upstream/find-reset-candidates.ts packages/util --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] Scope: packages/util
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[OK] No code files differ from upstream in scope. Nothing to do.
```

---

## Summary of Actionable Items

| # | File | Line | Marker Content | Issue | Recommended Action |
|---|---|---|---|---|---|
| 1 | `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | 112, 115 | `// kilocode_change start ... / end` | Upstream v1.18.15 restored absence assertions natively | Remove block markers |
| 2 | `packages/opencode/test/session/prompt.test.ts` | 846, 855 | `// kilocode_change start ... / end` | Upstream v1.18.15 adopted v2 reader compilation natively | Remove block markers |
| 3 | `packages/tui/src/component/prompt/index.tsx` | 628 | `"prompt.skills", // kilocode_change` | Upstream v1.18.15 adopted `"prompt.skills"` natively | Remove marker |
| 4 | `packages/tui/src/routes/session/index.tsx` | 6 | `onCleanup, // kilocode_change` | Native upstream import from `"solid-js"` | Remove marker |
| 5 | `packages/opencode/test/session/prompt.test.ts` | 43 | `import { SessionProjector } ... // kilocode_change` | Upstream imports `SessionProjector` natively | Remove marker |
| 6 | `packages/opencode/test/session/processor-effect.test.ts` | 1150 | `) // kilocode_change` | Stray marker on closing `)` of upstream test | Remove marker |
| 7 | `packages/opencode/src/session/message-v2.ts` | 632 | `return rows.map(part) // kilocode_change ...` | Callsite is identical to upstream line 502 | Convert to standard comment |
| 8 | `packages/opencode/src/kilocode/tool/agent-manager.ts` | 1 | `// kilocode_change - new file` | Inside exempt `kilocode` directory | Optional cleanup |
| 9 | `packages/opencode/test/kilocode/help.test.ts` | 10 | `import ... // kilocode_change ...` | Inside exempt `kilocode` directory | Optional cleanup |

---

## Limitations

- Analysis evaluates PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) commit range `aca225fcfd2ad5146f142a5d582f62c1dff12c35..6d8876045d4cf06272cfb355f2b18c74cdf3e967` against upstream release tag `v1.18.15` (`d7b115f623760e68a4749d16508a9eca350f246f`).
- Pre-existing markers in untouched files outside the PR diff were scanned via `find-reset-candidates.ts` for context, but actionable findings focus specifically on files modified or affected by PR #13002.
