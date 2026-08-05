# OPENCODE_MENTIONS.md — OpenCode branding audit for upstream-merge PR (v1.18.13)

## Scope

Reviewed HEAD: `cce22e608f` ("merge: upstream v1.18.13"), pre-merge Kilo base `b135b4e10a`, PR diff = 390 files.
Question: does the merge (re)introduce **user-facing** "OpenCode" strings or OpenCode web-property links where Kilo branding should be?

## Methodology

- `git diff b135b4e10a..HEAD | grep -i '^+' | grep -i opencode` → 245 added lines across 130 files; each file drilled into individually.
- URL sweep: `grep -iE 'opencode\.ai|sst/opencode|anomalyco/opencode|docs\.opencode'` on added lines.
- For every candidate string: checked reachability (rendered UI / shipped prompt / published metadata vs. dead code, comments, test fixtures, internal identifiers) and compared against Kilo's existing convention in sibling files.
- Compared `packages/opencode/src/session/prompt/meta.txt` against upstream tag `a105350812` to separate upstream text from Kilo edits.
- Verified high-risk spots explicitly: `packages/opencode/src/cli/cmd/**`, TUI tips/dialogs, `packages/sdk/js/src/v2/gen/types.gen.ts` (0 opencode hits in diff), `packages/kilo-docs` (untouched by PR), `packages/opencode/src/config/config.ts` (no opencode string changes), root + `packages/opencode/package.json` metadata (only deps/scripts changed; name stays `@kilocode/cli`).

## Findings

### 1. `packages/opencode/src/session/prompt/meta.txt` — system prompt says "You are OpenCode" — MEDIUM

New file merged from upstream (wired in `system.ts:76`: `if (model.api.id.includes("muse-spark")) return [PROMPT_META]`).

- **Line 1**: `You are OpenCode, a coding agent that helps users with software engineering tasks. You are powered by Muse Spark, a large language model trained by Meta MSL.`
- **Line 56**: `# Tool Use – OpenCode Specifics`
- **Line 65**: `... use the WebFetch tool to gather information to answer the question from the OpenCode docs at https://opencode.ai/docs.`

Where a user would see it: this is the **system prompt** for any model whose id contains `muse-spark`. `muse-spark-1.1` exists in the model catalog (10 hits in `test/tool/fixtures/models-api.json`, a snapshot of the models API) via the `opencode` (OpenCode Zen) provider, so a Kilo user who connects that provider and picks muse-spark gets an agent that calls itself OpenCode and fetches opencode.ai docs.

Why it's clearly an oversight: all nine sibling prompt files (`anthropic.txt`, `beast.txt`, `codex.txt`, `default.txt`, `gemini.txt`, `gpt.txt`, `kilocode-gpt-5.5.txt`, `kimi.txt`, `ling.txt`) start with **"You are Kilo"**. Kilo already patched this same file's line 64 (`github.com/anomalyco/opencode` → `github.com/Kilo-Org/kilocode`, verified vs upstream tag) but missed lines 1, 56, 65.

Severity: Medium — user-facing identity + opencode.ai link, but reachable only via muse-spark models (not a default Kilo model). Flag for human verification of whether Kilo Gateway offers muse-spark.

### 2. `packages/http-recorder/package.json:11-12` — metadata reverted to anomalyco/opencode — LOW-MEDIUM

```
-  "homepage": "https://github.com/Kilo-Org/kilocode/tree/main/packages/http-recorder",
-  "bugs": "https://github.com/Kilo-Org/kilocode/issues",
+  "homepage": "https://github.com/anomalyco/opencode/tree/dev/packages/http-recorder",
+  "bugs": "https://github.com/anomalyco/opencode/issues",
```

A straight **regression of Kilo's pre-merge values** (repository field stayed Kilo-Org). Package is `@opencode-ai/http-recorder` with `"publishConfig": { "access": "public" }`, so these URLs are user-visible on npmjs.com if the package is published. Severity: Low-Medium — depends on whether Kilo's release pipeline actually publishes this package; in-repo regression regardless.

### 3. `packages/core/src/models-dev.ts:169,172` — model catalog source switched to `models.opencode.ai` — LOW (verify intent)

```
-    const source = Flag.KILO_MODELS_URL || "https://models.dev"
+    const source = Flag.KILO_MODELS_URL || "https://models.opencode.ai"
```

The runtime model/provider catalog for the CLI is now fetched from an opencode.ai property (also in `packages/ui/vite.config.ts:50` and internal `packages/llm/script/recording-cost-report.ts:5`). The catalog feeds provider entries "OpenCode Zen" / "OpenCode Go" with `doc: https://opencode.ai/docs/zen` into `/connect` and `kilo models` surfaces. Those provider names are upstream data and were already present via models.dev (pre-existing), but the merge newly hard-couples all clients to opencode.ai infrastructure — the VS Code extension does **not** set `KILO_MODELS_URL` (no hits in `packages/kilo-vscode/src`). Severity: Low — flagged for human verification whether this upstream infra move is acceptable to Kilo or should be repointed.

### 4. `packages/storybook/.storybook/mocks/app/context/language.ts:25-64` — new OpenCode-branded i18n mock — LOW (verify)

Newly added mock contains upstream's app i18n table verbatim: `"Free models provided by OpenCode"` (l.25), `"...use {{provider}} models in OpenCode."` (l.42,56,64), `"OpenCode Zen gives you access..."` (l.47), `"provider.connect.opencodeZen.visit.link": "opencode.ai/zen"` (l.51). Kilo's real extension i18n (`packages/kilo-vscode/webview-ui/src/i18n/en.ts:122`) says "models in Kilo". The mocks are wired as vite aliases in `.storybook/main.ts:11,38-45`, but **no story in this repo imports `@/context/*`** (grep found zero consumers) — currently dead code; would surface in Storybook / docs screenshot output if app stories are ever added. Severity: Low, borderline non-finding.

## Notable non-findings

- **`packages/tui/src/feature-plugins/home/tips-view.tsx`** — the merged tips with `opencode.ai` share link, `docker run ... ghcr.io/anomalyco/opencode`, `opencode.json`, and "OpenCode Zen" all live inside a `/* kilocode_change hide the entire list ... */` block comment (lines 168-292). `TIPS` evaluates to `[]`; only `KILO_TIPS` (from `packages/opencode/src/kilocode/.../tips.ts`) renders. Dead code — the merge edited commented-out text.
- **`packages/core/src/plugin/skill/customize-opencode.md`** — heavily OpenCode-branded built-in skill ("Customizing opencode", `https://opencode.ai/config.json` as schema source, `opencode.json` paths). **Pre-existing**, merge changed only one unrelated MCP-example line (l.112). Egregious but not introduced by this PR.
- **`artifacts/glm52-rise-video/` (20 new files)** — upstream marketing video sources with "OPENCODE GO" overlays and `opencode.ai/data` URLs. Not product UI; OpenCode-branded assets now in Kilo's repo. Observation only.
- **`script/translate-app.ts`, `script/translate-app.test.ts`, `.opencode/command/translate.md`, `script/upstream/merge.ts`** — internal dev/merge tooling; "OpenCode did not report a session ID" etc. never ship.
- **`packages/codemode/` (README, codemode.md, AGENTS.md, tests, `test/fixtures/opencode-v2-openapi.json`)** — `private: true` workspace package; design docs and a fixture snapshot of upstream's own OpenAPI spec ("opencode HttpApi" title, "...owned by this OpenCode process..." descriptions). Internal only.
- **Internal identifiers** — `@opencode-ai/*` import paths, `registerOpencodeSpinner`, `OpenCodeTheme` (registered under the name `"Kilo"` in `packages/ui/src/context/marked-theme-register.tsx`), `"@opencode/McpBrowser"` context id, `"opencode.debug"` command ids, `providerID.startsWith("opencode")` logic, `USER_AGENT = opencode/...` (unchanged context line), test fixtures (`models-api.json`, `marked-parser.test.ts`). Not user-visible.
- **`packages/opencode/src/session/prompt/copilot-gpt-5.txt`** ("Your name is opencode") — pre-existing, unchanged by this PR.
- **CLI surface** (`packages/opencode/src/cli/cmd/**`) — no added user-facing opencode strings; footer changes are spinner-import plumbing only; `import.ts` added only generic file-error formatting.
- **Untouched surfaces** — `packages/kilo-docs`, `packages/sdk/js` incl. `src/gen` (0 opencode hits in diff), `packages/kilo-vscode` + webview (only Kilo-branded i18n import changes), `packages/kilo-ui`, root and `packages/opencode/package.json` metadata (`name` stays `@kilocode/cli`, no homepage/bugs/description changes).

## Limitations

- Reachability judged statically; did not run the CLI, render the TUI/Storybook, or execute a muse-spark session.
- Network behavior of `models.opencode.ai` vs `models.dev` (redirects, catalog diff) not verified.
- Finding 1's reachability assumes a user connects the upstream OpenCode Zen provider; whether Kilo Gateway itself offers muse-spark models was not verified.
- Pre-existing opencode mentions outside the PR diff were not exhaustively audited; only egregious ones adjacent to the diff are noted.
