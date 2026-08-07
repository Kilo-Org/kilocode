# OpenCode v1.18.14..v1.18.15 Merge Review: Unnecessary Markers & Reset Candidates Report

## Scope & Methodology

This report audits `kilocode_change` annotations and upstream drift for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002), which merges OpenCode `v1.18.14` through `v1.18.15` into Kilo Code.

### Parameters
- **Base Branch / Ref**: `origin/johnnyeric/kilo-opencode-v1.18.13` (base commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0`)
- **Reviewed Branch / Ref**: `HEAD` / `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `94fd41e3a2892ad667c890c2d995813aa706bdd0`)
- **Main Branch**: `origin/main`
- **Upstream Target**: `v1.18.15` (commit `d7b115f623760e68a4749d16508a9eca350f246f`)
- **Total Shared Files Changed**: 106 files across `packages/opencode`, `packages/session-ui`, `packages/tui`, `packages/ui`, `packages/plugin`, `packages/sdk`, and root

### Review Methodology
1. **Automated Reset Candidate Analysis**: Executed `bun run script/upstream/find-reset-candidates.ts --dry-run` scoped across each package (`packages/opencode`, `packages/session-ui`, `packages/tui`, `packages/ui`, `packages/util`, `packages/plugin`, `packages/sdk`) to classify files into drift buckets (`identical`, `markers-only`, `cosmetic-only`, `small-diff`, `large-diff`).
2. **Per-Marker Upstream Alignment Verification**: Executed automated line-by-line and AST-aware scans comparing every `kilocode_change` marker (inline and block) in PR-changed files against upstream `v1.18.15` at both the raw byte level and the transformed branding level (`script/upstream/utils/upstream.ts:translate`).
3. **Reset Dry-Run Verification**: Evaluated candidate files with `bun run script/upstream/reset-to-upstream.ts <file> --dry-run` and direct diffs against `v1.18.15`.
4. **Annotation Policy & CI Compliance**: Checked marker semantics against `script/check-opencode-annotations.ts` and `AGENTS.md` rules to verify that stripping any candidate marker does not introduce unannotated divergence in CI.
5. **Exempt Path Audit**: Checked for markers residing in Kilo-owned directories (`packages/opencode/src/kilocode/`, `packages/opencode/test/kilocode/`, `packages/kilo-*`).

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
- **Upstream Comparison (`v1.18.15`)**:
  ```ts
  // Server loads instances per-request via x-opencode-directory header — no
  // ambient project InstanceContext needed at startup.
  instance: false,
  ```
- **Analysis**: Upstream OpenCode natively added `instance: false` to `WebCommand`. The line is now identical to upstream and the `// kilocode_change` marker is obsolete.
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
- **Upstream Comparison (`v1.18.15`)**:
  ```ts
  "prompt.stash.pop",
  "prompt.stash.list",
  "prompt.skills",
  "session.interrupt",
  ```
- **Analysis**: Upstream v1.18.15 natively includes `"prompt.skills"` in the prompt action list. The `// kilocode_change` marker on `"prompt.skills"` is obsolete. Line 627 (`"prompt.vim.toggle"`) remains a legitimate Kilo-specific change and must keep its marker.
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
- **Upstream Comparison (`v1.18.15`)**:
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
- **Analysis**: Upstream imports `onCleanup` from `"solid-js"` natively at line 10. The `// kilocode_change` marker on line 6 is obsolete.
- **Recommended Action**: Remove `// kilocode_change` from line 6.

---

### 4. Stale Inline Marker on Duplicate Upstream Import in `packages/opencode/test/session/prompt.test.ts`
- **Location**: `packages/opencode/test/session/prompt.test.ts:43`
- **Current Code**:
  ```ts
  import { SessionProcessor } from "../../src/session/processor"
  import { SessionProjector } from "@opencode-ai/core/session/projector" // kilocode_change
  import { SessionPrompt } from "../../src/session/prompt"
  ```
- **Upstream Comparison (`v1.18.15`)**:
  Upstream imports `SessionProjector` at line 5 of `prompt.test.ts`:
  ```ts
  import { SessionProjector } from "@opencode-ai/core/session/projector"
  ```
- **Analysis**: Upstream already imports `SessionProjector` at the top of the file. Kilo added a second import with a marker on line 43.
- **Recommended Action**: Remove the duplicate import on line 43 (or remove the stale `// kilocode_change` marker).

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
- **Upstream Comparison (`v1.18.15`)**:
  The test ending at line 1150 is the upstream test `"session.processor effect tests retain partial legacy parts without v2 events"`.
- **Analysis**: The closing parenthesis on line 1150 belongs to an upstream test and is identical to upstream. The following Kilo test on line 1152 already has its own `// kilocode_change start` block marker.
- **Recommended Action**: Remove `// kilocode_change` from the closing `)` on line 1150.

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
- **Upstream Comparison (`v1.18.15`)**:
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
- **Analysis**: The line `return rows.map(part)` is verbatim identical to upstream line 503. The actual Kilo change is the definition of `part(...)` earlier in the file (lines 206-215). Marking line 632 serves only as explanatory commentary.
- **Recommended Action**: Convert `// kilocode_change - ...` on line 632 to a standard comment `// note: part() applies stripPartMetadata ...` or remove the marker prefix.

---

### 7. Harmless Markers in Exempt Paths (Convention Review)
- **Location 1**: `packages/opencode/src/kilocode/tool/agent-manager.ts:1` (`// kilocode_change - new file`)
- **Location 2**: `packages/opencode/test/kilocode/help.test.ts:10` (`import { ProvidersCommand } ... // kilocode_change — upstream renamed auth → providers`)
- **Analysis**: Per `AGENTS.md` and `script/check-opencode-annotations.ts`, any directory containing `kilocode` in the path name is strictly Kilo-owned and exempt from annotations. Markers in these files are harmless but unnecessary.
- **Recommended Action**: Optional cleanup; no merge impact.

---

## Notable Non-Findings

### 1. 34 Upstream Locale Dictionaries (`packages/ui/src/i18n/*.ts`) Are Not Unnecessary Markers
- `find-reset-candidates.ts` classified 34 new locale files under `packages/ui/src/i18n/` (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`) as `markers-only`.
- **Reason for Tool Flag**: The tool compares local files against transformed upstream, where `translate()` automatically replaces `OpenCode Go` with `Kilo Go`.
- **Repository Reality**: In the actual codebase, upstream has `"OpenCode Go"` and Kilo has `"Kilo Go"`. The `// kilocode_change` marker on the `dialog.usageExceeded.freeTier.description` line is **mandatory** to satisfy `script/check-opencode-annotations.ts`.
- **Verdict**: These 34 markers are **REQUIRED** and must NOT be removed or reset.

### 2. No Changed Shared Files Qualify for Bulk Reset
- Audited all 106 shared files modified in the PR:
  - 18 files are already byte-for-byte identical to transformed upstream (e.g. `packages/opencode/src/acp/event.ts`, `packages/opencode/src/acp/usage.ts`, `packages/opencode/src/tool/truncate.ts`, `packages/session-ui/src/components/part-default-open.ts`, `packages/tui/src/clipboard.ts`). None of these files carry stale markers.
  - 34 files are the `packages/ui/src/i18n/*.ts` files discussed above.
  - All remaining modified shared files contain active, verified Kilo feature logic, bug fixes, or architecture adapters.

### 3. No Marker Regressions in Heavy Conflict Files
- Deep-checked conflict files from merge commit `71bc00dd24`:
  - `packages/opencode/src/session/compaction.ts` (43 markers): all 43 markers delineate active Kilo compaction recovery and pruning hooks.
  - `packages/opencode/src/session/session.ts` (79 markers): all markers delineate active telemetry, diff porting, and session database extensions.
  - `packages/opencode/src/session/retry.ts` (14 markers): all markers delineate Kilo error suppression and network retry rules.
  - `packages/opencode/src/session/revert.ts` (12 markers): all markers delineate atomic workspace checkpoint rollbacks.

---

## Command Outputs

### 1. Drift Classification for PR Shared Files
```text
$ bun run script/upstream/find-reset-candidates.ts packages/opencode/src --dry-run
Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 2 | would reset (demo.ts, subagent-data.ts - pre-existing) |
| cosmetic-only | 1 | would reset (anthropic.txt - pre-existing) |
| small-diff | 42 | would reset |
| large-diff | 144 | skipped |
| identical | 31 | nothing to do |
| upstream-missing | 41 | skipped |

$ bun run script/upstream/find-reset-candidates.ts packages/ui --dry-run
Summary:
| Bucket | Count | Action |
|---|---|---|
| markers-only | 42 | would reset (34 new i18n files + 8 pre-existing) |
| small-diff | 13 | would reset |
| large-diff | 31 | skipped |
| identical | 6 | nothing to do |
| upstream-missing | 88 | skipped |
| non-code-asset | 17 | skipped |
```

### 2. Reset-To-Upstream Dry Run on Candidate Files
```text
$ bun run script/upstream/reset-to-upstream.ts packages/opencode/src/cli/cmd/web.ts --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/cmd/web.ts to transformed upstream v1.18.15

$ bun run script/upstream/reset-to-upstream.ts packages/tui/src/component/prompt/index.tsx --dry-run
[OK] Last merged upstream: v1.18.15 (d7b115f6)
[INFO] [DRY-RUN] Would reset packages/tui/src/component/prompt/index.tsx to transformed upstream v1.18.15
```

---

## Summary of Actionable Items

| # | File | Line | Marker Content | Issue | Recommended Action |
|---|---|---|---|---|---|
| 1 | `packages/opencode/src/cli/cmd/web.ts` | 14 | `instance: false, // kilocode_change` | Upstream v1.18.15 adopted `instance: false` | Remove marker |
| 2 | `packages/tui/src/component/prompt/index.tsx` | 628 | `"prompt.skills", // kilocode_change` | Upstream v1.18.15 adopted `"prompt.skills"` | Remove marker |
| 3 | `packages/tui/src/routes/session/index.tsx` | 6 | `onCleanup, // kilocode_change` | Native upstream import from `"solid-js"` | Remove marker |
| 4 | `packages/opencode/test/session/prompt.test.ts` | 43 | `import { SessionProjector } ... // kilocode_change` | Upstream already imports `SessionProjector` on line 5 | Remove duplicate import / marker |
| 5 | `packages/opencode/test/session/processor-effect.test.ts` | 1150 | `) // kilocode_change` | Stray marker on closing `)` of upstream test | Remove marker |
| 6 | `packages/opencode/src/session/message-v2.ts` | 632 | `return rows.map(part) // kilocode_change ...` | Callsite is identical to upstream line 503 | Convert to standard comment |
| 7 | `packages/opencode/src/kilocode/tool/agent-manager.ts` | 1 | `// kilocode_change - new file` | Inside exempt `kilocode` directory | Optional cleanup |
| 8 | `packages/opencode/test/kilocode/help.test.ts` | 10 | `import ... // kilocode_change ...` | Inside exempt `kilocode` directory | Optional cleanup |

---

## Limitations

- Analysis is bounded to PR #13002 commit range `b6505b164bee1acf20d5c33dbc052e8a60c464c0..HEAD` evaluated against upstream tag `v1.18.15` (`d7b115f623760e68a4749d16508a9eca350f246f`).
- Pre-existing markers in unchanged files outside the PR diff were scanned via `find-reset-candidates.ts` for context, but actionable findings focus specifically on files modified or affected by PR #13002.
