# OpenCode Mentions and Branding Audit Report: PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Target / Range:** OpenCode `v1.18.14..v1.18.15` (upstream commit `d7b115f623`)  
**Base Commit:** `b6505b164bee1acf20d5c33dbc052e8a60c464c0` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed Branch Head (HEAD):** `94fd41e3a2892ad667c890c2d995813aa706bdd0` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Main Branch:** `4f59fcb666e9d4206ca7839cc9d9c3ee99a81885` (`origin/main`)  
**Audit Date:** 2026-08-07  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Safe after 1 minor cleanup (P3)**.
- **Summary:** The merge from OpenCode v1.18.14 through v1.18.15 is exceptionally clean with respect to branding, UI copy, and external links. Upstream repository links in `packages/http-recorder/package.json` that were temporarily pulled in during upstream sync have already been resolved and reverted to `Kilo-Org/kilocode` in commit `94fd41e3a2`. All 34 newly added i18n locale files in `packages/ui/src/i18n/` were transformed to Kilo branding (`Kilo Go`) with zero leaked OpenCode strings. CLI command additions (`kilo web`) and help snapshots are properly branded as `kilo`.
- **Primary Finding:** One newly added skill file, `.opencode/skills/rtl-aware-development/SKILL.md`, was brought in under the `.opencode/` directory and contains the unbranded description string `"OpenCode Desktop should be RTL-aware..."`. This should be moved to `.kilo/skills/` (or removed if not applicable) and its description updated.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated all files added, modified, or deleted across the PR diff between base commit `b6505b164bee1acf20d5c33dbc052e8a60c464c0` and PR head `94fd41e3a2892ad667c890c2d995813aa706bdd0` (143 changed files across 9 packages, docs, scripts, and skills).

Specific areas audited:
1. **User Interface Strings & Translations:** `packages/session-ui/`, `packages/tui/`, `packages/ui/src/i18n/*` (34 newly added locale files), and `packages/kilo-vscode/webview-ui/`.
2. **Documentation & Skills:** `.opencode/skills/`, `packages/kilo-docs/`, `packages/ui/AGENTS.md`, and `packages/kilo-vscode/AGENTS.md`.
3. **CLI Output & Help Text:** `packages/opencode/src/cli/cmd/web.ts`, `packages/opencode/src/index.ts`, and CLI snapshot test files.
4. **Package Metadata & URLs:** `package.json`, `packages/*/package.json`, `packages/sdk-next/package.json`, and repository links (`github.com/anomalyco/*`, `*.opencode.ai`).
5. **Logs, Error Messages & Config Specs:** `packages/opencode/src/session/`, `packages/sdk/openapi.json`, and generated SDK artifacts.

### 2.2 Methodology
- **Automated Case-Insensitive Regex Sweeps:** Scanned the complete PR diff for `opencode`, `anomalyco`, `opencode.ai`, `anomaly.co`, and related domain patterns.
- **URL Extraction & Categorization:** Extracted all URLs from added/modified lines in the diff to ensure no upstream endpoints or issue trackers were introduced.
- **Cross-Package Translation Audit:** Analyzed all 34 new locale files added under `packages/ui/src/i18n/` to verify that upstream branding was replaced with Kilo equivalents.
- **Historical Commit & Provenance Tracing:** Inspected fix commit `94fd41e3a2` to verify the restoration of Kilo metadata in `packages/http-recorder/package.json`.

---

## 3. Findings

### Finding 1: Unbranded Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md`
- **Severity:** P3 (Low / Release & Skill Hygiene)
- **Provenance:** Introduced by upstream commit `66fdd51f0d` (`docs: add RTL development skill (#40543)`).
- **File & Line:** `.opencode/skills/rtl-aware-development/SKILL.md:3`
- **Exact Text:**
  ```yaml
  ---
  name: rtl-aware-development
  description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
  ---
  ```
- **Analysis:**
  1. **Branding:** The skill description explicitly refers to `"OpenCode Desktop"` instead of Kilo or neutral phrasing.
  2. **Location Convention:** The file is placed under `.opencode/skills/`, which violates Kilo repository convention (project configs and skills belong in `.kilo/skills/` or `.kilocode/skills/`).
- **Recommended Action:**
  - Relocate the file to `.kilo/skills/rtl-aware-development/SKILL.md` (or omit if Kilo Desktop development does not use upstream-specific Electron skills).
  - Update the description to:
    `description: Kilo Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.`

---

### Finding 2 (Informational): Release Notes Changeset Mentions OpenCode Version Range
- **Severity:** Informational (Expected / Standard Convention)
- **Provenance:** Merge PR changeset creation.
- **File & Line:** `.changeset/opencode-v1-18-14-to-v1-18-15.md:6`
- **Exact Text:**
  ```markdown
  Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
  ```
- **Analysis:** This changeset follows the standard Kilo upstream merge convention (matching `.changeset/opencode-v1-18-1-to-v1-18-13.md` from the previous merge). It clearly communicates the provenance of upstream improvements in package release notes.
- **Recommended Action:** No change required.

---

## 4. Notable Non-Findings (Verified Clean Areas)

### 4.1 Package Manifests & Repository Metadata
- **`packages/http-recorder/package.json`**: An upstream sync commit (`76783409bf`) briefly brought in upstream repository URLs (`github.com/anomalyco/opencode`). Head commit `94fd41e3a2` properly reverted these to `github.com/Kilo-Org/kilocode`:
  ```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Kilo-Org/kilocode.git",
    "directory": "packages/http-recorder"
  },
  "homepage": "https://github.com/Kilo-Org/kilocode/tree/main/packages/http-recorder",
  "bugs": "https://github.com/Kilo-Org/kilocode/issues"
  ```
- **`packages/sdk-next/package.json`** & **`package.json`**: No user-facing OpenCode links or URLs added. Surrounding monorepo workspace dependencies (e.g., `@opencode-ai/client`, `@opencode-ai/ui`) remain internal workspace protocol packages.

### 4.2 34 New UI i18n Locales (`packages/ui/src/i18n/`)
Upstream commit `741244b69d` added 34 new locale dictionaries:
`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`.

- **Audit Result:** 0 mentions of `opencode` or `anomalyco` across all 34 files.
- **Branding Transformation:** All files correctly transformed `OpenCode Go` to `Kilo Go` (e.g., `packages/ui/src/i18n/el.ts`: `"Εγγραφείτε στο Kilo Μετάβαση..." // kilocode_change`).

### 4.3 CLI Commands & Help Snapshots (`packages/opencode/src/cli/cmd/web.ts`)
- The new `kilo web` command implementation in `packages/opencode/src/cli/cmd/web.ts` is fully branded:
  - Command description: `"start kilo server and open web interface"`
  - Password guard: `"KILO_SERVER_PASSWORD is not set; server is unsecured."`
  - Default mDNS domain: `kilo.local`
- Help snapshot tests in `packages/opencode/test/cli/help/__snapshots__/help-snapshots.test.ts.snap` verify output displays `kilo web` and `kilo.local`.
- Test suite `packages/opencode/test/kilocode/help.test.ts` passes the invariant assertion that CLI is branded `kilo`, not `opencode`.

### 4.4 TUI and Session UI Components
- `packages/tui/` and `packages/session-ui/` changes (cursor styling, live sync message timestamp ordering, compaction serialization, and part default-open state) contain no OpenCode branding or URLs.
- Internal service identifiers (e.g., `@opencode/SessionCompaction`, `@opencode/Truncate`) remain internal Effect service tags, matching existing architecture.

### 4.5 External URLs Audit
All URLs introduced or modified in the PR diff were audited:
- Technical specifications / references (MDN, CSS-Tricks, W3C, web.dev, Electron, Kobalte).
- Localhost / loopback test URLs (`http://localhost/page#section`, `http://remote:8080`).
- No `opencode.ai`, `anomalyco.com`, or `github.com/anomalyco/*` URLs exist in any user-facing or documentation changes.

---

## 5. Command Evidence & Outputs

### 5.1 Sweep for Added Mentions in Diff
```sh
$ git diff b6505b164bee1acf20d5c33dbc052e8a60c464c0..HEAD | rg -n -i '^\+[^+].*(opencode|anomalyco)'
```
**Output:**
```text
+Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
+- remove unrelated `packages/opencode/package.json` ordering/dependency drift;
+   - `packages/opencode/src/kilocode/config/overlay.ts`;
+   - a new Kilo-owned writer under `packages/opencode/src/kilocode/config/`;
+   - `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts`;
+   - `packages/opencode/src/kilocode/server/httpapi/handlers/config-console.ts`.
+8. Keep Kilo logic in `packages/opencode/src/kilocode/`. Shared upstream files get minimal marked delegation only when unavoidable.
+- `packages/opencode/test/kilocode/server/config-overlay.test.ts`;
+- `packages/opencode/test/kilocode/project-config-update.test.ts`.
+From `packages/opencode/`:
+bun run script/check-opencode-annotations.ts
+bun run script/check-opencode-promise-facades.ts
+bun run script/check-opencode-annotations.ts
+bun run script/check-opencode-promise-facades.ts
+  `packages/opencode` (shared upstream code, needs `kilocode_change` markers) or the
+description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
+    "dev": "bun run --cwd packages/opencode --conditions=browser src/index.ts",
+    "dev:local": "bun run packages/opencode/script/dev-local.ts",
+import { Flag } from "@opencode-ai/core/flag/flag"
```

### 5.2 Verification of Upstream URL Restoration in `packages/http-recorder/`
```sh
$ git log -p -1 94fd41e3a2 -- packages/http-recorder/package.json
```
**Output:**
```diff
--- a/packages/http-recorder/package.json
+++ b/packages/http-recorder/package.json
@@ -10,8 +10,8 @@
     "url": "git+https://github.com/Kilo-Org/kilocode.git",
     "directory": "packages/http-recorder"
   },
-  "homepage": "https://github.com/anomalyco/opencode/tree/dev/packages/http-recorder",
-  "bugs": "https://github.com/anomalyco/opencode/issues",
+  "homepage": "https://github.com/Kilo-Org/kilocode/tree/main/packages/http-recorder",
+  "bugs": "https://github.com/Kilo-Org/kilocode/issues",
```

### 5.3 Audit of 34 New Locale Files
```sh
$ rg -i 'opencode' packages/ui/src/i18n/
# (0 matches returned)
```

---

## 6. Limitations

- **Pre-existing vs. Merge-Introduced Scope:** This review focused strictly on deltas introduced in PR #13002 against base `origin/johnnyeric/kilo-opencode-v1.18.13`. Pre-existing strings in unrelated files (such as historical changelog entries from 2024/2025 or internal package directory paths) were audited for regression but remain unchanged as expected.
- **Dynamic Runtime Strings:** Evaluated via static analysis and test suite snapshots. Dynamic error strings from third-party model providers (e.g. OpenAI, Anthropic) pass through untouched.

---

## 7. Action Items / Recommendations

1. **Move and Rebrand `.opencode/skills/rtl-aware-development/SKILL.md`:**
   - Move to `.kilo/skills/rtl-aware-development/SKILL.md`.
   - Update frontmatter description from `OpenCode Desktop should be RTL-aware.` to `Kilo Desktop should be RTL-aware.` (or neutral phrasing).
