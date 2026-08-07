# Configuration Regression & Fallback Audit Report: PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Target / Range:** OpenCode `v1.18.14..v1.18.15` (upstream commit `d7b115f623`)  
**Base Commit:** `b6505b164bee1acf20d5c33dbc052e8a60c464c0` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed Branch Head (HEAD):** `94fd41e3a2892ad667c890c2d995813aa706bdd0` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Main Branch:** `4f59fcb666e9d4206ca7839cc9d9c3ee99a81885` (`origin/main`)  
**Audit Date:** 2026-08-07  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Safe with 1 Actionable Finding (Medium)**.
- **Summary:** PR #13002 has been thoroughly audited for configuration regression, unexpected `opencode` fallback paths, and broken `.kilo`-only configuration resolution. The core configuration discovery and path resolution pipelines in `packages/opencode/src/config/` and `packages/opencode/src/kilocode/config/` remain intact: `.kilo` and `.kilocode` remain the only recognized configuration directory targets (`.opencode` is strictly excluded from directory discovery), and `.kilo/kilo.jsonc` remains the canonical write target.
- **Primary Finding:** Upstream commit `66fdd51f0d` introduced `.opencode/skills/rtl-aware-development/SKILL.md`. Because Kilo's skill loader strictly scans `.kilo/skills/` (and legacy `.kilocode/skills/`) rather than `.opencode/skills/`, this new skill is inaccessible to Kilo runtime agents until it is relocated to `.kilo/skills/rtl-aware-development/SKILL.md`.
- **Secondary Validations:** Upstream TUI cursor style configuration (`feat(tui): add cursor style configuration (#32295)`) is cleanly integrated into `packages/tui/src/config/index.tsx` and adapted in `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx` with zero `.opencode` fallback leakage. The restoration of `kilo web` (`packages/opencode/src/cli/cmd/web.ts`) operates in server mode without ambient project config lookups.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated all files added, modified, or deleted across the PR diff between base commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0` and PR head `94fd41e3a2892ad667c890c2d995813aa706bdd0` (214 changed files across monorepo packages, documentation, plans, and build scripts).

Specific subsystems audited:
1. **Core Configuration Path Resolution & Discovery:**
   - `packages/opencode/src/config/paths.ts` (`ConfigPaths.directories`, `ConfigPaths.files`)
   - `packages/opencode/src/config/config.ts` (`Config.Service`, `globalConfigFile`, `loadInstanceState`, `loadGlobal`)
   - `packages/opencode/src/kilocode/config/config.ts` (`KilocodeConfig.projectConfigFiles`, `ALL_CONFIG_FILES`, `KILO_DIR_SUFFIXES`, `updateProjectConfig`)
2. **TUI Configuration & Cursor Style:**
   - `packages/tui/src/config/index.tsx` (`Cursor` schema, `Info`, `Resolved`, `resolve()`)
   - `packages/opencode/src/config/tui.ts` (`TuiConfig.loadState`, `migrateTuiConfig`)
   - `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx` (`KiloTuiConfig.resolve`)
   - `packages/tui/test/config.test.tsx` and `packages/opencode/test/kilocode/cli/cmd/tui/context/tui-config.test.ts`
3. **Skill & Command Discovery:**
   - `packages/opencode/src/skill/index.ts` (`KILO_SKILL_PATTERN`, `EXTERNAL_SKILL_PATTERN`, `scan()`)
   - `packages/opencode/src/skill/discovery.ts` (`Discovery.pull`)
   - `packages/opencode/src/config/command.ts` (`ConfigCommand.load`)
   - `packages/opencode/src/command/index.ts` (`Command.Service`)
   - `packages/opencode/src/kilocode/command-files.ts` (deletion of standalone command files helper)
4. **JetBrains Plugin & VS Code Extension Configuration:**
   - `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/rpc/KiloAgentBehaviorRpcApiImpl.kt`
   - `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/cli/KiloCliDataParser.kt`
   - `packages/kilo-vscode/src/KiloProvider.ts`, `packages/kilo-vscode/src/SettingsEditorProvider.ts`
   - `.kilo/plans/agent-manager-multi-project-implementation-handoff.md` and `agent-manager-multi-project-shipping-gaps.md`
5. **CLI Commands & Server Startup:**
   - `packages/opencode/src/cli/cmd/web.ts` and `packages/opencode/src/index.ts`
   - `script/upstream/transforms/remove-kilo-web.ts` (removal of transform)

### 2.2 Methodology
- **Codebase & Diff AST/Grep Audits:** Traced all occurrences of `.opencode`, `opencode.json`, `.kilo`, `kilo.json`, `config.json`, `tui.json`, `skills`, `command`, `cursor`, and `directories()` across the entire PR changeset and configuration loading call chains.
- **Precedence Order Verification:** Inspected the exact file and directory discovery sequences to ensure `.kilo` always takes precedence over legacy `.kilocode`, that `.opencode` directories are never scanned as project config directories, and that global fallbacks do not override local project settings.
- **Skill Discovery Path Confinement:** Checked whether new or existing skill resolution paths respect Kilo's trust boundaries and root directory confinement.
- **Automated Test Execution:** Executed configuration unit tests across `packages/tui` and `packages/opencode` to verify schema decode, fallback handling, and constraint validation.

---

## 3. Findings

### Finding 1: Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md` is Omitted from Kilo Skill Discovery
- **Severity:** Medium (Functional / Skill Discovery Gap)
- **Provenance:** Introduced by upstream commit `66fdd51f0d` (`docs: add RTL development skill (#40543)`).
- **File Location:** `.opencode/skills/rtl-aware-development/SKILL.md`
- **Analysis:**
  1. Upstream OpenCode stores repository-level skills in `.opencode/skills/`.
  2. In Kilo, skill discovery (`packages/opencode/src/skill/index.ts:245-261`) iterates over `config.directories()`, which resolves only `Global.Path.config`, `.kilo`, `.kilocode`, and `KILO_CONFIG_DIR` (via `packages/opencode/src/config/paths.ts:23-41`).
  3. External directories scanned by Kilo are strictly `.agents/skills/` and `.claude/skills/` (`packages/opencode/src/skill/index.ts:213-243`).
  4. Because Kilo intentionally removed `.opencode` from directory discovery targets, `.opencode/skills/rtl-aware-development/SKILL.md` is **never discovered or registered** by Kilo CLI, VS Code Extension, or JetBrains plugin.
  5. In addition, repository conventions in `AGENTS.md` mandate:
     > *"Project config: .kilo/command/*.md, .kilo/agent/*.md, kilo.json, AGENTS.md. Put new commands and agents in .kilo/. Do not use .kilocode/ or .opencode/."*
- **Impact:** The new RTL development skill added upstream will not be available to agents working in this repository unless moved to `.kilo/skills/`.
- **Recommended Action:**
  - Relocate `.opencode/skills/rtl-aware-development/SKILL.md` to `.kilo/skills/rtl-aware-development/SKILL.md`.
  - Update any OpenCode-specific branding in the skill description to neutral or Kilo-specific phrasing.

---

### Finding 2: Removal of `KilocodeHttpApi.commandFiles` and `removeCommand` Endpoints
- **Severity:** Low / Informational (Cleaned Deprecated Architecture)
- **Provenance:** PR #13002 refactor (`packages/opencode/src/kilocode/command-files.ts` deletion, commit `7f36c5044a`).
- **Files Affected:**
  - `packages/opencode/src/kilocode/command-files.ts` (deleted)
  - `packages/opencode/src/kilocode/server/httpapi/groups/kilocode.ts` (removed `commandFiles`, `removeCommand`)
  - `packages/opencode/src/kilocode/server/httpapi/handlers/kilocode.ts` (removed handlers)
  - `packages/opencode/test/kilocode/command-files.test.ts` (deleted)
  - `packages/kilo-jetbrains/shared/src/main/kotlin/ai/kilocode/rpc/dto/CommandFileDto.kt` (deleted)
  - `packages/kilo-jetbrains/backend/src/main/kotlin/ai/kilocode/backend/rpc/KiloAgentBehaviorRpcApiImpl.kt`
- **Analysis:**
  1. The standalone `/kilocode/command/files` and `/kilocode/command/remove` endpoints were an earlier experimental approach for JetBrains command file management.
  2. Command discovery in Kilo is natively handled by `ConfigCommand.load()` (`packages/opencode/src/config/command.ts`) during standard configuration loading (`Config.Service`), which scans `{command,commands}/**/*.md` across all discovered config directories (`.kilo`, `.kilocode`).
  3. JetBrains plugin removed the unused `commandFiles` RPC endpoints, aligning with the standard `/command` and `/skill` endpoints.
  4. No `.opencode` directory search or fallback was accidentally introduced or removed during this cleanup.
- **Recommended Action:** No change required.

---

### Finding 3: Restoration of `kilo web` CLI Command (`packages/opencode/src/cli/cmd/web.ts`)
- **Severity:** Low / Informational (Command Restoration)
- **Provenance:** PR #13002 merge sync (removal of `script/upstream/transforms/remove-kilo-web.ts`).
- **Files Affected:**
  - `packages/opencode/src/cli/cmd/web.ts` (restored)
  - `packages/opencode/src/index.ts` (re-registered `WebCommand`)
  - `packages/opencode/src/kilocode/commands.ts` (registered `WebCommand`)
  - `script/upstream/transforms/remove-kilo-web.ts` (deleted)
- **Analysis:**
  1. Previously, Kilo stripped the upstream `web` command during merge transforms.
  2. In PR #13002, `WebCommand` is restored as `kilo web` (`"start kilo server and open web interface"`).
  3. `WebCommand` explicitly specifies `instance: false` (`packages/opencode/src/cli/cmd/web.ts:14`), meaning it does not create an ambient startup instance or perform premature project config file lookups. Configuration is resolved dynamically per request by the server middleware based on the `x-kilo-directory` header.
  4. The command does not add any fallback logic for `.opencode` configuration paths.
- **Recommended Action:** No change required.

---

## 4. Notable Non-Findings (Verified Clean Areas)

### 4.1 Strict Exclusion of `.opencode` from Config Directory Discovery
- **Audited File:** `packages/opencode/src/config/paths.ts`
- **Verification:**
  ```ts
  // packages/opencode/src/config/paths.ts:23-41
  export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
    const afs = yield* FSUtil.Service
    return unique([
      Global.Path.config,
      ...(!Flag.KILO_DISABLE_PROJECT_CONFIG
        ? yield* afs.up({
            targets: [".kilocode", ".kilo"], // kilocode_change: strictly .kilocode and .kilo
            start: directory,
            stop: worktree,
          })
        : []),
      ...(yield* afs.up({
        targets: [".kilocode", ".kilo"], // kilocode_change
        start: Global.Path.home,
        stop: Global.Path.home,
      })),
      ...(Flag.KILO_CONFIG_DIR ? [Flag.KILO_CONFIG_DIR] : []),
    ])
  })
  ```
- **Result:** `.opencode` is completely omitted from directory traversal. Only `.kilo` and legacy `.kilocode` are recognized.

### 4.2 Project Config File Precedence & Write Targets
- **Audited Files:** `packages/opencode/src/config/config.ts`, `packages/opencode/src/kilocode/config/config.ts`
- **Verification:**
  - `KilocodeConfig.ALL_CONFIG_FILES`: `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json"]` (read precedence order: `kilo.jsonc` > `kilo.json` > `opencode.jsonc` > `opencode.json`).
  - `KilocodeConfig.KILO_DIR_SUFFIXES`: `[".kilo", ".kilocode"]` (directory precedence: `.kilo` > `.kilocode`).
  - `KilocodeConfig.updateProjectConfig`: Writes target the first existing configuration file, defaulting to `.kilo/kilo.jsonc`. Unsets are properly propagated across lower-precedence files so deletions cannot expose stale legacy settings.
- **Result:** Writes remain strictly confined to `.kilo/` paths and do not write to `.opencode/`.

### 4.3 TUI Cursor Configuration Integration
- **Audited Files:**
  - `packages/tui/src/config/index.tsx`
  - `packages/opencode/src/config/tui.ts`
  - `packages/opencode/src/kilocode/cli/cmd/tui/context/tui-config.tsx`
- **Verification:**
  - Upstream added the `Cursor` struct to `@opencode-ai/tui/config`:
    ```ts
    export const Cursor = Schema.Struct({
      style: Schema.optional(Schema.Literals(["block", "underline", "line", "default"])),
      blinking: Schema.optional(Schema.Boolean),
    })
    ```
  - Kilo correctly adapts this in `KiloTuiConfig.resolve()`:
    ```ts
    cursor: next.cursor
      ? {
          style: next.cursor.style ?? "block",
          blinking: next.cursor.blinking ?? true,
        }
      : undefined,
    ```
  - `TuiConfig.loadState` (`packages/opencode/src/config/tui.ts`) continues to discover `tui.json`/`tui.jsonc` only via `ConfigPaths.directories()` (`.kilo`, `.kilocode`, `Global.Path.config`, `KILO_CONFIG_DIR`) and project root files via `ConfigPaths.files("tui", ...)`.
  - All unit tests in `packages/tui/test/config.test.tsx` pass (9/9).
- **Result:** TUI cursor configuration integrates seamlessly without altering config path discovery.

### 4.4 Agent Manager Multi-Project Configuration Safeguards
- **Audited Files:** `.kilo/plans/agent-manager-multi-project-implementation-handoff.md`, `agent-manager-multi-project-shipping-gaps.md`
- **Verification:**
  - The multi-project architecture handoff explicitly enforces:
    1. Settings writes target the canonical registered project root (`.kilo/`), never an active worktree.
    2. Runtime config remains directory-correct (local worktree sessions use exact worktree directory).
    3. Indexing consent is machine-local per canonical project and cannot be granted via repository config.
    4. No fallbacks to ambient workspace roots in multi-project mode.
- **Result:** Architectural design prevents cross-project config contamination and enforces `.kilo` target boundaries.

---

## 5. Command Outputs & Evidence

### 5.1 Verification of Config Directory Targets in Source
```sh
$ git grep 'targets:' packages/opencode/src/config/paths.ts
packages/opencode/src/config/paths.ts:17:    targets: [`${name}.jsonc`, `${name}.json`],
packages/opencode/src/config/paths.ts:29:          targets: [".kilocode", ".kilo"], // kilocode_change
packages/opencode/src/config/paths.ts:35:      targets: [".kilocode", ".kilo"], // kilocode_change
```

### 5.2 Verification of TUI Config Tests
```sh
$ cd packages/tui && bun test ./test/config.test.tsx
bun test v1.3.14 (0d9b296a)

 9 pass
 0 fail
 28 expect() calls
Ran 9 tests across 1 file. [910.00ms]
```

### 5.3 Audit of Skill Directories in Repository Root
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
*(Notice that all active Kilo skills reside under `.kilo/skills/`, confirming that `.opencode/skills/rtl-aware-development` is currently orphaned).*

---

## 6. Limitations of Review

1. **Static Analysis & In-Tree Verification:** The findings are based on AST, regex, and control-flow audits of the repository sources and the PR #13002 git diff.
2. **Third-Party User Configurations:** User environments defining custom `skills.paths` or `KILO_CONFIG_DIR` pointing to arbitrary directories will load skills from those specified paths as configured; this audit verifies the default repository-level and project-level discovery mechanisms.
3. **JetBrains Runtime CLI Pinned Binary:** The JetBrains plugin relies on the pinned CLI version (`7.0.13` in `gradle.properties` / `packages/kilo-jetbrains/package.json`); when developing in local repo CLI mode (`kilo.cli.pinned=false`), all CLI changes match the audited monorepo source.
