# Configuration Regression & Fallback Audit Report (Round 4): PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Target / Range:** OpenCode `v1.18.14..v1.18.15` (upstream commit `d7b115f623`)  
**Base Commit (origin/main):** `95ad1705f5e357e7cd6f0cfbdaf17a8c55e01093`  
**Reviewed PR Branch Head (HEAD):** `860f5d9e680fb2a1b7c77913ba706419e44124b3` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Audit Date:** 2026-08-19  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Safe with 1 Actionable Finding (Medium)**.
- **Summary:** Round 4 of the configuration regression audit evaluated PR #13002 at branch head `860f5d9e680fb2a1b7c77913ba706419e44124b3` (`origin/johnnyeric/kilo-opencode-v1.18.15`). The PR preserves Kilo's strict `.kilo`-first and `.kilo`-only configuration discovery and loading models. No regressions, unintended `.opencode` directory fallbacks, or broken configuration discovery mechanisms have been introduced or re-introduced.
- **Status of Prior Findings:**
  1. *Finding 1 (Medium - Open):* Upstream commit `66fdd51f0d` introduced `.opencode/skills/rtl-aware-development/SKILL.md`. Because Kilo's skill discovery mechanism scans only `.kilo/skills/`, legacy `.kilocode/skills/`, and external `.agents/skills/` or `.claude/skills/` directories, this skill remains undiscovered at runtime. It must be relocated to `.kilo/skills/rtl-aware-development/SKILL.md` to be accessible to Kilo runtime agents.
  2. *Finding 2 (Closed / Verified Clean):* `command-files.ts` retention remains verified clean with zero diff from base.
  3. *Finding 3 (Closed / Verified Clean):* `kilo web` CLI command exclusion remains strictly enforced.
- **Round 4 Validations:**
  - Audit of recent commit `860f5d9e68` verified that the test assertion typing adjustment in `packages/opencode/test/kilocode/server/config-overlay.test.ts` (`body.effective.permission.edit`) accurately aligns with runtime contracts and tests pass 100%.
  - TUI cursor configuration (`packages/tui/src/config/index.tsx` and `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx`) remains robustly integrated with full Vim modal editing safeguards.
  - Verification of `propagateUnset` confirmed that null delete-sentinels propagate cleanly across layered configuration files without leaking deleted keys across precedence boundaries.
  - Review of config schemas in `packages/core/src/v1/config/` confirmed that experimental flags (`semantic_indexing`, `codebase_search`, `swe_pruner`, `agent_requirements`) are appropriately retired or normalized via `normalizeLoadedConfig` / `retireExperimentalFlags`, and no un-mirrored config additions exist.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated all configuration discovery, loading, migration, overlay, and path resolution logic across the changeset up to PR head `860f5d9e680fb2a1b7c77913ba706419e44124b3`, focusing on:

1. **Configuration Directory & File Discovery:**
   - `packages/opencode/src/config/paths.ts` (`ConfigPaths.directories`, `ConfigPaths.files`)
   - `packages/opencode/src/config/config.ts` (`Config.Service`, `loadInstanceState`, `loadGlobal`, `globalConfigFile`)
   - `packages/opencode/src/kilocode/config/config.ts` (`KilocodeConfig.projectConfigFiles`, `ALL_CONFIG_FILES`, `KILO_DIR_SUFFIXES`, `updateProjectConfig`, `propagateUnset`, `detectOpencodeConfig`)
2. **Skill Discovery & Path Scanning:**
   - `packages/opencode/src/skill/index.ts` (`KILO_SKILL_PATTERN`, `EXTERNAL_SKILL_PATTERN`, `discoverSkills`, `scan`)
   - Status of upstream skill `.opencode/skills/rtl-aware-development/SKILL.md`
3. **TUI & Cursor Configuration:**
   - `packages/tui/src/config/index.tsx` (`Cursor` schema, `Info`, `Resolved`, `resolve()`)
   - `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx` (`KiloTuiConfig.resolve`, `makeStore`)
   - `packages/tui/src/component/prompt/index.tsx` (Vim modal editing safeguards)
4. **Recent Commit Audit (commit `860f5d9e68`):**
   - `packages/opencode/test/kilocode/server/config-overlay.test.ts`
   - Test suites in `packages/opencode/test/kilocode/` and `packages/tui/test/`
5. **Config Schema Additions & Unset Propagation:**
   - `packages/core/src/v1/config/config.ts` (`ConfigV1.Info`)
   - `packages/core/src/v1/config/agent.ts`
   - `propagateUnset` execution across JSON and JSONC layered configuration files

### 2.2 Methodology
- **Static AST & Call Graph Audits:** Inspected all call sites referencing `.opencode`, `opencode.json`, `.kilo`, `.kilocode`, `ConfigPaths.directories`, and `projectConfigFiles` to verify that `.opencode` is never used as an active discovery target.
- **Precedence & Mutation Path Verification:** Audited `updateProjectConfig` and `propagateUnset` to verify that writes are confined to `.kilo/kilo.jsonc` and that null delete sentinels cleanly prune lower-precedence files.
- **Empirical Unit Test Execution:** Ran full unit test suites covering configuration discovery, JSONC parsing resilience, path confinement, TUI reactive store updates, bash permission migration, and overlay routes.

---

## 3. Findings

### Finding 1: Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md` is Omitted from Kilo Skill Discovery (Open)
- **Severity:** Medium (Functional / Skill Discovery Gap)
- **Status:** Open (re-audited in Round 4; file remains located in `.opencode/skills/rtl-aware-development/SKILL.md`)
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

## 4. Notable Non-Findings (Verified Clean Areas)

### 4.1 Strict Exclusion of `.opencode` from Config Directory Discovery
- **Audited Files:** `packages/opencode/src/config/paths.ts`, `packages/opencode/src/kilocode/config/config.ts`
- **Verification:**
  - `ConfigPaths.directories` strictly constrains directory traversal targets:
    ```ts
    targets: [".kilocode", ".kilo"], // kilocode_change: strictly .kilocode and .kilo
    ```
  - `KilocodeConfig.KILO_DIR_SUFFIXES` is `[".kilo", ".kilocode"]`.
- **Result:** `.opencode` is completely omitted from directory discovery. Only `.kilo` and legacy `.kilocode` directories are returned.

### 4.2 Project Config Precedence and Write Target Confinement
- **Audited Files:** `packages/opencode/src/kilocode/config/config.ts`, `packages/opencode/src/config/config.ts`
- **Verification:**
  - `KilocodeConfig.ALL_CONFIG_FILES`: `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"]` (read precedence order).
  - `updateProjectConfig`: Writes always target the first existing configuration file, defaulting to `.kilo/kilo.jsonc`.
  - `propagateUnset`: Propagates null delete sentinels across all layered config files so lower-precedence files cannot resurrect deleted keys.
- **Result:** Configuration mutations remain strictly confined to `.kilo/` paths and cleanly sanitize lower layers.

### 4.3 TUI Cursor Configuration Integration & Vim Modal Safeguards
- **Audited Files:** `packages/tui/src/config/index.tsx`, `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx`, `packages/tui/src/component/prompt/index.tsx`
- **Verification:**
  - Upstream `Cursor` schema (`style: "block" | "underline" | "line" | "default"`, `blinking: boolean`) is correctly integrated into `TuiConfig.Info` and `TuiConfig.Resolved`.
  - `KiloTuiConfig.resolve()` / `makeStore` in `tui-config.tsx` adapts cursor settings with defaults (`block`, `blinking: true`).
  - In `packages/tui/src/component/prompt/index.tsx`, cursor styling respects active Vim mode (`if (tuiConfig.cursor && !vim.vimEnabled()) input.cursorStyle = tuiConfig.cursor`), preventing cursor style conflicts during modal editing.
  - Unit tests in `packages/tui/test/config.test.tsx` (9/9 passed) and `packages/opencode/test/kilocode/cli/cmd/tui/context/tui-config.test.ts` verify schema validation and hot reload reactivity.

### 4.4 Commit `860f5d9e68` Changes to `config-overlay.test.ts`
- **Audited File:** `packages/opencode/test/kilocode/server/config-overlay.test.ts`
- **Verification:**
  - In commit `860f5d9e68`, line 700 of `config-overlay.test.ts` was simplified from optional chaining `body.effective?.permission?.edit` to direct property access `body.effective.permission.edit` following the explicit TypeScript interface typing in the test.
  - Test execution of `config-overlay.test.ts` passed 34/34 tests with 0 failures.

### 4.5 Leftover Opencode Migration Warning
- **Audited File:** `packages/opencode/src/kilocode/config/config.ts` (`detectOpencodeConfig`, `opencodeConfigNotification`)
- **Verification:** When an existing `.opencode` folder is present on disk, Kilo does not fall back to it; instead, `opencodeConfigNotification` generates a synthetic notification directing the user to migrate their settings into `.kilo/` or `~/.config/kilo/`.

### 4.6 Architecture Boundary & Annotation Cleanliness
- **Audited Files:** `script/check-architecture.ts`, `script/check-opencode-annotations.ts`, `packages/kilo-vscode/`
- **Verification:** `bun run script/check-architecture.ts` reported 0 boundary violations (8 classified Kilo ratchet sites). `check-opencode-annotations.ts` and `check-kilocode-change` reported clean trees.

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
Ran 9 tests across 1 file. [428.00ms]
```

### 5.3 Core Config, TUI Config Store, Permission Path, and Project Config Update Tests
```sh
$ cd packages/opencode && bun test \
    ./test/kilocode/config/config.test.ts \
    ./test/kilocode/cli/cmd/tui/context/tui-config.test.ts \
    ./test/kilocode/permission/config-paths.test.ts \
    ./test/kilocode/project-config-update.test.ts
bun test v1.3.14 (0d9b296a)

 77 pass
 0 fail
 189 expect() calls
Ran 77 tests across 4 files. [17.83s]
```

### 5.4 Config Overlay Test Suite (including Commit 860f5d9e68 changes)
```sh
$ cd packages/opencode && bun test ./test/kilocode/server/config-overlay.test.ts
bun test v1.3.14 (0d9b296a)

 34 pass
 0 fail
 84 expect() calls
Ran 34 tests across 1 file. [181.26s]
```

### 5.5 Full Core Configuration Tests
```sh
$ cd packages/opencode && bun test ./test/config/config.test.ts
bun test v1.3.14 (0d9b296a)

 108 pass
 0 fail
 176 expect() calls
Ran 108 tests across 1 file. [17.84s]
```

### 5.6 Architecture & Annotation Checks
```sh
$ bun run script/check-architecture.ts && bun run script/check-opencode-annotations.ts --worktree
check-architecture: ok (8 classified Kilo ratchet sites, 0 boundary violations).
No shared upstream source files changed — nothing to check.

$ cd packages/kilo-vscode && bun run check-kilocode-change
$ ! grep -rIn 'kilocode_change' . ../kilo-ui/ --exclude='package.json' --exclude='*.md' --exclude-dir='node_modules' --exclude-dir='dist' | grep -v '`kilocode_change`'
```

### 5.7 Verification of Orphaned Upstream Skill Location
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
3. **JetBrains Plugin Pinning:** In production builds, the JetBrains plugin relies on the pinned CLI release (`7.1.0-rc.2`); local development mode (`kilo.cli.pinned=false`) uses the audited CLI source.
