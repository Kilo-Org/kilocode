# OpenCode v1.18.14..v1.18.15 Merge Review (Round 4): Unnecessary Markers & Reset Candidates Report

## Scope & Methodology

This report constitutes **Round 4** of the specialized code review auditing `kilocode_change` annotations, upstream drift, and reset candidates for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) (OpenCode `v1.18.14` through `v1.18.15` merge into Kilo Code).

### Parameters
- **Base Branch / Ref**: `origin/johnnyeric/kilo-opencode-v1.18.13` (commit `aca225fcfd2ad5146f142a5d582f62c1dff12c35`)
- **Reviewed PR Head**: `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `860f5d9e680fb2a1b7c77913ba706419e44124b3`)
- **Upstream Target**: `v1.18.15` (commit `d7b115f623760e68a4749d16508a9eca350f246f`)
- **Total Files in PR Scope**: 1,165 files changed across workspace packages (`packages/opencode`, `packages/tui`, `packages/session-ui`, `packages/ui`, `packages/sdk-next`, `packages/kilo-vscode`, `packages/kilo-jetbrains`, `script`, `patches`, etc.)

### Review Methodology
1. **Automated Reset Candidate Analysis**: Ran `bun run script/upstream/find-reset-candidates.ts --dry-run` across workspace packages (`packages/opencode/src`, `packages/tui`, `packages/session-ui`, `packages/ui`, `packages/plugin`, `packages/util`) to classify files into drift categories (`identical`, `markers-only`, `cosmetic-only`, `small-diff`, `large-diff`).
2. **Direct Upstream Tag Diffing**: Compared PR-modified shared files against upstream release tag `v1.18.15` using AST and raw diff comparisons to verify whether annotated code differs from upstream.
3. **Comprehensive Marker AST Scan**: Scanned all `kilocode_change` block and inline marker instances across shared paths in `packages/opencode`, `packages/tui`, `packages/session-ui`, and `packages/ui` to detect annotations wrapping code that matches upstream `v1.18.15` verbatim.
4. **Resolution Verification of Round 3 & Recent Commits**: Audited prior findings against commit `860f5d9e68` (and intermediate commits since Round 3) to confirm resolved items (e.g., marker cleanup in `packages/extensions/zed/extension.toml`) and re-evaluate open candidates.
5. **Annotation Policy Compliance**: Verified marker semantics against `script/check-opencode-annotations.ts` and `AGENTS.md` guidelines to ensure clean merge invariants.

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
- **Analysis**: Upstream `v1.18.15` natively contains both `expect(focused.some((line) => line.includes("*"))).toBe(false)` and `expect(unfocused.some((line) => line.includes("*"))).toBe(false)`. The block markers are obsolete because the enclosed lines are verbatim identical to upstream.
- **Recommended Action**: Remove `// kilocode_change start - restore upstream absence assertions` and `// kilocode_change end`.

---

### 2. Stale Block Markers on Upstream Session Reader Compilation in `packages/opencode/test/session/prompt.test.ts`
- **Location**: `packages/opencode/test/session/prompt.test.ts:845-854`
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
- **Analysis**: Upstream `v1.18.15` natively adopted `SessionV2.Service.use(...)` with `LayerNode.compile(SessionV2.node, ...)` at lines 730-737. The entire 8-line block inside the `kilocode_change` start/end wrapper is verbatim identical to upstream.
- **Recommended Action**: Remove `// kilocode_change start - compile the v2 reader against this test's database graph` and `// kilocode_change end`.

---

### 3. Stale Inline Marker on Upstream Action Name in `packages/tui/src/component/prompt/index.tsx`
- **Location**: `packages/tui/src/component/prompt/index.tsx:627`
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
- **Analysis**: Upstream `v1.18.15` natively includes `"prompt.skills"` in the prompt action list. The `// kilocode_change` marker on line 627 is obsolete.
- **Recommended Action**: Remove `// kilocode_change` from line 627.

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
- **Analysis**: Upstream imports `SessionProjector` from `@opencode-ai/core/session/projector`. Kilo imports the exact same package symbol with an obsolete `// kilocode_change` marker.
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
  The closing parenthesis belongs to the upstream test structure.
- **Analysis**: The closing parenthesis is verbatim identical to upstream. The following Kilo test is properly wrapped in its own `// kilocode_change start` / `end` block. The marker on line 1150 is a stray artifact.
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

### 8. Stale Block Markers on Upstream Truncation Cleanup Implementation in `packages/opencode/src/tool/truncate.ts`
- **Location**: `packages/opencode/src/tool/truncate.ts:54-67`
- **Current Code**:
  ```ts
  const cleanup = Effect.fn("Truncate.cleanup")(function* () {
    // kilocode_change start - use file mtimes because encoded IDs wrap
    const cutoff = Date.now() - Duration.toMillis(RETENTION)
    const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
      Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
      Effect.catch(() => Effect.succeed([])),
    )
    for (const entry of entries) {
      const file = path.join(TRUNCATION_DIR, entry)
      const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const mtime = info && Option.getOrUndefined(info.mtime)
      if (!mtime || mtime.getTime() >= cutoff) continue
      yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
    }
    // kilocode_change end
  })
  ```
- **Upstream Comparison (`v1.18.15:packages/opencode/src/tool/truncate.ts:52-64`)**:
  ```ts
  const cleanup = Effect.fn("Truncate.cleanup")(function* () {
    const cutoff = Date.now() - Duration.toMillis(RETENTION)
    const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
      Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
      Effect.catch(() => Effect.succeed([])),
    )
    for (const entry of entries) {
      const file = path.join(TRUNCATION_DIR, entry)
      const info = yield* fs.stat(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      const mtime = info && Option.getOrUndefined(info.mtime)
      if (!mtime || mtime.getTime() >= cutoff) continue
      yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
    }
  })
  ```
- **Analysis**: Upstream `v1.18.15` natively adopted mtime-based truncation cleanup (commit `d468201952` / upstream PR #40987). The entire 12-line block inside the `kilocode_change` wrapper is 100% byte-for-byte identical to upstream.
- **Recommended Action**: Remove `// kilocode_change start - use file mtimes because encoded IDs wrap` and `// kilocode_change end`.

---

### 9. Stale Block Markers on Upstream Truncation Cleanup Test in `packages/opencode/test/tool/truncation.test.ts`
- **Location**: `packages/opencode/test/tool/truncation.test.ts:245-260`
- **Current Code**:
  ```ts
  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    // kilocode_change start - use IDs across the timestamp wrap and set file times explicitly
    it.live("uses file mtime when IDs wrap", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const fs = yield* FileSystem.FileSystem

        yield* fs.makeDirectory(Truncate.DIR, { recursive: true })

        const old = path.join(Truncate.DIR, Identifier.create("tool", "ascending", 2 ** 36 - 1))
        const recent = path.join(Truncate.DIR, Identifier.create("tool", "ascending", 2 ** 36 + 1))

        yield* writeFileStringScoped(old, "old content")
        yield* writeFileStringScoped(recent, "recent content")
        yield* fs.utimes(old, new Date(), new Date(Date.now() - 10 * DAY_MS))
        yield* fs.utimes(recent, new Date(), new Date(Date.now() - 3 * DAY_MS))
        // kilocode_change end
        yield* svc.cleanup()
  ```
- **Upstream Comparison (`v1.18.15:packages/opencode/test/tool/truncation.test.ts:244-257`)**:
  ```ts
  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    it.live("uses file mtime when IDs wrap", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const fs = yield* FileSystem.FileSystem

        yield* fs.makeDirectory(Truncate.DIR, { recursive: true })

        const old = path.join(Truncate.DIR, Identifier.create("tool", "ascending", 2 ** 36 - 1))
        const recent = path.join(Truncate.DIR, Identifier.create("tool", "ascending", 2 ** 36 + 1))

        yield* writeFileStringScoped(old, "old content")
        yield* writeFileStringScoped(recent, "recent content")
        yield* fs.utimes(old, new Date(), new Date(Date.now() - 10 * DAY_MS))
        yield* fs.utimes(recent, new Date(), new Date(Date.now() - 3 * DAY_MS))
        yield* svc.cleanup()
  ```
- **Analysis**: Upstream `v1.18.15` includes this test natively. The block markers wrap code that is byte-for-byte identical to upstream.
- **Recommended Action**: Remove `// kilocode_change start - use IDs across the timestamp wrap and set file times explicitly` and `// kilocode_change end`.

---

## Notable Non-Findings & Verifications

### 1. Resolved Finding: `packages/extensions/zed/extension.toml` Cleaned Up in Commit `860f5d9e68`
- In commit `860f5d9e68`, Johnny removed the obsolete `# kilocode_change - new file` annotation from line 1 of `packages/extensions/zed/extension.toml`.
- **Verdict**: Verified cleanly resolved; no remaining markers in this file.

### 2. 34 Upstream Locale Dictionaries (`packages/ui/src/i18n/*.ts`) Are Mandatory Markers
- `find-reset-candidates.ts` flags 34 locale files under `packages/ui/src/i18n/` (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`) as `markers-only`.
- **Reason for Tool Classification**: The reset candidate script applies internal `translate()` logic during its comparison phase, which translates upstream `"OpenCode Go"` to `"Kilo Go"`.
- **Repository Reality**: In actual source files, upstream has `"OpenCode Go"` and Kilo has `"Kilo Go"`. The `// kilocode_change` marker on `dialog.usageExceeded.freeTier.description` is **required** by `script/check-opencode-annotations.ts` to annotate the branding difference.
- **Verdict**: These 34 markers are **REQUIRED** and must NOT be removed.

### 3. Loop Reversion Marker in `packages/opencode/src/cli/cmd/run.ts:801-803`
- Lines 801-803 wrap `for await (const event of events.stream) {` in `// kilocode_change start - revert to upstream: consume native events without normalizing sync copies`.
- While the wrapped line is identical to upstream `v1.18.15:701`, the surrounding context in Kilo includes custom retry logic and auto-reject handling (lines 796-800). The marker explicitly documents that event consumption was intentionally reverted to upstream behavior. Keeping or removing is non-breaking.

### 4. Auth Ordering Block in `packages/opencode/src/provider/provider.ts:1587-1589`
- Lines 1587-1589 wrap `const auths = yield* auth.all().pipe(Effect.orDie)` in `// kilocode_change start - load auths before env so OAuth plugins can override inherited credentials`.
- While upstream has the exact same statement at line 1536, in Kilo it is placed *before* `const envs = yield* env.all()` (lines 1590-1603) rather than after. The marker delineates an intentional statement reordering.
- **Verdict**: Legitimate structural difference; marker is valid.

### 5. Verified Clean Files (Identical to Upstream)
- Shared files that are identical (`diff: 0`) to upstream `v1.18.15` carry zero stale markers:
  - `.opencode/skills/rtl-aware-development/SKILL.md`
  - `packages/opencode/test/acp/usage.test.ts`
  - `packages/opencode/test/session/revert-compact.test.ts`
  - `packages/tui/src/clipboard.ts`
  - `packages/tui/src/ui/dialog-prompt.tsx`
  - `packages/ui/AGENTS.md`
  - `patches/@ai-sdk%2Fopenai-compatible@2.0.41.patch`

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
[INFO] Candidate files: 270
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 41 (missing or too-large)
[INFO] Classifying 229 file(s)...
[INFO] Classified 229/229

Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 3 | would reset (demo.ts, subagent-data.ts, truncate.ts - Finding #8) |
| cosmetic-only | 1 | would reset (anthropic.txt) |
| small-diff | 47 | would reset |
| large-diff | 148 | skipped |
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
| small-diff | 15 | would reset |
| large-diff | 51 | skipped |
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
[INFO] Candidate files: 181
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 88 (missing or too-large)
[INFO] Classifying 93 file(s)...
[INFO] Classified 93/93

Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 34 | would reset (34 i18n locale files - Non-Finding #2) |
| small-diff | 13 | would reset |
| large-diff | 32 | skipped |
| identical | 14 | nothing to do |
| upstream-missing | 88 | skipped |
| non-code-asset | 17 | skipped |
```

---

## Summary of Actionable Items

| # | File | Line | Marker Content | Issue | Recommended Action |
|---|---|---|---|---|---|
| 1 | `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | 112, 115 | `// kilocode_change start ... / end` | Upstream v1.18.15 restored absence assertions natively | Remove block markers |
| 2 | `packages/opencode/test/session/prompt.test.ts` | 845, 854 | `// kilocode_change start ... / end` | Upstream v1.18.15 adopted v2 reader compilation natively | Remove block markers |
| 3 | `packages/tui/src/component/prompt/index.tsx` | 627 | `"prompt.skills", // kilocode_change` | Upstream v1.18.15 adopted `"prompt.skills"` natively | Remove marker |
| 4 | `packages/tui/src/routes/session/index.tsx` | 6 | `onCleanup, // kilocode_change` | Native upstream import from `"solid-js"` | Remove marker |
| 5 | `packages/opencode/test/session/prompt.test.ts` | 43 | `import { SessionProjector } ... // kilocode_change` | Upstream imports `SessionProjector` natively | Remove marker |
| 6 | `packages/opencode/test/session/processor-effect.test.ts` | 1150 | `) // kilocode_change` | Stray marker on closing `)` of upstream test | Remove marker |
| 7 | `packages/opencode/src/session/message-v2.ts` | 632 | `return rows.map(part) // kilocode_change ...` | Callsite is identical to upstream line 502 | Convert to standard comment |
| 8 | `packages/opencode/src/tool/truncate.ts` | 54, 67 | `// kilocode_change start ... / end` | Upstream v1.18.15 adopted mtime cleanup natively (#40987) | Remove block markers |
| 9 | `packages/opencode/test/tool/truncation.test.ts` | 245, 260 | `// kilocode_change start ... / end` | Upstream v1.18.15 adopted mtime test natively | Remove block markers |

---

## Limitations

- Analysis evaluates PR [#13002](https://github.com/Kilo-Org/kilocode/pull/13002) at head commit `860f5d9e680fb2a1b7c77913ba706419e44124b3` against upstream release tag `v1.18.15` (`d7b115f623760e68a4749d16508a9eca350f246f`).
- Pre-existing markers in untouched files outside the PR diff were scanned via `find-reset-candidates.ts` for completeness, but actionable findings focus on files within the merge blast radius of PR #13002.
