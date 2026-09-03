# OpenCode v1.18.14..v1.18.15 Merge Review: Kilocode Change Markers Report (Round 3)

## Scope & Methodology

This report provides Round 3 of the specialized code review auditing `kilocode_change` markers, comment annotations, and upstream conflict preservations for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002), which merges OpenCode `v1.18.14` through `v1.18.15` into Kilo Code.

### Parameters
- **Base Branch / Ref**: `origin/johnnyeric/kilo-opencode-v1.18.13` (commit `aca225fcfd2ad5146f142a5d582f62c1dff12c35`)
- **Reviewed PR Branch Head**: `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `6d8876045d4cf06272cfb355f2b18c74cdf3e967`)
- **Main Branch**: `origin/main` (commit `95ad1705f5e357e7cd6f0cfbdaf17a8c55e01093`)
- **Upstream Tag**: `v1.18.15` (and upstream commits `v1.18.14`..`v1.18.15`)
- **Total Changed Files Checked**: **97 files** across the full PR diff (`origin/johnnyeric/kilo-opencode-v1.18.13...origin/johnnyeric/kilo-opencode-v1.18.15`)

### Review Methodology
1. **Per-File Marker Diff & Removal Audit**: Programmatically inspected unified diffs across all 97 changed files to detect any deleted (`-`), modified, or dropped `kilocode_change` annotations.
2. **Prior Round Finding Verification**: Re-audited all findings from Round 1 and Round 2:
   - `packages/session-ui/src/components/basic-tool.tsx`: verified whether `// kilocode_change start` / `end` markers were added to the reactive `defaultOpen` synchronization logic.
   - `packages/tui/src/context/sync.tsx`: verified `// kilocode_change start` / `end` markers on message sorting and keying helpers.
   - `packages/opencode/src/session/session.ts`: verified presence of platform telemetry attribution marker following base branch sync.
   - `packages/opencode/src/session/message-v2.ts`: re-evaluated pre-existing single-line vs block marker syntax.
3. **Marker Balance & Block Syntax Scan**: Scanned every file across the entire repository for matching and balanced `// kilocode_change start` and `// kilocode_change end` markers.
4. **Package Boundary Guard Verification**: Executed `check-kilocode-change` to confirm that no `kilocode_change` comments leaked into Kilo-only packages (`packages/kilo-vscode`, `packages/kilo-ui`) where markers are strictly prohibited.
5. **Annotation Checker Execution**: Executed `bun run script/check-opencode-annotations.ts --worktree` to verify worktree annotation compliance.

---

## Findings

### 1. Unannotated Reactive Sync Logic in `packages/session-ui/src/components/basic-tool.tsx` (Medium / Open from Round 2)
- **Location**: `packages/session-ui/src/components/basic-tool.tsx:119-136`
- **Observation**:
  The reactive `defaultOpen` synchronization logic added to `packages/session-ui/src/components/basic-tool.tsx` remains unannotated:
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
- **Analysis**: `packages/session-ui` is shared upstream UI code (other files such as `packages/session-ui/src/v2/components/prompt-input/*` contain `kilocode_change` annotations). Although `packages/session-ui` is not in the default path filter of `script/check-opencode-annotations.ts`, this custom Kilo modification alters component expansion behavior and lacks `kilocode_change` markers.
- **Recommended Action**: Enclose lines 119–136 within `// kilocode_change start` and `// kilocode_change end` comments to safeguard the modification during future upstream merges.

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
- **Analysis**: Line 201 opens with single-line syntax `// kilocode_change - ...` instead of `// kilocode_change start - ...`, causing line 216 (`// kilocode_change end`) to appear unbalanced in automated AST scans.
- **Provenance**: Pre-existing on `origin/main` and the base branch `origin/johnnyeric/kilo-opencode-v1.18.13`.
- **Recommended Action**: When modifying `message-v2.ts`, update line 201 to `// kilocode_change start - apply stripping inside helpers so all read paths are covered`.

---

## Notable Non-Findings & Resolved Items

### 1. Resolved Round 2 Finding: Telemetry Attribution Synchronized in `packages/opencode/src/session/session.ts`
- In Round 2, `platform: KiloSession.resolvePlatform(original.id)` was missing on `1.18.15` because the PR had branched before commit `6d331a726f` landed on `origin/johnnyeric/kilo-opencode-v1.18.13`.
- With merge commit `6d8876045d`, `origin/johnnyeric/kilo-opencode-v1.18.13` (commit `aca225fcfd`) was merged into the PR branch head.
- **Verification**: `packages/opencode/src/session/session.ts:873` now includes `platform: KiloSession.resolvePlatform(original.id), // kilocode_change - inherit platform telemetry attribution`.
- **Status**: Resolved.

### 2. Resolved Round 1 Finding: Balanced Annotation in `packages/tui/src/context/sync.tsx`
- In Round 1, message sorting and keying helpers in `packages/tui/src/context/sync.tsx` lacked a balanced block marker.
- Verified on HEAD at lines 62–68:
  ```tsx
  // kilocode_change start
  function compareMessage(a: Message, b: Message) {
    return a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }

  const messageKey = (message: Message) => String(message.time.created).padStart(16, "0") + message.id
  // kilocode_change end
  ```
- **Status**: Resolved.

### 3. Proper Marker Annotations Across All Modified Shared Code
All custom Kilo modifications in shared files across the 97-file diff are properly marked:
- **`packages/opencode/script/build-node.ts:30`**: `KILO_VERSION: `'${Script.version}'`, // kilocode_change`
- **`packages/opencode/src/acp/event.ts`**:
  - Line 44: `private readonly idleCounters = new Map<string, number>() // kilocode_change`
  - Lines 77–108: `// kilocode_change start - correlate idle waiter with per-session generation count` ... `// kilocode_change end`
  - Lines 185–200: `// kilocode_change start` / `private async waitUntilConnected(timeoutMs = 5000)` / `// kilocode_change end`
  - Line 215: `this.idleCounters.set(sessionId, (this.idleCounters.get(sessionId) ?? 0) + 1) // kilocode_change`
- **`packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts:106–117`**:
  - Stream decoding and payload budgeting enclosed in `// kilocode_change start` / `end`.
- **`packages/opencode/src/session/retry.ts:32, 83–86, 98–101`**:
  - `/\b(?:429|500|502|503|504|524)\b/i, // kilocode_change`
  - Kilo error non-retry guard and FreeUsageLimitError handling enclosed in `// kilocode_change start` / `end`.
- **`packages/opencode/src/session/revert.ts:73–86`**:
  - Checkpoint slice filtering enclosed in `// kilocode_change start` / `end`.
- **`packages/tui/src/component/prompt/index.tsx:278, 1611`**:
  - Cursor style assignments annotated inline with `// kilocode_change`.
- **`packages/ui/src/i18n/*.ts` (34 files)**:
  - All 34 new locale dictionaries (`am.ts` through `uz.ts`) include `// kilocode_change` on the Kilo Go branding string for `dialog.usageExceeded.freeTier.description`.

### 4. Zero Accidentally Deleted or Dropped Markers
- Across all 97 files modified between base `origin/johnnyeric/kilo-opencode-v1.18.13` and head `origin/johnnyeric/kilo-opencode-v1.18.15`, **0 existing `kilocode_change` markers were lost or dropped**.
- (One comment update in `script/check-model-tool-network.ts` reflected regex generalization synced from `origin/main`).

### 5. Package Boundary Guard Compliance
- Executed `bun run --cwd packages/kilo-vscode check-kilocode-change`.
- Confirmed **0 violations**: no `kilocode_change` markers leaked into Kilo-only packages (`packages/kilo-vscode` or `packages/kilo-ui`).
- Confirmed Persian localization files (`packages/kilo-ui/src/i18n/fa.ts` and `packages/kilo-vscode/webview-ui/src/context/language.tsx`) contain no prohibited markers.

---

## Command Outputs

### Marker Diff Summary in PR 13002 (Base...Head)
```
Total changed files: 97
Deleted marker occurrences: 1 (comment cleanup in test script script/check-model-tool-network.ts)
Added marker occurrences: 46
  - packages/opencode/script/build-node.ts (+1)
  - packages/opencode/src/acp/event.ts (+5)
  - packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts (+2)
  - packages/opencode/src/session/retry.ts (+1)
  - packages/tui/src/component/prompt/index.tsx (+2)
  - packages/tui/src/context/sync.tsx (+2)
  - packages/ui/src/i18n/*.ts (34 files, +1 each)
```

### Worktree Annotation Guard
```
$ bun run script/check-opencode-annotations.ts --worktree
No shared upstream source files changed — nothing to check.
```

### Boundary Guard Verification
```
$ bun run --cwd packages/kilo-vscode check-kilocode-change
$ ! grep -rIn 'kilocode_change' . ../kilo-ui/ --exclude='package.json' --exclude='*.md' --exclude-dir='node_modules' --exclude-dir='dist' | grep -v '`kilocode_change`'
# Status: 0 violations
```

---

## Limitations

- `script/check-opencode-annotations.ts` skips automatic evaluation when an upstream merge commit is present in the git log range (`isUpstreamMerge()`), requiring AST and diff-based tooling to audit custom annotations directly.
- This report audits marker presence, syntax, balance, and package boundary compliance. Functional verification and runtime stability are covered in separate test and pipeline review reports.
