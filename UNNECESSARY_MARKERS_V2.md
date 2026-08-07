# OpenCode v1.18.14..v1.18.15 Merge Review (Round 2): Unnecessary Markers & Reset Candidates Report

## Scope & Methodology

This report constitutes **Round 2** of the specialized code review auditing `kilocode_change` annotations, upstream drift, and reset candidates for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (OpenCode `v1.18.14` through `v1.18.15` merge into Kilo Code).

### Parameters
- **Base Branch / Ref**: `origin/johnnyeric/kilo-opencode-v1.18.13` (commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0`)
- **Reviewed Branch Head**: `HEAD` / `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `db7c9eb7ebe652b897c3ca5e8e76b06d25175024`)
- **Main Branch**: `origin/main`
- **Upstream Target**: `v1.18.15` (commit `d7b115f623760e68a4749d16508a9eca350f246f`)
- **Total Files Changed in PR**: 98 files across `packages/opencode`, `packages/session-ui`, `packages/tui`, `packages/ui`, `packages/sdk-next`, `packages/kilo-ui`, `packages/kilo-vscode`, `script`, `.github`, and root

### Review Methodology
1. **Automated Reset Candidate Analysis**: Executed `bun run script/upstream/find-reset-candidates.ts --dry-run` scoped across each workspace package (`packages/opencode/src`, `packages/tui`, `packages/ui`, `packages/session-ui`, `packages/sdk/js`, `packages/plugin`, `packages/util`) to classify files into drift buckets (`identical`, `markers-only`, `cosmetic-only`, `small-diff`, `large-diff`).
2. **Per-Marker AST & Upstream Alignment Audit**: Evaluated every `kilocode_change` marker (inline and block) across all 98 files modified in the PR branch range against upstream `v1.18.15` at both raw byte and transformed branding levels (`script/upstream/utils/upstream.ts:translate`).
3. **Recent Fix Commits Audit**: Audited recent review fix commits (`421208c648` through `db7c9eb7eb`) touching `packages/tui/src/component/prompt/index.tsx`, `packages/tui/src/context/sync.tsx`, `packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts`, `packages/opencode/src/acp/event.ts`, `packages/opencode/src/session/retry.ts`, `packages/session-ui/src/components/basic-tool.tsx`, `packages/kilo-ui/src/i18n/fa.ts`, and architecture scripts.
4. **Annotation Policy Compliance**: Verified marker semantics against `script/check-opencode-annotations.ts` and `AGENTS.md` rules to confirm that marker removals do not cause unannotated divergence in CI.
5. **Exempt Path Verification**: Audited annotations located within Kilo-owned directories (`packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`, `packages/kilo-*`).

---

## Findings

### 1. Stale Inline Marker on Upstream-Adopted Config in `packages/opencode/src/cli/cmd/web.ts`
- **Location**: `packages/opencode/src/cli/cmd/web.ts:14`
- **Current Code**:
  ```ts
  // Server loads instances per-request via x-kilo-directory header — no
  // ambient project InstanceContext needed at startup.
  instance: false, // kilocode_change
  ```
- **Upstream Comparison (`v1.18.15:packages/opencode/src/cli/cmd/web.ts:36`)**:
  ```ts
  // Server loads instances per-request via x-opencode-directory header — no
  // ambient project InstanceContext needed at startup.
  instance: false,
  ```
- **Analysis**: Upstream OpenCode natively sets `instance: false` on `WebCommand`. The line `instance: false,` is verbatim identical to upstream, making the `// kilocode_change` marker obsolete.
- **Recommended Action**: Remove the trailing `// kilocode_change` on line 14.

---

### 2. Stale Inline Marker on Upstream Action Name in `packages/tui/src/component/prompt/index.tsx`
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
- **Analysis**: Upstream `v1.18.15` natively includes `"prompt.skills"` in the prompt palette action list. The `// kilocode_change` marker on line 628 is obsolete. (Note: recent fix commit `421208c648` correctly added markers to lines 278 and 1611 for `!vim.vimEnabled()`, but line 628 remained untouched).
- **Recommended Action**: Remove `// kilocode_change` from line 628 (`"prompt.skills"`).

---

### 3. Stale Inline Marker on Native Framework Import in `packages/tui/src/routes/session/index.tsx`
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

### 4. Stale Inline Marker on Upstream Import in `packages/opencode/test/session/prompt.test.ts`
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

### 5. Stray Marker on Closing Parenthesis in `packages/opencode/test/session/processor-effect.test.ts`
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
- **Upstream Comparison (`v1.18.15:packages/opencode/test/session/processor-effect.test.ts`)**:
  The test ending at line 1150 is the upstream test `"session.processor effect tests retain partial legacy parts without v2 events"`.
- **Analysis**: The closing parenthesis on line 1150 belongs to the upstream test and is verbatim identical to upstream. The following Kilo test on line 1153 is already properly wrapped with its own `// kilocode_change start` / `end` block.
- **Recommended Action**: Remove `// kilocode_change` from line 1150.

---

### 6. Superfluous Marker on Syntactically Unchanged Callsite in `packages/opencode/src/session/message-v2.ts`
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
- **Upstream Comparison (`v1.18.15:packages/opencode/src/session/message-v2.ts:503`)**:
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
- **Analysis**: The line `return rows.map(part)` is verbatim identical to upstream. The actual Kilo modification is the definition of `part(...)` earlier in the file (lines 206-215). Marking line 632 serves only as explanatory commentary.
- **Recommended Action**: Convert `// kilocode_change - ...` on line 632 to a standard comment `// note: part() applies stripPartMetadata ...` or remove the marker prefix.

---

### 7. Harmless Markers in Exempt Paths (Convention Review)
- **Location 1**: `packages/opencode/src/kilocode/tool/agent-manager.ts:1` (`// kilocode_change - new file`)
- **Location 2**: `packages/opencode/test/kilocode/help.test.ts:10` (`import { ProvidersCommand } ... // kilocode_change — upstream renamed auth → providers`)
- **Analysis**: Under `AGENTS.md` and `script/check-opencode-annotations.ts`, all paths containing `kilocode` in directory or filename are strictly Kilo-owned and exempt from annotations. Markers inside these directories are redundant.
- **Recommended Action**: Optional cleanup; harmless for merge mechanics.

---

## Notable Non-Findings

### 1. 34 Upstream Locale Dictionaries (`packages/ui/src/i18n/*.ts`) Are Mandatory Markers
- `find-reset-candidates.ts` classifies 34 locale files under `packages/ui/src/i18n/` (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`) as `markers-only`.
- **Reason for Tool Classification**: The tool applies `translate()` during comparison, which automatically converts upstream `"OpenCode Go"` to `"Kilo Go"`.
- **Repository Reality**: In the actual source files, upstream has `"OpenCode Go"` and Kilo has `"Kilo Go"`. The `// kilocode_change` marker on `dialog.usageExceeded.freeTier.description` is **required** by `script/check-opencode-annotations.ts` to annotate the branding replacement.
- **Verdict**: These 34 markers are **REQUIRED** and must NOT be reset to raw upstream.

### 2. Upstream-Identical Files in PR #13002 Carry Zero Stale Markers
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

### 3. Recent Fix Commits (Round 2) Introduce Verified, Legitimate Markers
- All markers introduced in recent commits (`421208c648` through `db7c9eb7eb`) were audited and verified to guard genuine Kilo logic:
  - `packages/tui/src/component/prompt/index.tsx` (lines 278, 1611): `if (tuiConfig.cursor && !vim.vimEnabled()) input.cursorStyle = tuiConfig.cursor // kilocode_change` guards vim cursor interaction against upstream cursor style setting.
  - `packages/tui/src/context/sync.tsx` (lines 62-68): `compareMessage` and `messageKey` block marker encapsulates deterministic timestamp padding and ID comparison.
  - `packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts` (lines 106-117): `Stream.runFold` with 64 KiB character budget replaces upstream unbounded text reading.
  - `packages/opencode/src/acp/event.ts` (lines 85, 167-182): `.catch(() => {})` on turn waiters and `waitUntilConnected(timeoutMs = 5000)` bounding.
  - `packages/opencode/src/session/retry.ts` (lines 32, 85): Word-boundary regex matching and non-retryable 4xx suppression.

### 4. Heavy Conflict Files Maintain Clean Marker Boundaries
- Deep verification of major merge conflict files confirmed zero marker drift:
  - `packages/opencode/src/session/compaction.ts` (43 markers): all markers delineate active Kilo payload recovery and truncation hooks.
  - `packages/opencode/src/session/session.ts` (79 markers): all markers delineate active telemetry, worktree family filters, and fork context retention.
  - `packages/opencode/src/session/retry.ts` (15 markers): all markers delineate active Kilo error suppression and network retry rules.
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
[INFO] Candidate files: 262
[INFO] Pre-bucketed 41 (missing or too-large)
[INFO] Classifying 221 file(s)...
[INFO] Classified 221/221

Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 2 | would reset (demo.ts, subagent-data.ts - pre-existing translated imports) |
| cosmetic-only | 1 | would reset (anthropic.txt - pre-existing) |
| small-diff | 42 | would reset |
| large-diff | 146 | skipped |
| identical | 30 | nothing to do |
| upstream-missing | 41 | skipped |
```

### 2. `find-reset-candidates.ts` on `packages/tui`
```text
$ bun run script/upstream/find-reset-candidates.ts packages/tui --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] Scope: packages/tui
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Candidate files: 105
[INFO] Pre-bucketed 10 (missing or too-large)
[INFO] Classifying 95 file(s)...
[INFO] Classified 95/95

Summary:
| Bucket | Count | Action |
|---|---|---|
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
[INFO] Candidate files: 180
[INFO] Skipping 17 non-code asset(s)
[INFO] Pre-bucketed 88 (missing or too-large)
[INFO] Classifying 92 file(s)...
[INFO] Classified 92/92

Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 42 | would reset (34 new i18n locale files + 8 pre-existing) |
| small-diff | 13 | would reset |
| large-diff | 31 | skipped |
| identical | 6 | nothing to do |
| upstream-missing | 88 | skipped |
| non-code-asset | 17 | skipped |
```

---

## Summary of Actionable Items

| # | File | Line | Marker Content | Issue | Recommended Action |
|---|---|---|---|---|---|
| 1 | `packages/opencode/src/cli/cmd/web.ts` | 14 | `instance: false, // kilocode_change` | Upstream v1.18.15 adopted `instance: false` natively | Remove marker |
| 2 | `packages/tui/src/component/prompt/index.tsx` | 628 | `"prompt.skills", // kilocode_change` | Upstream v1.18.15 adopted `"prompt.skills"` natively | Remove marker |
| 3 | `packages/tui/src/routes/session/index.tsx` | 6 | `onCleanup, // kilocode_change` | Native upstream import from `"solid-js"` | Remove marker |
| 4 | `packages/opencode/test/session/prompt.test.ts` | 43 | `import { SessionProjector } ... // kilocode_change` | Upstream imports `SessionProjector` natively | Remove marker |
| 5 | `packages/opencode/test/session/processor-effect.test.ts` | 1150 | `) // kilocode_change` | Stray marker on closing `)` of upstream test | Remove marker |
| 6 | `packages/opencode/src/session/message-v2.ts` | 632 | `return rows.map(part) // kilocode_change ...` | Callsite is identical to upstream line 503 | Convert to standard comment |
| 7 | `packages/opencode/src/kilocode/tool/agent-manager.ts` | 1 | `// kilocode_change - new file` | Inside exempt `kilocode` directory | Optional cleanup |
| 8 | `packages/opencode/test/kilocode/help.test.ts` | 10 | `import ... // kilocode_change ...` | Inside exempt `kilocode` directory | Optional cleanup |

---

## Limitations

- Analysis evaluates PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) commit range `b6505b164bee1acf20d5c33dbc052e8a60c464c0..db7c9eb7ebe652b897c3ca5e8e76b06d25175024` against upstream release tag `v1.18.15` (`d7b115f623760e68a4749d16508a9eca350f246f`).
- Pre-existing markers in untouched files outside the PR diff were scanned via `find-reset-candidates.ts` for context, but actionable findings focus specifically on files modified or affected by PR #13002.
