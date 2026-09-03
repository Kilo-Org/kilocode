# Configuration Regression & Fallback Audit Report (Round 3): PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Target / Range:** OpenCode `v1.18.14..v1.18.15` (upstream commit `d7b115f623`)  
**Base Commit:** `aca225fcfd2ad5146f142a5d582f62c1dff12c35` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed PR Branch Head (HEAD):** `6d8876045d4cf06272cfb355f2b18c74cdf3e967` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Main Branch:** `95ad1705f5e357e7cd6f0cfbdaf17a8c55e01093` (`origin/main`)  
**Audit Date:** 2026-08-10  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Safe with 1 Actionable Finding (Medium)**.
- **Summary:** Round 3 of the configuration regression audit evaluated PR #13002 at branch head `6d8876045d4cf06272cfb355f2b18c74cdf3e967` against base `aca225fcfd2ad5146f142a5d582f62c1dff12c35`. The PR cleanly adheres to Kilo's `.kilo`-first and `.kilo`-only configuration model. No regressions, unintended `.opencode` directory fallbacks, or broken configuration discovery mechanisms are present in the audited changeset.
- **Re-evaluated Round 1 & Round 2 Findings:**
  1. *Finding 1 (Medium - Open):* Upstream commit `66fdd51f0d` introduced `.opencode/skills/rtl-aware-development/SKILL.md`. Because Kilo's skill discovery mechanism intentionally scans only `.kilo/skills/`, legacy `.kilocode/skills/`, and external `.agents/skills/` or `.claude/skills/` directories, this skill remains undiscovered at runtime. It must be relocated to `.kilo/skills/rtl-aware-development/SKILL.md` to be accessible by Kilo runtime agents.
  2. *Finding 2 (Closed / Verified Clean):* Deprecation of `command-files.ts` observed during intermediate commits was reconciled in `c24adedfa1` and `6d8876045d`. `packages/opencode/src/kilocode/command-files.ts` is fully retained and identical to base.
  3. *Finding 3 (Closed / Verified Clean):* `kilo web` CLI command restoration was removed again in commit `c24adedfa1` / `6d8876045d`, aligning with Kilo's fork policy of excluding upstream web command binaries.
- **Round 3 Validations:** Upstream TUI cursor style configuration (`feat(tui): add cursor style configuration (#32295)`) is cleanly integrated with Vim modal editing safeguards. Core configuration loading, JSONC parsing, layered unsets (`propagateUnset`), permission migration, and overlay routes pass 100% of automated test suites.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated all configuration discovery, loading, migration, overlay, and path resolution logic across the 97 changed files between base commit `aca225fcfd2ad5146f142a5d582f62c1dff12c35` and PR head `6d8876045d4cf06272cfb355f2b18c74cdf3e967`, focusing on:

1. **Configuration Directory & File Discovery:**
   - `packages/opencode/src/config/paths.ts` (`ConfigPaths.directories`, `ConfigPaths.files`)
   - `packages/opencode/src/config/config.ts` (`Config.Service`, `loadInstanceState`, `loadGlobal`, `globalConfigFile`)
   - `packages/opencode/src/kilocode/config/config.ts` (`KilocodeConfig.projectConfigFiles`, `ALL_CONFIG_FILES`, `KILO_DIR_SUFFIXES`, `updateProjectConfig`, `propagateUnset`, `detectOpencodeConfig`)
2. **TUI & Cursor Configuration Integration:**
   - `packages/tui/src/config/index.tsx` (`Cursor` schema, `Info`, `Resolved`, `resolve()`)
   - `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx` (`KiloTuiConfig.resolve`)
   - `packages/tui/src/component/prompt/index.tsx` (cursor styling interaction with Vim modal editing)
   - `packages/tui/test/config.test.tsx` and `packages/opencode/test/kilocode/cli/cmd/tui/context/tui-config.test.ts`
3. **Skill, Agent & Command Discovery:**
   - `packages/opencode/src/skill/index.ts` (`KILO_SKILL_PATTERN`, `EXTERNAL_SKILL_PATTERN`, `discoverSkills`, `scan`)
   - Upstream skill addition `.opencode/skills/rtl-aware-development/SKILL.md`
   - `packages/opencode/src/config/command.ts` and `packages/opencode/src/config/agent.ts`
4. **Configuration Overlay & Permissions:**
   - `packages/opencode/test/kilocode/server/config-overlay.test.ts`
   - `packages/opencode/test/kilocode/permission/config-paths.test.ts`
5. **Architecture & Boundary Ratchets:**
   - `script/check-architecture.ts` (boundary enforcement)
   - `script/check-opencode-annotations.ts` (upstream annotation checks)
   - `packages/kilo-vscode/` marker check (`bun run check-kilocode-change`)

### 2.2 Methodology
- **Static AST & Call Graph Audits:** Audited all call sites referencing `.opencode`, `opencode.json`, `.kilo`, `.kilocode`, `ConfigPaths.directories`, `projectConfigFiles`, and `skills` to ensure strict path confinement and proper precedence order.
- **Precedence Order & Sentinel Verification:** Verified that project writes always target `.kilo/kilo.jsonc`, that `.kilo` precedes `.kilocode`, and that unsets propagate across layered files via `propagateUnset`.
- **Runtime & Unit Test Execution:** Ran targeted test suites in `packages/opencode` and `packages/tui` covering configuration loading, invalid JSON resilience, path traversal confinement, bash permission migration, TUI reactive store updates, config overlay routes, and architecture boundary enforcement.

---

## 3. Findings

### Finding 1: Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md` is Omitted from Kilo Skill Discovery (Open)
- **Severity:** Medium (Functional / Skill Discovery Gap)
- **Status:** Open (re-evaluated in Round 3; file remains located at `.opencode/skills/rtl-aware-development/SKILL.md`)
- **Provenance:** Introduced in upstream commit `66fdd51f0d` (`docs: add RTL development skill (#40543)`).
- **File Location:** `.opencode/skills/rtl-aware-development/SKILL.md`
- **Analysis:**
  1. Upstream OpenCode places repository skills in `.opencode/skills/`.
  2. Kilo's skill discovery (`packages/opencode/src/skill/index.ts:245-261`) iterates over directories returned by `config.directories()`, which resolves `Global.Path.config`, `.kilo`, `.kilocode`, and `KILO_CONFIG_DIR` (`packages/opencode/src/config/paths.ts:23-41`).
  3. External directories scanned by Kilo are strictly `.agents/skills/` and `.claude/skills/`.
  4. Because Kilo intentionally omits `.opencode` from directory discovery targets, `.opencode/skills/rtl-aware-development/SKILL.md` is **never discovered or loaded** by Kilo CLI, VS Code extension, or JetBrains plugin.
  5. In addition, repository guidelines in `AGENTS.md` explicitly mandate:
     > *"Project config: .kilo/command/*.md, .kilo/agent/*.md, kilo.json, AGENTS.md. Put new commands and agents in .kilo/. Do not use .kilocode/ or .opencode/."*
- **Impact:** Kilo runtime agents operating in this repository cannot discover or use the RTL development skill added in OpenCode v1.18.15.
- **Recommended Action:**
  - Move `.opencode/skills/rtl-aware-development/SKILL.md` to `.kilo/skills/rtl-aware-development/SKILL.md`.
  - Adjust any OpenCode-specific terminology in the skill description to neutral or Kilo-specific phrasing if appropriate.

---

### Finding 2: Retention of `packages/opencode/src/kilocode/command-files.ts` (Closed / Verified Clean)
- **Severity:** Low / Informational
- **Status:** Closed / Verified Clean
- **Provenance:** Reconciled in commit `c24adedfa1` and `6d8876045d`.
- **Files Affected:** `packages/opencode/src/kilocode/command-files.ts`, `packages/opencode/test/kilocode/command-files.test.ts`.
- **Analysis:** In earlier intermediate merge commits, standalone command files helpers were removed. In the final PR branch head `6d8876045d`, `command-files.ts` and its test suite are fully retained and match the base branch with zero diff. Standard command loading via `ConfigCommand.load()` continues to function identically across `.kilo/command` and `.kilocode/command`.
- **Recommended Action:** None.

---

### Finding 3: Exclusion of `kilo web` CLI Command (Closed / Verified Clean)
- **Severity:** Low / Informational
- **Status:** Closed / Verified Clean
- **Provenance:** Reconciled in commit `c24adedfa1` and `6d8876045d` via `script/upstream/transforms/remove-kilo-web.ts`.
- **Files Affected:** `packages/opencode/src/cli/cmd/web.ts` (deleted), `script/upstream/transforms/remove-kilo-web.ts`.
- **Analysis:** In earlier merge rounds, `kilo web` was temporarily restored. Commit `c24adedfa1` restored the `remove-kilo-web.ts` transform and removed `packages/opencode/src/cli/cmd/web.ts`, adhering to Kilo's fork policy of excluding upstream web command binaries. No ambient config discovery or fallback logic is introduced.
- **Recommended Action:** None.

---

## 4. Notable Non-Findings (Verified Clean Areas)

### 4.1 Strict Exclusion of `.opencode` from Config Directory Discovery
- **Audited File:** `packages/opencode/src/config/paths.ts`
- **Verification:** `ConfigPaths.directories` strictly constrains directory traversal targets:
  ```ts
  targets: [".kilocode", ".kilo"], // kilocode_change: strictly .kilocode and .kilo
  ```
- **Result:** `.opencode` is completely omitted from directory discovery. Only `.kilo` and legacy `.kilocode` are returned.

### 4.2 Project Config Precedence and Write Target Confinement
- **Audited Files:** `packages/opencode/src/kilocode/config/config.ts`, `packages/opencode/src/config/config.ts`
- **Verification:**
  - `KilocodeConfig.ALL_CONFIG_FILES`: `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"]` (read precedence order).
  - `KilocodeConfig.KILO_DIR_SUFFIXES`: `[".kilo", ".kilocode"]` (directory precedence).
  - `updateProjectConfig`: Writes always target the first existing configuration file, defaulting to `.kilo/kilo.jsonc`.
  - `propagateUnset`: Propagates null delete sentinels across all layered config files so lower-precedence files cannot resurrect deleted keys.
- **Result:** Configuration mutations remain strictly confined to `.kilo/` paths and cleanly sanitize lower layers.

### 4.3 TUI Cursor Configuration Integration & Vim Modal Safeguards
- **Audited Files:** `packages/tui/src/config/index.tsx`, `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx`, `packages/tui/src/component/prompt/index.tsx`
- **Verification:**
  - Upstream `Cursor` schema (`style: "block" | "underline" | "line" | "default"`, `blinking: boolean`) is correctly integrated into `TuiConfig.Info` and `TuiConfig.Resolved`.
  - `KiloTuiConfig.resolve()` adapts cursor settings with proper defaults (`block`, `blinking: true`).
  - In `packages/tui/src/component/prompt/index.tsx`, cursor styling respects active Vim mode (`if (tuiConfig.cursor && !vim.vimEnabled()) input.cursorStyle = tuiConfig.cursor`), preventing cursor style conflicts during modal editing.
  - Unit tests in `packages/tui/test/config.test.tsx` (9/9 passed) and `packages/opencode/test/kilocode/cli/cmd/tui/context/tui-config.test.ts` (3/3 passed) verify schema validation and hot reload reactivity.

### 4.4 Leftover Opencode Migration Warning
- **Audited File:** `packages/opencode/src/kilocode/config/config.ts` (`detectOpencodeConfig`, `opencodeConfigNotification`)
- **Verification:** When an existing `.opencode` folder is present on disk, Kilo does not fall back to it; instead, `opencodeConfigNotification` generates a synthetic notification directing the user to migrate their settings into `.kilo/` or `~/.config/kilo/`.

### 4.5 Architecture Boundary & Annotation Check Cleanliness
- **Audited Files:** `script/check-architecture.ts`, `script/check-opencode-annotations.ts`
- **Verification:** `bun run script/check-architecture.ts` reported 0 boundary violations across core directionality, InstanceState singletons, SQLite constructors, tool environment reads, and HttpApi handlers. `check-opencode-annotations.ts` and `check-kilocode-change` reported clean trees.

---

## 5. Command Outputs & Empirical Verification

### 5.1 Verification of Config Directory Targets
```sh
$ git grep 'targets:' packages/opencode/src/config/paths.ts
packages/opencode/src/config/paths.ts:17:    targets: [`${name}.jsonc`, `${name}.json`],
packages/opencode/src/config/paths.ts:29:          targets: [".kilocode", ".kilo"], // kilocode_change
packages/opencode/src/config/paths.ts:35:      targets: [".kilocode", ".kilo"], // kilocode_change
```

### 5.2 TUI Config Unit Tests
```sh
$ cd packages/tui && bun test ./test/config.test.tsx
bun test v1.3.14 (0d9b296a)

 9 pass
 0 fail
 28 expect() calls
Ran 9 tests across 1 file. [601.00ms]
```

### 5.3 Core Config, TUI Config Store, and Permission Path Tests
```sh
$ cd packages/opencode && bun test \
    ./test/kilocode/config/config.test.ts \
    ./test/kilocode/cli/cmd/tui/context/tui-config.test.ts \
    ./test/kilocode/permission/config-paths.test.ts
bun test v1.3.14 (0d9b296a)

 67 pass
 0 fail
 153 expect() calls
Ran 67 tests across 3 files. [16.31s]
```

### 5.4 Project Config Update Tests
```sh
$ cd packages/opencode && bun test ./test/kilocode/project-config-update.test.ts
bun test v1.3.14 (0d9b296a)

 4 pass
 0 fail
 8 expect() calls
Ran 4 tests across 1 file. [2.69s]
```

### 5.5 Config Overlay Tests
```sh
$ cd packages/opencode && bun test ./test/kilocode/server/config-overlay.test.ts
bun test v1.3.14 (0d9b296a)

 34 pass
 0 fail
 84 expect() calls
Ran 34 tests across 1 file. [111.51s]
```

### 5.6 Full Core Configuration Tests
```sh
$ cd packages/opencode && bun test ./test/config/config.test.ts
bun test v1.3.14 (0d9b296a)

 107 pass
 0 fail
 174 expect() calls
Ran 107 tests across 1 file. [10.34s]
```

### 5.7 Architecture & Annotation Checks
```sh
$ bun run script/check-architecture.ts && bun run script/check-opencode-annotations.ts --worktree
check-architecture: ok (12 classified Kilo ratchet sites, 0 boundary violations).
No shared upstream source files changed — nothing to check.

$ cd packages/kilo-vscode && bun run check-kilocode-change
$ ! grep -rIn 'kilocode_change' . ../kilo-ui/ --exclude='package.json' --exclude='*.md' --exclude-dir='node_modules' --exclude-dir='dist' | grep -v '`kilocode_change`'
```

### 5.8 Verification of Orphaned Upstream Skill
```sh
$ find .kilo/skills .opencode/skills -maxdepth 2
.kilo/skills
.kilo/skills/release-jetbrains
.kilo/skills/release-jetbrains/script
.kilo/skills/release-jetbrains/SKILL.md
.kilo/skills/chart
.kilo/skills/chart/SKILL.md
.kilo/skills/kilocode-merge-minimizer
.kilo/skills/kilocode-merge-minimizer/SKILL.md
.kilo/skills/icon-vscode
.kilo/skills/icon-vscode/SKILL.md
.kilo/skills/jetbrains-cli-pin
.kilo/skills/jetbrains-cli-pin/script
.kilo/skills/jetbrains-cli-pin/SKILL.md
.kilo/skills/icon-jetbrains
.kilo/skills/icon-jetbrains/examples.md
.kilo/skills/icon-jetbrains/SKILL.md
.kilo/skills/icon-jetbrains/palette.md
.kilo/skills/gh-issues
.kilo/skills/gh-issues/SKILL.md
.opencode/skills
.opencode/skills/effect
.opencode/skills/effect/SKILL.md
.opencode/skills/rtl-aware-development
.opencode/skills/rtl-aware-development/SKILL.md
```

---

## 6. Limitations of Review

1. **Static Analysis & In-Tree Testing:** Findings are based on static AST/control-flow analysis of repository source files, git diffs, and executed unit test suites within the local worktree.
2. **User-Defined Dynamic Skill Paths:** Custom user configurations specifying `skills.paths` or `KILO_CONFIG_DIR` will load skills from those explicitly provided filesystem paths according to configured trust rules.
3. **JetBrains Plugin Pinning:** In production builds, the JetBrains plugin relies on the pinned CLI release (`7.0.13` in `gradle.properties`); local development mode (`kilo.cli.pinned=false`) uses the audited CLI source.
