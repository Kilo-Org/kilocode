# OpenCode Mentions and Branding Audit Report (Round 2): PR #13002

**PR:** [https://github.com/Kilo-Org/kilocode/pull/13002](https://github.com/Kilo-Org/kilocode/pull/13002)  
**Merge Range:** OpenCode `v1.18.14..v1.18.15`  
**Base Commit:** `4bb1c2a45b977e64c1b208c3f317de58c8e1dcbb` (`origin/johnnyeric/kilo-opencode-v1.18.13`)  
**Reviewed Branch Head (HEAD):** `db7c9eb7ebe652b897c3ca5e8e76b06d25175024` (`origin/johnnyeric/kilo-opencode-v1.18.15`)  
**Main Branch:** `4f59fcb666e9d4206ca7839cc9d9c3ee99a81885` (`origin/main`)  
**Previous Audit (Round 1) Head:** `94fd41e3a2892ad667c890c2d995813aa706bdd0`  
**Audit Date:** 2026-08-07  

---

## 1. Executive Summary & Verdict

- **Verdict:** **Needs minor resolution before merge (2 items)**.
- **Summary:** Round 2 re-evaluated all changes in PR #13002, including the 8 fixup commits (`3a10be340d..db7c9eb7eb`) introduced since Round 1.
  - **Newly Verified Clean Fixes:** Fixup commits correctly added and wired Persian localization (`packages/kilo-ui/src/i18n/fa.ts` and `packages/kilo-vscode/webview-ui/src/context/language.tsx`), bounded ACP event waiting, bounded workspace proxy 5xx error body buffering to 64 KiB, and maintained clean Kilo branding across all TUI and Session UI components.
  - **Finding 1 (Carried from Round 1 - Unresolved):** Upstream skill file `.opencode/skills/rtl-aware-development/SKILL.md` remains in the `.opencode/` directory and retains unbranded description text (`"OpenCode Desktop should be RTL-aware..."`).
  - **Finding 2 (New in Round 2):** Upstream commit changed the default model catalog URL in `packages/core/src/models-dev.ts` from `https://models.dev` to `https://models.opencode.ai`, overwriting Kilo's previous `// kilocode_change` annotation.

---

## 2. Scope & Methodology

### 2.1 Scope of Review
The review evaluated the complete diff between base `origin/johnnyeric/kilo-opencode-v1.18.13` (`4bb1c2a45b`) and PR head `origin/johnnyeric/kilo-opencode-v1.18.15` (`db7c9eb7eb`), with targeted analysis of changes added since Round 1 (`94fd41e3a2..db7c9eb7eb`).

Specific focus areas:
1. **UI Strings & Internationalization:** `packages/kilo-ui/src/i18n/fa.ts`, `packages/kilo-vscode/webview-ui/src/context/language.tsx`, `packages/ui/src/i18n/*` (all 34 new locale files including `fa.ts`), `packages/session-ui`, and `packages/tui`.
2. **Docs & Skills:** `.opencode/skills/rtl-aware-development/SKILL.md`, `packages/kilo-docs/`, `packages/ui/AGENTS.md`, and `packages/kilo-vscode/AGENTS.md`.
3. **CLI Commands, Help Text & Snapshots:** `packages/opencode/src/cli/cmd/web.ts`, `packages/opencode/test/cli/help/__snapshots__/help-snapshots.test.ts.snap`.
4. **Package Metadata & URLs:** `package.json`, `packages/*/package.json`, `packages/sdk-next/package.json`, `packages/http-recorder/package.json`, and all external URLs introduced in the diff.
5. **Core Model Endpoints & Error Handling:** `packages/core/src/models-dev.ts`, `packages/opencode/src/server/routes/instance/httpapi/middleware/proxy.ts`, and `packages/opencode/src/session/retry.ts`.

### 2.2 Methodology
- **Full Diff Sweeps:** Searched added lines in the full PR diff for `opencode`, `anomalyco`, `opencode.ai`, and `anomaly.co`.
- **URL Extraction & Validation:** Inspected all new/modified HTTP/HTTPS URLs across the changeset.
- **Round 1 Reconciliation:** Verified the status of Round 1 findings and re-checked files modified in subsequent fixup commits.
- **Cross-Layer Translation Audit:** Audited Persian (`fa`) localization wiring across `packages/ui`, `packages/kilo-ui`, and `packages/kilo-vscode/webview-ui`.

---

## 3. Findings

### Finding 1: Unbranded Upstream Skill `.opencode/skills/rtl-aware-development/SKILL.md` (Unresolved from Round 1)
- **Severity:** P3 (Low / Skill & Directory Hygiene)
- **Status:** Unresolved from Round 1
- **File & Line:** `.opencode/skills/rtl-aware-development/SKILL.md:3`
- **Exact Text:**
  ```yaml
  ---
  name: rtl-aware-development
  description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
  ---
  ```
- **Analysis:**
  1. **Branding:** Uses `"OpenCode Desktop"` instead of Kilo or neutral phrasing.
  2. **Location Convention:** Located in `.opencode/skills/`, whereas Kilo repo convention requires skills to reside in `.kilo/skills/` or `.kilocode/skills/`.
- **Recommended Action:**
  - Move the file to `.kilo/skills/rtl-aware-development/SKILL.md`.
  - Update description to:
    `description: Kilo Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.`

---

### Finding 2: OpenCode Web Property `models.opencode.ai` in `packages/core/src/models-dev.ts`
- **Severity:** P2 (Medium / External Web Property & Marker Drift)
- **Status:** New in Round 2
- **File & Line:** `packages/core/src/models-dev.ts:169, 173`
- **Context & Diff:**
  ```diff
  --- a/packages/core/src/models-dev.ts
  +++ b/packages/core/src/models-dev.ts
  @@ -166,10 +166,10 @@ const layer = Layer.effect(
         ),
       )
   
  -    const source = Flag.KILO_MODELS_URL || "https://models.dev" // kilocode_change
  +    const source = Flag.KILO_MODELS_URL || "https://models.opencode.ai"
       const filepath = path.join(
         Global.Path.cache,
  -      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`, // kilocode_change
  +      source === "https://models.opencode.ai" ? "models.json" : `models-${Hash.fast(source)}.json`,
       )
       const ttl = Duration.minutes(5)
  ```
- **Analysis:**
  1. **Upstream Origin:** In upstream commit `a4f25a94b4` (`fix: use OpenCode model catalog URL (#39672)`), upstream changed the default catalog source from `https://models.dev` to `https://models.opencode.ai`.
  2. **Merge Collision:** During upstream merge commit `ed7c69dbf1`, the environment flag was adapted (`Flag.OPENCODE_MODELS_URL` -> `Flag.KILO_MODELS_URL`), but the fallback URL was accepted as `https://models.opencode.ai` and the `// kilocode_change` comments were dropped.
  3. **Branding & Network Impact:** By default, Kilo runtimes without `KILO_MODELS_URL` will connect to `https://models.opencode.ai` (an OpenCode-hosted web property).
- **Recommended Action (Human Verification / Decision):**
  - If Kilo intentionally uses `https://models.dev`, revert lines 169 and 173 to `"https://models.dev"` and restore `// kilocode_change` comments.
  - If connecting to `https://models.opencode.ai` is intentional for upstream model catalog compatibility, annotate the line with `// kilocode_change` to preserve intentional divergence.

---

### Finding 3 (Informational): Release Notes Changeset Mentions OpenCode Version Range
- **Severity:** Informational (Expected / Standard Merge Practice)
- **Status:** Verified Clean
- **File & Line:** `.changeset/opencode-v1-18-14-to-v1-18-15.md:6`
- **Exact Text:**
  ```markdown
  Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
  ```
- **Analysis:** Standard Kilo changeset convention for documenting upstream merge changesets. No change required.

---

## 4. Notable Non-Findings (Verified Clean Areas)

### 4.1 Persian (`fa`) Localization Wiring
- **`packages/kilo-ui/src/i18n/fa.ts`:** Newly added in commit `421208c648`; cleanly exports `@opencode-ai/ui/i18n/fa`.
- **`packages/ui/src/i18n/fa.ts`:** All UI copy properly branded (`"در Kilo Go مشترک شوید." // kilocode_change`).
- **`packages/kilo-vscode/webview-ui/src/context/language.tsx`:** Cleanly imports `uiFa` and includes it in `dicts.fa`.

### 4.2 All 34 New UI i18n Locales (`packages/ui/src/i18n/`)
- All 34 locale dictionaries (`am.ts`, `bg.ts`, `bn.ts`, `ca.ts`, `cs.ts`, `dv.ts`, `dz.ts`, `el.ts`, `et.ts`, `fa.ts`, `fo.ts`, `hr.ts`, `hu.ts`, `hy.ts`, `is.ts`, `ka.ts`, `km.ts`, `lo.ts`, `lt.ts`, `lv.ts`, `mk.ts`, `mn.ts`, `ms.ts`, `my.ts`, `ne.ts`, `ro.ts`, `si.ts`, `sk.ts`, `sl.ts`, `sq.ts`, `sr.ts`, `tg.ts`, `tk.ts`, `uz.ts`) contain **0 leaked OpenCode strings**.
- Every locale file uses `Kilo Go` (e.g. `el.ts`, `fa.ts`, `zh.ts`).

### 4.3 Package Manifests & Repository Metadata
- **`packages/http-recorder/package.json`:** Verified that commit `80daf50f7a` restored Kilo repository URLs (`Kilo-Org/kilocode`), bugs URL, and homepage.
- **`packages/sdk-next/package.json` & `package.json`:** No user-facing OpenCode links. Monorepo `@opencode-ai/*` workspace packages remain internal protocol references.

### 4.4 CLI Commands & Help Snapshots
- `packages/opencode/src/cli/cmd/web.ts` is fully branded:
  - Description: `"start kilo server and open web interface"`
  - Password guard: `"KILO_SERVER_PASSWORD is not set; server is unsecured."`
  - Default mDNS: `kilo.local`
- Snapshot test in `packages/opencode/test/cli/help/__snapshots__/help-snapshots.test.ts.snap` passes with `kilo web` and `kilo.local`.

### 4.5 TUI & Session UI Changes
- `packages/tui/src/config/index.tsx` & `Prompt`: Terminal cursor styling (`block`, `underline`, `line`, `default`) cleanly integrated with vim guard.
- `packages/tui/src/context/sync.tsx`: Message comparator uses numerical ID tie-break with zero OpenCode exposure.
- `packages/session-ui/src/components/part-default-open.ts`: Collapses deletion-only edits cleanly with zero OpenCode branding.

### 4.6 External URLs Audit
All URLs introduced or modified in the PR diff were audited:
- Technical documentation/specs: MDN, CSS-Tricks, W3C, web.dev, Electron, Kobalte, rtlstyling.com.
- No unexpected `anomalyco` or unvetted external domains introduced.

---

## 5. Command Evidence & Outputs

### 5.1 Sweep for Added Mentions in Diff
```sh
$ git diff 4bb1c2a45b..db7c9eb7eb | rg -n -i '^\+[^+].*(opencode|anomalyco)'
```
**Output:**
```text
154:+Adopt OpenCode v1.18.1 through v1.18.13 improvements, including model compatibility, MCP reliability, and TUI enhancements.
166:+Adopt OpenCode v1.18.14 through v1.18.15 improvements, including message ordering fixes, compaction serialization, locale coverage, and TUI enhancements.
297:+- remove unrelated `packages/opencode/package.json` ordering/dependency drift;
412:+   - `packages/opencode/src/kilocode/config/overlay.ts`;
413:+   - a new Kilo-owned writer under `packages/opencode/src/kilocode/config/`;
414:+   - `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts`;
415:+   - `packages/opencode/src/kilocode/server/httpapi/handlers/config-console.ts`.
428:+8. Keep Kilo logic in `packages/opencode/src/kilocode/`. Shared upstream files get minimal marked delegation only when unavoidable.
435:+- `packages/opencode/test/kilocode/server/config-overlay.test.ts`;
436:+- `packages/opencode/test/kilocode/project-config-update.test.ts`.
451:+From `packages/opencode/`:
463:+bun run script/check-opencode-annotations.ts
464:+bun run script/check-opencode-promise-facades.ts
668:+bun run script/check-opencode-annotations.ts
669:+bun run script/check-opencode-promise-facades.ts
778:+  `packages/opencode` (shared upstream code, needs `kilocode_change` markers) or the
931:+description: OpenCode Desktop should be RTL-aware. Use when implementing or reviewing RTL/LTR behavior in the web app, desktop app, CSS, menus, scrolling, resizing, icons, mixed-direction text, or Electron title bars.
4169:+    const source = Flag.KILO_MODELS_URL || "https://models.opencode.ai"
4173:+      source === "https://models.opencode.ai" ? "models.json" : `models-${Hash.fast(source)}.json`,
5186:+export * from "@opencode-ai/ui/i18n/fa"
5749:+  log("Installing dependencies in opencode package...")
13074:+import { Flag } from "@opencode-ai/core/flag/flag"
25729:+      s.startsWith("merge: opencode ") ||
25732:+      s.startsWith("merge branch 'johnnyeric/opencode") ||
25733:+      (s.includes("merge") && s.includes("opencode"))
```

### 5.2 Verification of `packages/http-recorder/package.json` URLs
```sh
$ git show db7c9eb7eb:packages/http-recorder/package.json | rg -n '"(repository|homepage|bugs)"' -A 4
```
**Output:**
```json
3:  "bugs": "https://github.com/Kilo-Org/kilocode/issues",
26:  "homepage": "https://github.com/Kilo-Org/kilocode/tree/main/packages/http-recorder",
34:  "repository": {
35:    "directory": "packages/http-recorder",
36:    "type": "git",
37:    "url": "git+https://github.com/Kilo-Org/kilocode.git"
38:  },
```

### 5.3 Audit of 34 New Locale Files
```sh
$ rg -i 'opencode' packages/ui/src/i18n/
# (0 matches returned)
```

---

## 6. Limitations

- **Pre-existing Internal Identifiers:** The audit scope is constrained to deltas between base commit `4bb1c2a45b` and PR head `db7c9eb7eb`. Internal workspace package identifiers (such as `@opencode-ai/core`, `@opencode-ai/ui`) and pre-existing historical comments remain part of the shared upstream fork architecture and were not altered by this PR.
- **Provider API Strings:** Model responses and error structures returned dynamically by external model APIs at runtime pass through as returned by upstream providers.

---

## 7. Action Items & Recommendations

1. **Move and Rebrand `.opencode/skills/rtl-aware-development/SKILL.md`:**
   - Move to `.kilo/skills/rtl-aware-development/SKILL.md`.
   - Update frontmatter description from `OpenCode Desktop should be RTL-aware.` to `Kilo Desktop should be RTL-aware.` (or neutral phrasing).
2. **Resolve Default Model Catalog URL in `packages/core/src/models-dev.ts`:**
   - Verify whether `Flag.KILO_MODELS_URL` default should remain `https://models.dev` (matching base and main) or use `https://models.opencode.ai`.
   - Restore `// kilocode_change` comment markers on lines 169 and 173.
