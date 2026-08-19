# OpenCode Mentions and Branding Audit Report (Round 3): PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Range:** OpenCode `v1.18.14..v1.18.15`  
**Base Commit:** `aca225fcfd2ad5146f142a5d582f62c1dff12c35` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed Branch Head (HEAD):** `6d8876045d4cf06272cfb355f2b18c74cdf3e967` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Main Branch:** `95ad1705f5e357e7cd6f0cfbdaf17a8c55e01093` (`origin/main`)  
**Previous Audit (Round 2) Head:** `db7c9eb7ebe652b897c3ca5e8e76b06d25175024`  
**Audit Date:** 2026-08-10  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Safe after 1 minor skill cleanup (P3)**.
- **Summary:** Round 3 reviewed the full diff between base `origin/johnnyeric/kilo-opencode-v1.18.13` (`aca225fcfd`) and PR head `origin/johnnyeric/kilo-opencode-v1.18.15` (`6d8876045d`), following the synchronization with the base branch and the application of merge review fixes (`c24adedfa1` and `6d8876045d`).
  - **Round 2 Finding 2 Fully Resolved:** The model catalog source in `packages/core/src/models-dev.ts` was restored to `Flag.KILO_MODELS_URL || "https://models.dev"` along with its `// kilocode_change` annotations in commit `c24adedfa1`, successfully removing the upstream `https://models.opencode.ai` fallback.
  - **Round 1 / Round 2 Finding 1 Remains Open:** Upstream skill `.opencode/skills/rtl-aware-development/SKILL.md` is still located under `.opencode/` and contains the unbranded description string `"OpenCode Desktop should be RTL-aware..."`.
  - **Clean CLI & UI State:** The unsupported `kilo web` CLI command has been cleanly removed from the branch. All 34 newly added i18n locale files in `packages/ui/src/i18n/` and Persian localization wiring in `packages/kilo-ui/` and `packages/kilo-vscode/` are fully branded with zero leaked OpenCode strings.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated all 97 modified, added, or deleted files across the PR diff between base `aca225fcfd2ad5146f142a5d582f62c1dff12c35` and PR head `6d8876045d4cf06272cfb355f2b18c74cdf3e967`.

Focus areas:
1. **User Interface Strings & Translations:** `packages/session-ui/`, `packages/tui/`, `packages/ui/src/i18n/*` (all 34 new locale files), `packages/kilo-ui/src/i18n/fa.ts`, and `packages/kilo-vscode/webview-ui/src/context/language.tsx`.
2. **Docs & Skills:** `.opencode/skills/rtl-aware-development/SKILL.md`, `AGENTS.md`, and `packages/ui/AGENTS.md`.
3. **Help Text & Dialog Prompts:** `packages/tui/src/ui/dialog-prompt.tsx`, `dialog-export-options.tsx`, `dialog-select.tsx`, `permission.tsx`, and `question.tsx`.
4. **Package Metadata & URLs:** `package.json`, `packages/*/package.json`, `packages/sdk-next/package.json`, `packages/http-recorder/package.json`, and repository links.
5. **Model Catalog Endpoints & Error Handling:** `packages/core/src/models-dev.ts`, `packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts`, `packages/opencode/src/session/retry.ts`, and `packages/opencode/src/acp/event.ts`.

### 2.2 Methodology
- **Automated Case-Insensitive Regex Sweeps:** Scanned the complete PR diff for `opencode`, `anomalyco`, `opencode.ai`, and `anomaly.co`.
- **URL Extraction & Categorization:** Inspected all new/modified HTTP/HTTPS URLs across the changeset.
- **Round 1 & Round 2 Verification:** Confirmed the status of prior findings across commits `c24adedfa1` and `6d8876045d`.
- **Cross-Layer Translation Audit:** Audited all 34 new locale dictionaries and Persian (`fa`) localization wiring.

---

## 3. Status of Previous Findings

| Finding ID | Description | Severity | Prior Status (Round 2) | Current Status (Round 3) |
|---|---|---|---|---|
| **Finding 1** | Unbranded skill `.opencode/skills/rtl-aware-development/SKILL.md` under `.opencode/` | P3 | Unresolved | **Unresolved (Carried Forward)** |
| **Finding 2** | Model catalog fallback changed to `models.opencode.ai` in `packages/core/src/models-dev.ts` | P2 | New | **RESOLVED in `c24adedfa1`** (`https://models.dev` restored) |
| **Finding 3** | Changeset `.changeset/opencode-v1-18-14-to-v1-18-15.md` mentions OpenCode version | Info | Verified Clean | **Verified Clean (Expected Convention)** |

---

## 4. Findings in Round 3

### Finding 1: Unbranded Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md` (Unresolved from Rounds 1 & 2)
- **Severity:** P3 (Low / Skill & Directory Hygiene)
- **Status:** Unresolved from Round 1 & Round 2
- **File & Line:** `.opencode/skills/rtl-aware-development/SKILL.md:3`
- **Exact Text:**
  ```yaml
  ---
  name: rtl-aware-development
  description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
  ---
  ```
- **Analysis:**
  1. **Branding:** Uses `"OpenCode Desktop"` in the skill description frontmatter, which is exposed to agents and users.
  2. **Location Convention:** Resides under `.opencode/skills/` instead of Kilo's standard `.kilo/skills/` or `.kilocode/skills/` directory structure.
- **Recommended Action:**
  - Move the file to `.kilo/skills/rtl-aware-development/SKILL.md` (or remove if upstream Desktop development skills are excluded per fork desktop app policy).
  - Update description to:
    `description: Kilo Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.`

---

### Finding 2 (Informational): Release Notes Changeset Mentions OpenCode Version Range
- **Severity:** Informational (Expected / Standard Convention)
- **Status:** Verified Clean
- **File & Line:** `.changeset/opencode-v1-18-14-to-v1-18-15.md:6`
- **Exact Text:**
  ```markdown
  Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
  ```
- **Analysis:** Follows standard Kilo changeset conventions for communicating upstream merge provenance in release notes. No change required.

---

## 5. Notable Non-Findings (Verified Clean Areas)

### 5.1 Model Catalog Source Restored to `models.dev` (`packages/core/src/models-dev.ts`)
In fix commit `c24adedfa1`, the model catalog URL was restored to `https://models.dev` and annotated with `// kilocode_change`:
```ts
const source = Flag.KILO_MODELS_URL || "https://models.dev" // kilocode_change
const filepath = path.join(
  Global.Path.cache,
  source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`, // kilocode_change
)
```
No requests to `models.opencode.ai` are made in default or unset environment configurations.

### 5.2 Persian (`fa`) Localization Wiring
- **`packages/kilo-ui/src/i18n/fa.ts`:** Cleanly re-exports `@opencode-ai/ui/i18n/fa`.
- **`packages/ui/src/i18n/fa.ts`:** All UI copy properly branded (`"در Kilo Go مشترک شوید." // kilocode_change`).
- **`packages/kilo-vscode/webview-ui/src/context/language.tsx`:** Correctly imports `uiFa` and composes `dicts.fa` (`fa: { ...base, ...appFa, ...uiFa, ...amEn, ...amFa }`).

### 5.3 34 UI i18n Locales (`packages/ui/src/i18n/`)
All 34 newly added locale files (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`) contain **0 leaked OpenCode strings** and correctly use `Kilo Go`.

### 5.4 Removal of Unsupported `kilo web` CLI Command
The upstream web command (`packages/opencode/src/cli/cmd/web.ts`) has been cleanly removed from the PR branch (`6d8876045d`), preventing any unvetted web serving commands from being registered in the CLI.

### 5.5 Package Manifests & Repository Metadata
- **`packages/http-recorder/package.json`:** Verified that repository, homepage, and bugs URLs point to `Kilo-Org/kilocode`.
- **`packages/sdk-next/package.json` & root `package.json`:** No user-facing OpenCode links. Internal monorepo workspace references (`@opencode-ai/*`) remain workspace protocol packages.

### 5.6 TUI and Session UI Components
- **`packages/tui/src/config/index.tsx` & `Prompt`:** Cursor shape configuration (`block`, `underline`, `line`, `default`) cleanly integrated with vim guard annotations (`// kilocode_change`).
- **`packages/tui/src/context/sync.tsx`:** Message comparator uses numerical ID tie-break with zero OpenCode exposure.
- **`packages/session-ui/src/components/part-default-open.ts`:** Collapses deletion-only edit parts cleanly with zero OpenCode branding.

### 5.7 Server Proxy Logging & Workspace Routing
- **`packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts`:** Buffers upstream 5xx responses with a 64 KiB cap and logs locally via `Effect.logError("workspace proxy upstream error", ...)` without leaking external URLs.
- **`packages/opencode/src/server/shared/workspace-routing.ts`:** Strips the host `directory` param from proxied URLs so remote sandboxes resolve their own root directory cleanly.

---

## 6. Command Evidence & Outputs

### 6.1 Sweep for Added OpenCode / Anomalyco Mentions in Diff
```sh
$ git diff aca225fcfd2ad5146f142a5d582f62c1dff12c35..6d8876045d4cf06272cfb355f2b18c74cdf3e967 | rg -n -i '^\+[^+].*(opencode|anomalyco)'
```
**Output:**
```text
12:+Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
28:+description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
111:+    "dev": "bun run --cwd packages/opencode --conditions=browser src/index.ts",
125:+    "dev:local": "bun run packages/opencode/script/dev-local.ts",
152:+export * from "@opencode-ai/ui/i18n/fa"
9626:+      s.startsWith("merge: opencode ") ||
9629:+      s.startsWith("merge branch 'johnnyeric/opencode") ||
9630:+      (s.includes("merge") && s.includes("opencode"))
```

### 6.2 URL Extraction Across PR Changeset
```sh
$ git diff aca225fcfd2ad5146f142a5d582f62c1dff12c35..6d8876045d4cf06272cfb355f2b18c74cdf3e967 | rg -n 'https?://'
```
**Output:**
```text
77:+- [RTL Styling 101, Ahmad Shadeed](https://rtlstyling.com/posts/rtl-styling/)
78:+- [CSS-Tricks: RTL Styling 101](https://css-tricks.com/rtl-styling-101/)
79:+- [CSS-Tricks: CSS Logical Properties and Values](https://css-tricks.com/css-logical-properties-and-values/)
80:+- [W3C: Structural markup and right-to-left text](https://www.w3.org/International/questions/qa-html-dir)
81:+- [W3C: Inline bidirectional markup](https://www.w3.org/International/articles/inline-bidi-markup/)
82:+- [MDN: CSS logical properties and values](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Logical_properties_and_values)
83:+- [MDN: `dir`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/dir)
84:+- [MDN: `scrollLeft`](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollLeft)
85:+- [web.dev: Logical properties](https://web.dev/learn/css/logical-properties/)
86:+- [Electron: Custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
87:+- [WAI-ARIA: Window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
88:+- [Kobalte: I18n Provider](https://kobalte.dev/docs/core/components/i18n-provider/)
1277:+    const url = new URL("http://localhost/session/abc?directory=F%3A%5Cproj&keep=yes")
1278:+    const result = workspaceProxyURL("http://remote:8080/base", url)
1284:     const url = new URL("http://localhost/page#section")
1285:     const result = workspaceProxyURL("http://remote:8080", url)
```

### 6.3 Verification of Model Catalog URL in `packages/core/src/models-dev.ts`
```sh
$ git show 6d8876045d4cf06272cfb355f2b18c74cdf3e967:packages/core/src/models-dev.ts | rg -n -C 2 'MODELS_URL'
```
**Output:**
```text
167-    )
168-
169:    const source = Flag.KILO_MODELS_URL || "https://models.dev" // kilocode_change
170-    const filepath = path.join(
171-      Global.Path.cache,
```

### 6.4 Verification of 34 New Locale Files
```sh
$ rg -i 'opencode' packages/ui/src/i18n/
# (0 matches returned)
```

---

## 7. Limitations

- **Scope Boundary:** This review was scoped strictly to changes introduced between base `aca225fcfd2ad5146f142a5d582f62c1dff12c35` and PR head `6d8876045d4cf06272cfb355f2b18c74cdf3e967`. Pre-existing upstream package imports (`@opencode-ai/*`), internal Effect service tags (`@opencode/*`), and historical docs in untouched files remain part of the fork architecture.
- **Dynamic Runtime Strings:** Runtime responses from external model providers (Anthropic, OpenAI, etc.) pass through dynamically and are not subject to static analysis.

---

## 8. Action Items & Recommendations

1. **Relocate and Rebrand `.opencode/skills/rtl-aware-development/SKILL.md`:**
   - Move to `.kilo/skills/rtl-aware-development/SKILL.md`.
   - Update frontmatter description from `OpenCode Desktop should be RTL-aware.` to `Kilo Desktop should be RTL-aware.` (or neutral wording).
