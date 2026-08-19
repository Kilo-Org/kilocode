# OpenCode Mentions and Branding Audit Report (Round 4): PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Range:** OpenCode `v1.18.14..v1.18.15`  
**Base Commit (Merge Base):** `d88a7faa555bae354cfd7ac180d8e557ea1997fd` (`origin/main`)  
**Initial Base Commit (Branch Ancestry):** `aca225fcfd2ad5146f142a5d582f62c1dff12c35` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed Branch Head (HEAD):** `860f5d9e680fb2a1b7c77913ba706419e44124b3` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Previous Audit (Round 3) Head:** `6d8876045d4cf06272cfb355f2b18c74cdf3e967`  
**Audit Date:** 2026-08-19  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Safe after 1 minor skill cleanup (P3)**.
- **Summary:** Round 4 evaluated the latest state of PR #13002 at head commit `860f5d9e68` after synchronization with `origin/main` (`c50f6be6af`) and application of merge invariant preservation fixes (`860f5d9e68`).
  - **Prior Finding 1 (Carried Forward - Open):** Upstream skill `.opencode/skills/rtl-aware-development/SKILL.md` remains placed in `.opencode/` and contains the unbranded description string `"OpenCode Desktop should be RTL-aware..."`.
  - **Prior Finding 2 (Resolved in Round 3, Re-verified Clean):** The model catalog endpoint in `packages/core/src/models-dev.ts` remains correctly configured as `Flag.KILO_MODELS_URL || "https://models.dev"` with `// kilocode_change` annotations; no requests are directed to `models.opencode.ai`.
  - **Zed Extension Clean (`packages/extensions/zed/extension.toml`):** Properly branded with `id = "kilo"`, `name = "Kilo"`, description `"The open source coding agent."`, pointing to `Kilo-Org/kilocode` repository and releases.
  - **Clean Locale Coverage:** All 34 new locale dictionaries in `packages/ui/src/i18n/*` (am, bg, bn, ca, cs, dv, dz, el, et, fa, fo, hr, hu, hy, is, ka, km, lo, lt, lv, mk, mn, ms, my, ne, ro, si, sk, sl, sq, sr, tg, tk, uz) contain zero leaked OpenCode strings and consistently brand `Kilo Go`.
  - **No Web Property Leaks:** Zero unapproved external OpenCode web properties, documentation URLs, or tracking endpoints are introduced.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated all 98 files modified, added, or deleted across the merge changeset between merge base `d88a7faa555bae354cfd7ac180d8e557ea1997fd` and PR head `860f5d9e680fb2a1b7c77913ba706419e44124b3`.

Focused inspection covered:
1. **User Interface Strings, Translations & UI Components:** `packages/session-ui/`, `packages/tui/`, all 34 new locale dictionaries in `packages/ui/src/i18n/*`, `packages/kilo-ui/src/i18n/fa.ts`, and `packages/kilo-vscode/webview-ui/src/context/language.tsx`.
2. **Skills & Guidance:** `.opencode/skills/rtl-aware-development/SKILL.md`, `packages/ui/AGENTS.md`.
3. **Editor & Extension Integrations:** `packages/extensions/zed/extension.toml`.
4. **Package Metadata & Manifests:** `package.json`, `packages/*/package.json`, `packages/http-recorder/package.json`, `packages/sdk-next/package.json`.
5. **Changesets & Release Notes:** `.changeset/opencode-v1-18-14-to-v1-18-15.md`.
6. **URLs & Remote Web Properties:** Verification that all external links point to official Kilo repositories (`github.com/Kilo-Org/kilocode`), `kilo.ai`, `models.dev`, or third-party web standards documentation (MDN, W3C, CSS-Tricks, etc.).

### 2.2 Methodology
- **Automated Case-Insensitive Sweeps:** Ran regex searches (`rg -i`) across the PR diff and individual modified files for `opencode`, `anomalyco`, `opencode.ai`, and `anomaly.co`.
- **URL Auditing & Categorization:** Extracted and categorized all HTTP/HTTPS URLs across the full PR changeset.
- **Locale Dictionary Inspection:** Iteratively validated each of the 34 new i18n dictionaries in `packages/ui/src/i18n/` for naming and copy integrity.
- **Prior Findings Reconciliation:** Verified the exact status of Finding 1, Finding 2, and Finding 3 from Rounds 1–3.

---

## 3. Status of Previous Findings

| Finding ID | Description | Severity | Status (Round 3) | Status (Round 4) | Notes |
|---|---|---|---|---|---|
| **Finding 1** | Unbranded skill `.opencode/skills/rtl-aware-development/SKILL.md` under `.opencode/` | P3 | Unresolved | **Unresolved (Carried Forward)** | Description contains `"OpenCode Desktop"`; file located in `.opencode/skills/` |
| **Finding 2** | Model catalog fallback changed to `models.opencode.ai` in `packages/core/src/models-dev.ts` | P2 | Resolved (`c24adedfa1`) | **VERIFIED CLEAN** | Maintained at `https://models.dev` with `// kilocode_change` |
| **Finding 3** | Changeset `.changeset/opencode-v1-18-14-to-v1-18-15.md` mentions OpenCode version | Info | Verified Clean | **VERIFIED CLEAN** | Standard release note provenance convention |

---

## 4. Findings in Round 4

### Finding 1: Unbranded Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md` (Unresolved from Rounds 1–3)
- **Severity:** P3 (Low / Skill & Directory Hygiene)
- **Status:** Unresolved from Rounds 1, 2 & 3
- **File & Line:** `.opencode/skills/rtl-aware-development/SKILL.md:3`
- **Exact Text:**
  ```yaml
  ---
  name: rtl-aware-development
  description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
  ---
  ```
- **Analysis:**
  1. **Branding:** The frontmatter description contains `"OpenCode Desktop"`, which can be exposed to LLM agents and users during skill discovery.
  2. **Path Hygiene:** The file resides in `.opencode/skills/` instead of Kilo's `.kilo/skills/` or `.kilocode/skills/` paths. (Note: per project policy, Kilo CLI skips upstream's standalone desktop app, but shared UI components remain relevant).
- **Recommended Action:**
  - Move the file to `.kilo/skills/rtl-aware-development/SKILL.md`.
  - Update description to:
    ```yaml
    description: Kilo Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
    ```
    (or adopt neutral wording: `"UI components should be RTL-aware..."`).

---

### Finding 2 (Informational): Release Notes Changeset Mentions OpenCode Version Range
- **Severity:** Informational (Expected / Standard Convention)
- **Status:** Verified Clean
- **File & Line:** `.changeset/opencode-v1-18-14-to-v1-18-15.md:6`
- **Exact Text:**
  ```markdown
  Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
  ```
- **Analysis:** Describes the upstream merge provenance clearly in the changeset description. Adheres to standard Kilo changeset conventions. No changes needed.

---

## 5. Notable Non-Findings (Verified Clean Areas)

### 5.1 Zed Extension Manifest (`packages/extensions/zed/extension.toml`)
Verified that `packages/extensions/zed/extension.toml` at commit `860f5d9e68` is cleanly branded:
- `id = "kilo"`
- `name = "Kilo"`
- `description = "The open source coding agent."`
- `repository = "https://github.com/Kilo-Org/kilocode"`
- `archive` URLs point to `https://github.com/Kilo-Org/kilocode/releases/download/v7.4.22/...`
- Zero unbranded OpenCode strings or external Anomaly download endpoints exist.

### 5.2 Model Catalog Source Restored to `models.dev` (`packages/core/src/models-dev.ts`)
The model catalog source in `packages/core/src/models-dev.ts` is verified clean:
```ts
const source = Flag.KILO_MODELS_URL || "https://models.dev" // kilocode_change
const filepath = path.join(
  Global.Path.cache,
  source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`, // kilocode_change
)
```
Default runs will fetch model definitions from `https://models.dev`, not `https://models.opencode.ai`.

### 5.3 All 34 UI i18n Locales (`packages/ui/src/i18n/`)
All 34 newly added locale dictionaries were audited:
- **Locales Audited:** `am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`.
- **Branding Audit:** All 34 dictionaries contain **0 leaked OpenCode strings**.
- **Tier Upsell Branding:** All 34 files correctly refer to `Kilo Go` (e.g. `dialog.usageExceeded.freeTier.description` contains `"Kilo Go"` / localized equivalent with `// kilocode_change`).
- Persian (`fa`) localization wiring is fully linked across `packages/ui/src/i18n/fa.ts`, `packages/kilo-ui/src/i18n/fa.ts`, and `packages/kilo-vscode/webview-ui/src/context/language.tsx`.

### 5.4 Package Metadata & Repository Manifests
- **`packages/http-recorder/package.json`:** `repository`, `bugs`, and `homepage` URLs correctly point to `https://github.com/Kilo-Org/kilocode`.
- **`packages/sdk-next/package.json` & root `package.json`:** No user-facing OpenCode links. Monorepo workspace references (`@opencode-ai/*`) remain internal workspace protocol packages.

### 5.5 TUI and Session UI Components
- **`packages/tui/src/config/index.tsx` & `Prompt`:** Cursor styling options (`block`, `underline`, `line`, `default`) cleanly integrated.
- **`packages/tui/src/context/sync.tsx`:** Message comparator ordering logic contains zero leaked branding.
- **`packages/session-ui/src/components/part-default-open.ts`:** Collapses deletion-only edit parts cleanly with zero branding leaks.

### 5.6 Server Proxy Logging & Workspace Routing
- **`packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts`:** Correctly buffers upstream 5xx responses with 64 KiB cap and logs locally without leaking external endpoints.
- **`packages/opencode/src/server/shared/workspace-routing.ts`:** Strips host `directory` param safely.

---

## 6. Command Evidence & Outputs

### 6.1 Added Mentions in Merge Changeset
```sh
$ git diff d88a7faa55..860f5d9e68 | rg '^\+[^+].*(opencode|anomalyco|opencode\.ai|anomaly\.co)' -n -i
```
**Output:**
```text
12:+Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
28:+description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
128:+export * from "@opencode-ai/ui/i18n/fa"
1688:+      exec(root, ["checkout", "-B", "merge-author/opencode-v1.18.15"])
1689:+      writeFileSync(path.join(root, "packages/opencode/src/shared.ts"), "export const value = 2\n")
1697:+        "Merge branch 'merge-author/opencode-v1.18.15' into merge-target",
1698:+        "merge-author/opencode-v1.18.15",
1709:+  test("does not exempt ordinary reconciliation on a kilo-opencode branch", () => {
1713:+      writeFileSync(path.join(root, "packages/opencode/src/shared.ts"), "export const value = 2\n")
1721:+        "Merge remote-tracking branch 'origin/main' into merge-author/kilo-opencode-v1.18.15",
1727:+      expect(out.stderr).toContain("packages/opencode/src/shared.ts:1")
9725:+      s.startsWith("merge: opencode ") ||
9728:+      /^merge (?:remote-tracking )?branch '(?:[^/']+\/)*opencode-v\d/.test(s)
9741:+bun run merge.ts --version v1.1.50 --base-branch username/kilo-opencode-v1.1.44
9750:+# Create PR: username/kilo-opencode-v1.1.44 -> main
9754:+bun run merge.ts --version v1.1.50 --base-branch username/kilo-opencode-v1.1.44
9758:+# Create PR: username/kilo-opencode-v1.1.50 -> username/kilo-opencode-v1.1.44
9759:+# OR: username/kilo-opencode-v1.1.50 -> main (once first PR is merged)
9768:+bun run analyze.ts --version v1.1.50 --base-branch username/kilo-opencode-v1.1.44
9772:+bun run merge.ts --version v1.1.50 --base-branch username/kilo-opencode-v1.1.44
9776:+# 3. Create PR from username/kilo-opencode-v1.1.50
9777:+#    - Target: username/kilo-opencode-v1.1.44 (if first PR not merged yet)
9790:+ *   bun run script/upstream/analyze.ts --version v1.1.49 --base-branch username/kilo-opencode-v1.1.44
9802:+      dev: "KILO_CLIENT=cli bun run --cwd packages/opencode --conditions=node src/index.ts",
9812:+      dev: "bun run --cwd packages/opencode --conditions=browser src/index.ts",
9813:+      postinstall: "bun run --cwd packages/opencode fix-node-pty",
```

### 6.2 URL Audit Across PR Changeset
```sh
$ git diff d88a7faa55..860f5d9e68 | rg -n 'https?://'
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
1192:+    const url = new URL("http://localhost/session/abc?directory=F%3A%5Cproj&keep=yes")
1193:+    const result = workspaceProxyURL("http://remote:8080/base", url)
1199:     const url = new URL("http://localhost/page#section")
1200:     const result = workspaceProxyURL("http://remote:8080", url)
```

### 6.3 34 New Locale Dictionaries Search
```sh
$ for loc in am bg bn ca cs dv dz el et fa fo hr hu hy is ka km lo lt lv mk mn ms my ne ro si sk sl sq sr tg tk uz; do
    git show "860f5d9e68:packages/ui/src/i18n/${loc}.ts" | rg -i 'opencode'
  done
# (0 matches returned across all 34 locales)
```

### 6.4 Zed Extension Manifest Content
```sh
$ git show 860f5d9e68:packages/extensions/zed/extension.toml
```
**Output:**
```toml
id = "kilo"
name = "Kilo"
description = "The open source coding agent."
version = "7.4.22"
schema_version = 1
authors = ["Anomaly"]
repository = "https://github.com/Kilo-Org/kilocode"

[agent_servers.opencode]
name = "Kilo"
icon = "./icons/opencode.svg"

[agent_servers.opencode.targets.darwin-aarch64]
archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.4.22/opencode-darwin-arm64.zip"
cmd = "./opencode"
args = ["acp"]

[agent_servers.opencode.targets.darwin-x86_64]
archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.4.22/opencode-darwin-x64.zip"
cmd = "./opencode"
args = ["acp"]

[agent_servers.opencode.targets.linux-aarch64]
archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.4.22/opencode-linux-arm64.tar.gz"
cmd = "./opencode"
args = ["acp"]

[agent_servers.opencode.targets.linux-x86_64]
archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.4.22/opencode-linux-x64.tar.gz"
cmd = "./opencode"
args = ["acp"]

[agent_servers.opencode.targets.windows-x86_64]
archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.4.22/opencode-windows-x64.zip"
cmd = "./opencode.exe"
args = ["acp"]
```

---

## 7. Limitations

- **Scope Boundary:** This audit is strictly scoped to the diff between base `d88a7faa555bae354cfd7ac180d8e557ea1997fd` and PR head `860f5d9e680fb2a1b7c77913ba706419e44124b3`. Pre-existing internal workspace package identifiers (`@opencode-ai/*`), internal Effect context tags (`@opencode/*`), and historical docs in untouched files are intentional parts of the monorepo fork architecture.
- **Dynamic Model Output:** Provider outputs returned at runtime over external model APIs are generated dynamically and not evaluated by static source analysis.

---

## 8. Action Items & Recommendations

1. **Relocate and Rebrand `.opencode/skills/rtl-aware-development/SKILL.md` (P3):**
   - Move to `.kilo/skills/rtl-aware-development/SKILL.md`.
   - Update frontmatter description from `OpenCode Desktop should be RTL-aware.` to `Kilo Desktop should be RTL-aware.` (or neutral phrasing).
