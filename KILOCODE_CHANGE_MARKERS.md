# OpenCode v1.18.14..v1.18.15 Merge Review: Kilocode Change Markers Report

## Scope & Methodology

This report audits `kilocode_change` markers and custom Kilo modifications for Pull Request [#13002](https://github.com/Kilo-Org/kilocode/pull/13002), which merges OpenCode `v1.18.14` through `v1.18.15` into Kilo Code.

### Parameters
- **Base Branch / Ref**: `origin/johnnyeric/kilo-opencode-v1.18.13` (base commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0`)
- **Reviewed Branch / Ref**: `HEAD` / `origin/johnnyeric/kilo-opencode-v1.18.15` (commit `94fd41e3a2892ad667c890c2d995813aa706bdd0`)
- **Main Branch**: `origin/main`
- **Upstream Tag**: `v1.18.15` (and upstream commits `v1.18.14`..`v1.18.15`)
- **Total Changed Files Checked**: **90 files** in the PR diff (`origin/johnnyeric/kilo-opencode-v1.18.13...HEAD`)

### Review Methodology
1. **Per-File Marker Diff Analysis**: Checked diffs across all 90 modified files to detect any deleted (`-`), added (`+`), or shifted `kilocode_change` comments.
2. **Marker Balance & Syntax Audit**: Scanned all modified and shared upstream files for balanced `kilocode_change start` and `kilocode_change end` blocks.
3. **Merge Conflict Resolution Audit**: Examined all 11 conflict files recorded in merge commit `71bc00dd248cb8d86313355ac17c7dc7d1ade287` and fixup commit `94fd41e3a2892ad667c890c2d995813aa706bdd0` to ensure no custom Kilo logic lost annotations or was overwritten during resolution.
4. **Cross-Branch Delta Inspection**: Compared the reviewed branch against both `origin/main` and `origin/johnnyeric/kilo-opencode-v1.18.13` to identify branch divergences or missing forward-ported fixes.
5. **Package Boundary Check**: Verified that no `kilocode_change` markers leaked into Kilo-only packages (`packages/kilo-vscode`, `packages/kilo-ui`).

---

## Findings

### 1. Unbalanced Block Marker in `packages/opencode/src/session/message-v2.ts` (Low / Pre-existing)
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
- **Analysis**: Line 201 opens with `// kilocode_change - ...` (single-line syntax) instead of `// kilocode_change start - ...`, leaving the `// kilocode_change end` on line 216 without a matching `start` marker.
- **Provenance**: Pre-existing on `origin/main` and the base branch `origin/johnnyeric/kilo-opencode-v1.18.13`. PR #13002 did not introduce this discrepancy, but automated marker balance checkers flag it.
- **Recommended Action**: When convenient, update line 201 to `// kilocode_change start - apply stripping inside helpers so all read paths are covered`.

### 2. Upstream Base Divergence: Telemetry Attribution in `packages/opencode/src/session/session.ts` (Informational)
- **Location**: `packages/opencode/src/session/session.ts:873`
- **Observation**:
  On `origin/johnnyeric/kilo-opencode-v1.18.13` (via commit `6d331a726f` "fix(core): address round 3 review findings for upstream merge"), the session fork options include:
  ```ts
  platform: KiloSession.resolvePlatform(original.id), // kilocode_change - inherit platform telemetry attribution
  ```
  On `HEAD` (`origin/johnnyeric/kilo-opencode-v1.18.15`), which branched off commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0` before commit `6d331a726f` was applied, this line is absent.
- **Analysis**: This is not an accidental removal during the v1.18.15 merge. It is a consequence of commit `6d331a726f` landing on `origin/johnnyeric/kilo-opencode-v1.18.13` after PR #13002 was branched.
- **Recommended Action**: Rebase or merge the latest `origin/johnnyeric/kilo-opencode-v1.18.13` into `origin/johnnyeric/kilo-opencode-v1.18.15` prior to final merge to bring across `6d331a726f`.

---

## Notable Non-Findings

### 1. Zero Accidentally Stripped or Removed Markers
Across all 90 changed files between `origin/johnnyeric/kilo-opencode-v1.18.13...HEAD`, **0 existing `kilocode_change` markers were deleted or dropped**.

### 2. Properly Annotated New Additions (35 Total Markers Added)
- **Build Configuration**:
  - `packages/opencode/script/build-node.ts:30`: Added `KILO_VERSION: `'${Script.version}'`, // kilocode_change` to support the desktop sidecar version embedding introduced upstream.
- **New Upstream Locale Dictionaries (34 Files)**:
  - 34 new locale files merged from upstream under `packages/ui/src/i18n/` (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`).
  - In each file, the Kilo Go branding string for `dialog.usageExceeded.freeTier.description` is properly marked with `// kilocode_change`.

### 3. Merge Conflict Resolutions Correctly Preserved Custom Logic
All 11 conflict paths from merge commit `71bc00dd248cb8d86313355ac17c7dc7d1ade287` were audited:
- **`packages/opencode/src/plugin/xai.ts`**: Upstream removed local loopback OAuth in favor of device-only authentication (`cb88db6ce3`). Kilo intentionally retained both the loopback desktop OAuth and headless device flows; all markers and helper structures (`HTML_SUCCESS`, `HTML_ERROR`, PKCE generation) remain intact.
- **`packages/opencode/src/session/compaction.ts`**: Upstream introduced message serialization for compaction history (`b7f9363393`). Kilo preserved the `PruneReason` type and custom compaction hooks, while adapting `compaction-payload-recovery.ts` in commit `94fd41e3a2`.
- **`packages/opencode/src/session/retry.ts`**: Upstream refactored retryable matching into regex patterns (`f929f8f100`, `61aefc0759`). Kilo preserved the `FreeUsageLimitError` short-circuit guard within its `// kilocode_change start` / `// kilocode_change end` block.
- **`packages/opencode/src/session/revert.ts`**: Upstream migrated from ID inequality comparisons to index slicing (`a54a693af2`, `5aa5cb3523`). Kilo cleanly adapted its checkpoint turn filtering within the `// kilocode_change start` block.
- **`packages/opencode/src/session/prompt.ts`**: All 14 Kilo markers (resume commands, permission guards, SWE-Pruner integration, memory markers, slow-snapshot policies) remain intact.

### 4. Package Boundary Guard Compliance
- Executed `bun run check-kilocode-change` from `packages/kilo-vscode/`.
- Confirmed zero `kilocode_change` markers present in `packages/kilo-vscode` or `packages/kilo-ui`.

---

## Command Outputs

### Marker Diff Summary in PR 13002
```
Total changed files: 90
Files with deleted markers: 0
Files with added markers: 35
  - packages/opencode/script/build-node.ts (+1)
  - packages/ui/src/i18n/*.ts (34 files, +1 each)
```

### Marker Balance Scan across HEAD
```
Scanned: 874 files with markers
Unbalanced files found: 1 in shared opencode source (message-v2.ts:216, pre-existing on main)
```

### Boundary Guard Verification
```
$ bun run --cwd packages/kilo-vscode check-kilocode-change
$ ! grep -rIn 'kilocode_change' . ../kilo-ui/ --exclude='package.json' --exclude='*.md' --exclude-dir='node_modules' --exclude-dir='dist' | grep -v '`kilocode_change`'
# Status: 0 violations
```

---

## Limitations
- `script/check-opencode-annotations.ts` automatically skips execution when an upstream merge commit is present in git history (`isUpstreamMerge()`), necessitating direct programmatic diff and AST marker scanning.
- This report covers marker presence, syntax, and conflict preservation. Full behavioral validation is documented in accompanying test and pipeline reports.
