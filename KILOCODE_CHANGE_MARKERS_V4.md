# OpenCode v1.18.14..v1.18.15 Merge Review: Kilocode Change Markers Report (Round 4)

## Scope & Methodology

This report provides Round 4 of the specialized code review auditing `kilocode_change` markers, comment annotations, and upstream conflict preservations for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002), which merges OpenCode `v1.18.14` through `v1.18.15` into Kilo Code.

### Parameters
- **Base Branch / Ref**: `origin/main` (commit `b550030b2f523f7c4b34439bec2516d1bd280431`) / `origin/johnnyeric/kilo-opencode-v1.18.13` (commit `47d0d6d7e8224160c50a7a8c1a264b420256e17d`)
- **Reviewed PR Branch Head**: `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `860f5d9e680fb2a1b7c77913ba706419e44124b3`)
- **Upstream Tag**: `v1.18.15` (and upstream commits `v1.18.14`..`v1.18.15`)
- **Total Changed Files Checked**: **98 files** across `origin/main...860f5d9e68` (and **1,165 files** across the cumulative branch history `origin/johnnyeric/kilo-opencode-v1.18.13...860f5d9e68`)

### Review Methodology
1. **Delta & Commit 860f5d9e68 Inspection**: Specifically analyzed all changes introduced in commit `860f5d9e68` ("fix(upstream): preserve Kilo merge invariants") and subsequent commits since Round 3:
   - `packages/tui/src/ui/dialog-select.tsx`: comment reformatting around reference identity equality check.
   - `script/check-model-tool-network.ts`: updated regex pattern and comment annotation for MCP execution authority.
   - `script/check-opencode-annotations.ts`: regex update for compatibility branch recognition without author dependency.
   - `script/upstream/transforms/transform-package-json.ts` & test: preserved root `dev` script invariant in package.json transform.
   - `packages/sdk-next/package.json`: script ordering adjustment.
   - `packages/extensions/zed/extension.toml`: clean removal of unnecessary new file marker comment.
2. **Marker Balance & Block Syntax Scan**: Scanned every file across the entire repository for matching and balanced `// kilocode_change start` and `// kilocode_change end` markers.
3. **Unannotated Modifications in Shared Files Audit**: Re-audited all modified shared upstream files across the PR diff to identify custom Kilo logic lacking markers.
4. **Package Boundary Guard Verification**: Executed `check-kilocode-change` to confirm that no `kilocode_change` comments leaked into Kilo-only packages (`packages/kilo-vscode`, `packages/kilo-ui`) where markers are strictly prohibited.
5. **Annotation Checker & Unit Test Execution**: Executed `bun run script/check-opencode-annotations.ts --worktree`, `bun test tests/check-opencode-annotations.test.ts`, and `bun run check-model-tool-network.ts`.

---

## Findings

### 1. Unannotated Reactive Sync Logic in `packages/session-ui/src/components/basic-tool.tsx` (Medium / Open from Round 2 & 3)
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
- **Analysis**: `packages/session-ui` is shared upstream UI code (other files in `packages/session-ui` contain `kilocode_change` annotations). Although `packages/session-ui` is not in the default path filter of `script/check-opencode-annotations.ts`, this custom Kilo modification alters component expansion behavior and lacks `kilocode_change` markers.
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

### 1. Invariant Preservation Commit `860f5d9e68` Verified
All marker updates and file adjustments in commit `860f5d9e68` were audited and confirmed clean:
- **`packages/tui/src/ui/dialog-select.tsx:352–355`**:
  The reference identity comment was placed onto its own dedicated line within the `if` body:
  ```tsx
  if (flat()[0] === selected()) {
    // kilocode_change - reference identity; duplicate values are legal (see `active`)
    scroll.scrollTo(0)
  }
  ```
  This is clean, properly formatted, and avoids trailing inline clutter.
- **`script/check-model-tool-network.ts:126–129`**:
  The comment annotation correctly explains why `entry` is checked instead of `(?:item|entry)`:
  ```ts
  // kilocode_change - v1.18 preserves remote authority on the native MCP entry before adapting it to an AI SDK tool
  ...(!/SandboxPolicy\.executeMcp\(\s*ctx\.sessionID,\s*entry,/.test(session)
    ? ["  session/tools.ts must route MCP delegated authority through session-aware executeMcp"]
    : []),
  ```
  Verified via `bun run check-model-tool-network.ts` (0 violations).
- **`script/check-opencode-annotations.ts:121`**:
  Replaced brittle string matching with regex `^merge (?:remote-tracking )?branch '(?:[^/']+\/)*opencode-v\d`, allowing upstream merge detection regardless of branch namespace or author prefix. Verified with unit tests in `packages/script/tests/check-opencode-annotations.test.ts` (174 tests pass).
- **`script/upstream/transforms/transform-package-json.ts` & `transform-package-json.test.ts`**:
  Added `"dev"` to `PRESERVE_SCRIPTS` so that `package.json`'s `dev` script (`KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts`) is automatically preserved during automated merges. Verified with `bun test transforms/transform-package-json.test.ts` (22 tests pass).
- **`packages/sdk-next/package.json`**:
  Alphabetized scripts (`"test"`, `"test:ci"`, `"typecheck"`). No markers required or added.
- **`packages/extensions/zed/extension.toml`**:
  Removed unnecessary `# kilocode_change - new file` comment from line 1 of `extension.toml`.

### 2. Telemetry Attribution Synchronized in `packages/opencode/src/session/session.ts`
- Verified `packages/opencode/src/session/session.ts:873` includes `platform: KiloSession.resolvePlatform(original.id), // kilocode_change - inherit platform telemetry attribution`.
- **Status**: Resolved.

### 3. Balanced Annotation in `packages/tui/src/context/sync.tsx`
- Verified at lines 62–68:
  ```tsx
  // kilocode_change start
  function compareMessage(a: Message, b: Message) {
    return a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }

  const messageKey = (message: Message) => String(message.time.created).padStart(16, "0") + message.id
  // kilocode_change end
  ```
- **Status**: Resolved.

### 4. Proper Marker Annotations Across All Modified Shared Code
All custom Kilo modifications in shared files across the PR diff remain properly marked:
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

### 5. Package Boundary Guard Compliance
- Executed `bun run --cwd packages/kilo-vscode check-kilocode-change`.
- Confirmed **0 violations**: no `kilocode_change` markers leaked into Kilo-only packages (`packages/kilo-vscode` or `packages/kilo-ui`).

---

## Command Outputs

### Marker Diff Summary in PR 13002 (`origin/main...860f5d9e68`)
```
Total changed files: 98
Deleted marker occurrences: 0
Added marker occurrences: 44
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

### Annotation Check Unit Tests
```
$ bun test tests/check-opencode-annotations.test.ts (in packages/script)
 174 pass
 0 fail
 215 expect() calls
Ran 174 tests across 1 file. [2.31s]
```

### Upstream Transform Unit Tests
```
$ bun test transforms/transform-package-json.test.ts (in script/upstream)
 22 pass
 0 fail
 72 expect() calls
Ran 22 tests across 1 file. [28.00ms]
```

### Model Tool Network Boundary Guard
```
$ bun run script/check-model-tool-network.ts
check-model-tool-network: 3 classified client site(s), policy-aware tool and MCP boundaries verified.
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
