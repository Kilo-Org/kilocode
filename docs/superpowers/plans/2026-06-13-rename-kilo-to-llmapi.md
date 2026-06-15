# LLMAPI-440 — Rename Kilo → LLMAPI (user-facing labels + logo)

Branch: `feat/rename-kilo-to-llmapi` (off `main`). ClickUp: LLMAPI-440.

## Goal
Rebrand all **user-facing** "Kilo / Kilo Code / KiloClaw" labels in `packages/kilo-vscode`
to **LLMAPI**, across all 20 locales, and swap the extension logo to the LLMAPI mark.
Internal identifiers stay as-is.

## Scope
- **In:** manifest labels (displayName, description, author, keywords, activity-bar &
  sidebar tab titles, ~39 command categories/titles, config title, submenu labels,
  icon description), `EXTENSION_DISPLAY_NAME`, every brand string in i18n
  (webview, autocomplete, cli-backend, kiloclaw, agent-manager) × all locales,
  KiloClaw → "LLMAPI Claw", and the logo assets.
- **Out / never touch:** command/config/context/view IDs (`kilo-code.*`, `kilocode.*`),
  publisher/package name, `@kilocode/*` imports, repo URL, the `.kilo` / `.kilocode`
  config-dir names that appear inside some strings, telemetry event names, the
  `kilo-logo` codicon name, and internal asset filenames (`kilo-light.png`, etc.).

## Approach
1. **i18n codemod** (`/tmp/rebrand_i18n.cjs`): lexer walks string literals, rebrands a
   literal only when it is a *value* (next non-ws char ≠ `:`) inside the object, skipping
   keys/imports/comments/`${}`-templates. Ordered map: `KiloClaw → LLMAPI Claw`,
   `Kilo Code → LLMAPI`, `\bKilo\b → LLMAPI` (case-sensitive, so lowercase paths/ids survive).
   Dry-run: 1072 value-literals across 61 files; 740 Kilo-bearing keys preserved.
2. **Manifest**: hand-edit label fields in `kilo-vscode/package.json` + `constants.ts`.
3. **Logo**: replace the 6 icon assets (keep filenames) with the LLMAPI mark from
   `llmapi-app/.../ui/logo.tsx`; monochrome variant for the activity bar; regenerate or
   sidestep `kilo-icon-font.woff2`; fix `alt="Kilo Code"` in 3 webview logo components.

## Verify
Typecheck/build `kilo-vscode`; grep proves no stray user-facing "Kilo"; visual spot-check
of the activity-bar icon; full `git diff` review. Commit only with explicit approval.
