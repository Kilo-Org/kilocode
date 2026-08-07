# OpenCode v1.18.14..v1.18.15 Merge Review: Kilocode Change Markers Report (Round 2)

## Scope & Methodology

This report provides Round 2 of the specialized code review auditing `kilocode_change` markers, comment annotations, and upstream conflict preservations for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002), which merges OpenCode `v1.18.14` through `v1.18.15` into Kilo Code.

### Parameters
- **Base Branch / Ref**: `origin/johnnyeric/kilo-opencode-v1.18.13` (commit `4bb1c2a45b977e64c1b208c3f317de58c8e1dcbb`, merge-base `0a96c10cb651ecdf9338342b52d93afb1c1b0022`)
- **Reviewed Branch Head**: `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `db7c9eb7ebe652b897c3ca5e8e76b06d25175024`)
- **Main Branch**: `origin/main`
- **Reviewed Fixup Commits**: `421208c648`, `d808dd5743`, `1fb16a5c1f`, `9f6481f73b`, `d2b37efbe5`, `db7c9eb7eb`
- **Total Changed Files Checked**: **98 files** across the full PR diff (`origin/johnnyeric/kilo-opencode-v1.18.13...origin/johnnyeric/kilo-opencode-v1.18.15`)

### Review Methodology
1. **Per-File Marker Diff & Removal Audit**: Programmatically inspected unified diffs across all 98 changed files to detect any deleted (`-`), modified, or dropped `kilocode_change` annotations.
2. **Fixup Commit Audit**: Audited every newly added or modified line in recent review fixups (`421208c648` through `db7c9eb7eb`) across all touched packages (`packages/opencode`, `packages/tui`, `packages/session-ui`, `packages/kilo-ui`, `packages/kilo-vscode`, and `script/`).
3. **Marker Balance & Block Syntax Scan**: Scanned every file across the entire repository for matching and balanced `// kilocode_change start` and `// kilocode_change end` markers.
4. **Package Boundary Guard Verification**: Confirmed that no `kilocode_change` comments leaked into Kilo-only packages (`packages/kilo-vscode`, `packages/kilo-ui`) where markers are prohibited.
5. **Round 1 Finding Verification**: Re-audited all items highlighted during Round 1 to verify resolution and determine current state.

---

## Findings

### 1. Unannotated Reactive Sync Logic in `packages/session-ui/src/components/basic-tool.tsx` (Medium / Newly Introduced)
- **Location**: `packages/session-ui/src/components/basic-tool.tsx:119-136`
- **Observation**:
  In review fixup commit `421208c648` ("fix(review): address review feedback across ACP, TUI, proxy, and localization"), a reactive `defaultOpen` synchronization block was added to `packages/session-ui/src/components/basic-tool.tsx`:
  ```tsx
  let userToggled = false
  const setOpen = (value: boolean) => {
    userToggled = true
    if (props.open === undefined) setState("open", value)
    props.onOpenChange?.(value)
  }

  createEffect(
    on(
      () => props.defaultOpen,
      (val) => {
        if (!userToggled && val !== undefined && props.open === undefined) {
          setState("open", val)
        }
      },
      { defer: true },
    ),
  )
  ```
- **Analysis**: `packages/session-ui` is shared upstream UI code (other files in `packages/session-ui/src/v2/components/prompt-input/*` contain `kilocode_change` annotations). Although `packages/session-ui` is not currently in the default checker scope list in `script/check-opencode-annotations.ts`, this custom Kilo logic modifies shared upstream component behavior and lacks `kilocode_change` markers.
- **Recommended Action**: Wrap lines 119–136 in `// kilocode_change start` and `// kilocode_change end` blocks to facilitate future upstream synchronization.

---

### 2. Unbalanced Block Marker in `packages/opencode/src/session/message-v2.ts` (Low / Pre-existing)
- **Location**: `packages/opencode/src/session/message-v2.ts:201, 216`
- **Observation**:
  ```ts
  // Line 201:
  // kilocode_change - apply stripping inside helpers so all read paths are covered
  const info = (row: typeof MessageTable.$inferSelect) =>
    stripMessageMetadata({
      ...row.data,
      id: row.id,
      sessionID: row.session_id,
    } as Info)

  const part = (row: typeof PartTable.$inferSelect) =>
    stripPartMetadata({
      ...row.data,
      id: row.id,
      sessionID: row.session_id,
      messageID: row.message_id,
    } as Part)
  // Line 216:
  // kilocode_change end
  ```
- **Analysis**: Line 201 opens with single-line syntax `// kilocode_change - ...` instead of `// kilocode_change start - ...`, causing line 216 (`// kilocode_change end`) to appear unbalanced in automated balance scans.
- **Provenance**: Pre-existing on `origin/main` and base branch `origin/johnnyeric/kilo-opencode-v1.18.13`.
- **Recommended Action**: Update line 201 to `// kilocode_change start - apply stripping inside helpers so all read paths are covered`.

---

### 3. Upstream Base Divergence: Telemetry Attribution in `packages/opencode/src/session/session.ts` (Informational)
- **Location**: `packages/opencode/src/session/session.ts:873`
- **Observation**:
  On `origin/johnnyeric/kilo-opencode-v1.18.13`, session fork inherits platform telemetry attribution:
  ```ts
  platform: KiloSession.resolvePlatform(original.id), // kilocode_change - inherit platform telemetry attribution
  ```
  On `origin/johnnyeric/kilo-opencode-v1.18.15`, this line is not yet present because the PR was branched before commit `6d331a726f` landed on the stacked base branch.
- **Recommended Action**: Rebase or merge the latest `origin/johnnyeric/kilo-opencode-v1.18.13` into `origin/johnnyeric/kilo-opencode-v1.18.15` prior to final merge to incorporate all base branch updates cleanly.

---

## Notable Non-Findings & Resolved Items

### 1. Resolved Round 1 Finding: Balanced Annotation in `packages/tui/src/context/sync.tsx`
- In Round 1, `compareMessage` and `messageKey` in `packages/tui/src/context/sync.tsx` had an unannotated comparator function alongside a single-line marker.
- In fixup commit `9f6481f73b`, this was refactored into a clean, balanced block:
  ```tsx
  // kilocode_change start
  function compareMessage(a: Message, b: Message) {
    return a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }

  const messageKey = (message: Message) => String(message.time.created).padStart(16, "0") + message.id
  // kilocode_change end
  ```
- **Status**: Verified resolved.

### 2. Proper Marker Annotations in Newly Touched Fixup Files
All other fixup modifications across commits `421208c648` through `db7c9eb7eb` were checked and verified:
- **`packages/opencode/src/acp/event.ts:85, 167–182`**:
  - `await waiter.promise.catch(() => {}) // kilocode_change` (inline marker)
  - `waitUntilConnected(timeoutMs = 5000)` properly enclosed in `// kilocode_change start` / `end`.
- **`packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts:106–117`**:
  - Character-budget-bounded stream accumulation for 5xx upstream bodies enclosed in `// kilocode_change start` / `end`.
- **`packages/opencode/src/session/retry.ts:32, 83–86`**:
  - Word-boundary regex `/\b(?:429|500|502|503|504|524)\b/i, // kilocode_change` marked inline.
  - `isRetryable === false` guard enclosed within `// kilocode_change start` / `end`.
- **`packages/tui/src/component/prompt/index.tsx:278, 1611`**:
  - `if (tuiConfig.cursor && !vim.vimEnabled()) input.cursorStyle = tuiConfig.cursor // kilocode_change` marked inline at both locations.
- **`script/check-architecture.ts:2`**:
  - New architecture guard file annotated with `// kilocode_change - new file`.

### 3. Zero Accidentally Deleted or Dropped Markers
- Across all 98 files modified between `origin/johnnyeric/kilo-opencode-v1.18.13` and `origin/johnnyeric/kilo-opencode-v1.18.15`, **0 existing `kilocode_change` annotations were deleted or lost**.
- (One comment adjustment in `script/check-model-tool-network.ts` was a sync of the updated tool network checker from `origin/main`).

### 4. Package Boundary Guard Compliance
- Executed `bun run --cwd packages/kilo-vscode check-kilocode-change`.
- Verified that **zero `kilocode_change` comments exist in Kilo-only packages** (`packages/kilo-vscode` and `packages/kilo-ui`).
- Confirmed that new Persian localization files (`packages/kilo-ui/src/i18n/fa.ts` and `packages/kilo-vscode/webview-ui/src/context/language.tsx`) contain no prohibited markers.

### 5. All 34 New Upstream Locale Files Annotated
- All 34 new locale files merged under `packages/ui/src/i18n/` (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`) include properly annotated `dialog.usageExceeded.freeTier.description` Kilo Go branding strings with `// kilocode_change`.

---

## Command Outputs

### Marker Diff Summary in PR 13002 (Base...Head)
```
Total changed files: 98
Deleted marker occurrences: 1 (sync of script/check-model-tool-network.ts from main)
Added marker occurrences: 46
  - packages/opencode/script/build-node.ts (+1)
  - packages/opencode/src/acp/event.ts (+3)
  - packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts (+2)
  - packages/opencode/src/session/retry.ts (+1)
  - packages/tui/src/component/prompt/index.tsx (+2)
  - packages/tui/src/context/sync.tsx (+2)
  - packages/ui/src/i18n/*.ts (34 files, +1 each)
  - script/check-architecture.ts (+1)
```

### Annotation Check Validation
```
$ bun run script/check-opencode-annotations.ts --worktree
No shared upstream source files changed — nothing to check.

$ bun run script/check-opencode-annotations.ts --base origin/johnnyeric/kilo-opencode-v1.18.13
Skipping shared upstream annotation check — upstream merge detected.
```

### Boundary Guard Verification
```
$ bun run --cwd packages/kilo-vscode check-kilocode-change
$ ! grep -rIn 'kilocode_change' . ../kilo-ui/ --exclude='package.json' --exclude='*.md' --exclude-dir='node_modules' --exclude-dir='dist' | grep -v '`kilocode_change`'
# Status: 0 violations
```

---

## Limitations
- `script/check-opencode-annotations.ts` automatically skips verification when an upstream merge commit is present in the git log range (`isUpstreamMerge()`), requiring AST and unified diff analysis tools to inspect custom changes directly.
- This report focuses specifically on marker syntax, presence, balance, and package boundary compliance. Functional correctness, regression safety, and test suite execution are evaluated in accompanying review reports.
