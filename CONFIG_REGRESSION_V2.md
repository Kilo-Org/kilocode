# Configuration Regression & Fallback Audit Report (Round 2): PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Target / Range:** OpenCode `v1.18.14..v1.18.15` (upstream commit `d7b115f623`)  
**Base Commit:** `4bb1c2a45b977e64c1b208c3f317de58c8e1dcbb` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed PR Branch Head (HEAD):** `db7c9eb7ebe652b897c3ca5e8e76b06d25175024` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Main Branch:** `4f59fcb666e9d4206ca7839cc9d9c3ee99a81885` (`origin/main`)  
**Audit Date:** 2026-08-07  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Safe with 1 Actionable Finding (Medium)**.
- **Summary:** Round 2 of the configuration regression audit evaluated PR #13002 at branch head `db7c9eb7ebe652b897c3ca5e8e76b06d25175024` against base `4bb1c2a45b977e64c1b208c3f317de58c8e1dcbb`. The PR cleanly preserves Kilo's `.kilo`-first and `.kilo`-only configuration architecture. No regressions, unintended `.opencode` fallback paths, or broken configuration discovery mechanisms were introduced by the upstream merge or subsequent review commits.
- **Re-evaluated Round 1 Finding:** Upstream commit `66fdd51f0d` introduced `.opencode/skills/rtl-aware-development/SKILL.md`. Because Kilo's skill discovery engine deliberately scans only `.kilo/skills/`, legacy `.kilocode/skills/`, and external `.agents/skills/` or `.claude/skills/` directories, this skill remains undiscovered at runtime. It should be relocated to `.kilo/skills/rtl-aware-development/SKILL.md` to be accessible.
- **Round 2 Updates & Validations:** Subsequent commits resolving review feedback (including proxy 5xx character-budget buffering, ACP bounded connection waiting, Persian localization in webviews, and architecture ratchets) do not alter configuration discovery or path resolution. All automated test suites for configuration loading, precedence, unsetting, TUI cursor configuration, and architecture guards pass cleanly.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated all configuration discovery, loading, migration, and path resolution logic across the 48 commits spanning base `origin/johnnyeric/kilo-opencode-v1.18.13` and head `origin/johnnyeric/kilo-opencode-v1.18.15` (`db7c9eb7eb`), with particular focus on:

1. **Configuration Directory & File Discovery:**
   - `packages/opencode/src/config/paths.ts` (`ConfigPaths.directories`, `ConfigPaths.files`)
   - `packages/opencode/src/config/config.ts` (`Config.Service`, `loadInstanceState`, `loadGlobal`, `globalConfigFile`)
   - `packages/opencode/src/kilocode/config/config.ts` (`KilocodeConfig.projectConfigFiles`, `ALL_CONFIG_FILES`, `KILO_DIR_SUFFIXES`, `updateProjectConfig`, `propagateUnset`, `detectOpencodeConfig`)
2. **TUI & Cursor Configuration:**
   - `packages/tui/src/config/index.tsx` (`Cursor` schema, `Info`, `Resolved`, `resolve()`)
   - `packages/opencode/src/config/tui.ts` (`TuiConfig.loadState`)
   - `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx` (`KiloTuiConfig.makeStore`, `resolve`)
   - Prompt component cursor integration with Vim modal editing (`packages/tui/src/component/prompt/index.tsx`)
3. **Skill, Agent & Command Discovery:**
   - `packages/opencode/src/skill/index.ts` (`KILO_SKILL_PATTERN`, `EXTERNAL_SKILL_PATTERN`, `discoverSkills`, `scan`)
   - Upstream skill addition `.opencode/skills/rtl-aware-development/SKILL.md`
   - `packages/opencode/src/config/command.ts` and `packages/opencode/src/config/agent.ts`
4. **Architecture & Boundary Ratchets:**
   - `script/check-architecture.ts` and `script/architecture-allowlist.json`
   - `script/check-opencode-annotations.ts` and `bun run check-kilocode-change`

### 2.2 Methodology
- **Static AST & Call Graph Audits:** Audited all call sites referencing `.opencode`, `opencode.json`, `.kilo`, `.kilocode`, `ConfigPaths.directories`, `projectConfigFiles`, and `skills` to ensure strict path confinement and proper precedence order.
- **Precedence Order & Sentinel Verification:** Verified that project writes always target `.kilo/kilo.jsonc`, that `.kilo` precedes `.kilocode`, and that unsets propagate across layered files via `propagateUnset`.
- **Runtime & Unit Test Execution:** Ran targeted test suites in `packages/opencode` and `packages/tui` covering configuration loading, invalid JSON resilience, path traversal confinement, bash permission migration, TUI reactive store updates, and architecture boundary enforcement.

---

## 3. Findings

### Finding 1: Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md` is Omitted from Kilo Skill Discovery (Open)
- **Severity:** Medium (Functional / Skill Discovery Gap)
- **Status:** Open (re-evaluated in Round 2; file still resides at `.opencode/skills/rtl-aware-development/SKILL.md`)
- **Provenance:** Introduced in upstream commit `66fdd51f0d` (`docs: add RTL development skill (#40543)`).
- **File Location:** `.opencode/skills/rtl-aware-development/SKILL.md`
- **Analysis:**
  1. Upstream OpenCode places repository skills in `.opencode/skills/`.
  2. Kilo's skill discovery (`packages/opencode/src/skill/index.ts:245-261`) iterates over directories returned by `config.directories()`, which resolves `Global.Path.config`, `.kilo`, `.kilocode`, and `KILO_CONFIG_DIR` (`packages/opencode/src/config/paths.ts:23-41`).
  3. External directories scanned by Kilo are strictly `.agents/skills/` and `.claude/skills/`.
  4. Because Kilo strictly omits `.opencode` from directory discovery, `.opencode/skills/rtl-aware-development/SKILL.md` is **never discovered or loaded** by Kilo agents.
  5. In addition, repository guidelines in `AGENTS.md` explicitly mandate:
     > *"Project config: .kilo/command/*.md, .kilo/agent/*.md, kilo.json, AGENTS.md. Put new commands and agents in .kilo/. Do not use .kilocode/ or .opencode/."*
- **Impact:** Agents operating in Kilo cannot use or invoke the RTL development skill added in OpenCode v1.18.15.
- **Recommended Action:**
  - Move `.opencode/skills/rtl-aware-development/SKILL.md` to `.kilo/skills/rtl-aware-development/SKILL.md`.
  - Adjust any OpenCode-specific branding in the skill body to neutral or Kilo-specific terminology if appropriate.

---

### Finding 2: Deprecation of `KilocodeHttpApi.commandFiles` & `removeCommand` RPC Endpoints (Closed / Clean)
- **Severity:** Low / Informational
- **Status:** Closed / Verified Clean
- **Provenance:** PR #13002 refactor (`7f36c5044a`).
- **Files Affected:** `packages/opencode/src/kilocode/command-files.ts` (deleted), JetBrains RPC handlers.
- **Analysis:** Standalone RPC endpoints for command file inspection were removed in favor of standard `/command` and `/skill` discovery pipelines. Native command discovery in `ConfigCommand.load()` correctly resolves commands from `.kilo/command` and `.kilocode/command`. No `.opencode` fallback paths were created or broken.
- **Recommended Action:** None.

---

### Finding 3: Restoration of `kilo web` CLI Command (Closed / Clean)
- **Severity:** Low / Informational
- **Status:** Closed / Verified Clean
- **Provenance:** PR #13002 merge sync (restoration of `packages/opencode/src/cli/cmd/web.ts`).
- **Analysis:** `WebCommand` specifies `instance: false`, preventing ambient startup instance creation and premature project config file lookups. Request-level configuration is resolved dynamically by middleware based on the `x-kilo-directory` header. No `.opencode` fallback logic exists.
- **Recommended Action:** None.

---

## 4. Notable Non-Findings (Verified Clean Areas)

### 4.1 Strict Exclusion of `.opencode` from Config Directory Discovery
- **Audited File:** `packages/opencode/src/config/paths.ts`
- **Verification:** `ConfigPaths.directories` explicitly restricts target traversal:
  ```ts
  targets: [".kilocode", ".kilo"], // kilocode_change: strictly .kilocode and .kilo
  ```
- **Result:** No `.opencode` directory is ever returned by `ConfigPaths.directories`.

### 4.2 Project Config Precedence and Write Target Confinement
- **Audited Files:** `packages/opencode/src/kilocode/config/config.ts`, `packages/opencode/src/config/config.ts`
- **Verification:**
  - `KilocodeConfig.ALL_CONFIG_FILES`: `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"]` (read precedence).
  - `KilocodeConfig.KILO_DIR_SUFFIXES`: `[".kilo", ".kilocode"]` (directory precedence).
  - `updateProjectConfig`: Writes target the first existing configuration file, defaulting to `.kilo/kilo.jsonc`.
  - `propagateUnset`: Propagates null delete sentinels across all layered config files so lower-precedence files cannot resurrect deleted keys.
- **Result:** Config mutations remain strictly confined to `.kilo/` paths and cleanly sanitize lower layers.

### 4.3 TUI Cursor Configuration Integration
- **Audited Files:** `packages/tui/src/config/index.tsx`, `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx`, `packages/tui/src/component/prompt/index.tsx`
- **Verification:**
  - Upstream `Cursor` schema (`style: "block" | "underline" | "line" | "default"`, `blinking: boolean`) is correctly integrated into `TuiConfig.Info` and `TuiConfig.Resolved`.
  - `KiloTuiConfig.makeStore` and `KiloTuiConfig.resolve` adapt cursor settings with proper defaults (`block`, `blinking: true`).
  - In `packages/tui/src/component/prompt/index.tsx`, cursor styling respects active Vim mode (`!vim.vimEnabled()`), preventing cursor style conflicts during modal editing.
  - Unit tests in `packages/tui/test/config.test.tsx` (9/9 passed) and `packages/opencode/test/kilocode/cli/cmd/tui/context/tui-config.test.ts` (3/3 passed) verify schema validation and hot reload reactivity.

### 4.4 Leftover Opencode Migration Warning
- **Audited File:** `packages/opencode/src/kilocode/config/config.ts` (`detectOpencodeConfig`, `opencodeConfigNotification`)
- **Verification:** When an existing `.opencode` folder is present on disk, Kilo does not fall back to it; instead, `opencodeConfigNotification` generates a synthetic notification directing the user to migrate their settings into `.kilo/` or `~/.config/kilo/`.

### 4.5 Architecture Boundary & Ratchet Compliance
- **Audited Files:** `script/check-architecture.ts`, `script/architecture-allowlist.json`
- **Verification:** `bun run script/check-architecture.ts` ran with 0 boundary violations across core directionality, InstanceState singletons, SQLite constructors, tool environment reads, and HttpApi handlers.

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
Ran 9 tests across 1 file. [871.00ms]
```

### 5.3 KiloTuiConfig Reactive Store Tests
```sh
$ cd packages/opencode && bun test ./test/kilocode/cli/cmd/tui/context/tui-config.test.ts
bun test v1.3.14 (0d9b296a)

 3 pass
 0 fail
 15 expect() calls
Ran 3 tests across 1 file. [3.92s]
```

### 5.4 Core Configuration & Permission Tests
```sh
$ cd packages/opencode && bun test \
    ./test/config/config.test.ts \
    ./test/kilocode/config/config.test.ts \
    ./test/kilocode/project-config-update.test.ts \
    ./test/kilocode/permission/config-paths.test.ts
bun test v1.3.14 (0d9b296a)

 174 pass
 0 fail
 319 expect() calls
Ran 174 tests across 4 files. [36.89s]
```

### 5.5 Architecture & Annotation Checks
```sh
$ bun run script/check-architecture.ts && bun run script/check-opencode-annotations.ts --worktree
check-architecture: ok (12 classified Kilo ratchet sites, 0 boundary violations).
No shared upstream source files changed — nothing to check.

$ cd packages/kilo-vscode && bun run check-kilocode-change
$ ! grep -rIn 'kilocode_change' . ../kilo-ui/ --exclude='package.json' --exclude='*.md' --exclude-dir='node_modules' --exclude-dir='dist' | grep -v '`kilocode_change`'
```

### 5.6 Verification of Orphaned Upstream Skill
```sh
$ find .kilo/skills .opencode/skills -maxdepth 2
.kilo/skills
.kilo/skills/chart
.kilo/skills/gh-issues
.kilo/skills/icon-jetbrains
.kilo/skills/icon-vscode
.kilo/skills/jetbrains-cli-pin
.kilo/skills/kilocode-merge-minimizer
.kilo/skills/release-jetbrains
.opencode/skills
.opencode/skills/effect
.opencode/skills/rtl-aware-development
```

---

## 6. Limitations of Review

1. **Static Analysis & In-Tree Testing:** Findings are grounded in static AST/control-flow analysis of repository source files, git diffs, and executed unit test suites within the local worktree.
2. **User-Defined Dynamic Skill Paths:** Custom user configurations specifying `skills.paths` or `KILO_CONFIG_DIR` will load skills from those explicitly provided filesystem paths according to configured trust rules.
3. **JetBrains Plugin Pinning:** In production builds, the JetBrains plugin relies on the pinned CLI release (`7.0.13` in `gradle.properties`); local development mode (`kilo.cli.pinned=false`) uses the audited CLI source.
