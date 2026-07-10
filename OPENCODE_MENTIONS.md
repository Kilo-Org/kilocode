# OpenCode branding review for PR #12088

## Methodology and scope

Reviewed the complete `origin/main...HEAD` diff (1,206 files, 115,443 additions, 46,254 deletions), searched added lines case-insensitively for `OpenCode`/`opencode`, OpenCode web properties, and legacy config/path forms, then read relevant head and base context. The review prioritized runtime UI/CLI text, prompts/templates, errors, URLs, auth defaults, docs, package metadata, and generated OpenAPI/SDK output. Internal upstream identifiers were separated from strings users can see or be directed to use.

## Findings

### High: GitHub Action defaults were restored to OpenCode services

- `packages/opencode/src/cli/cmd/github.handler.ts:441` now builds public `[kilo session]` links with `https://opencode.ai` (or `https://dev.opencode.ai` for mock runs). The base implementation used `https://kilo.ai` / `https://dev.kilo.ai`. GitHub comments produced by Kilo will therefore send users to an OpenCode property and duplicate-share detection will look for the wrong host.
- `packages/opencode/src/cli/cmd/github.handler.ts:702` defaults `OIDC_BASE_URL` to `https://api.opencode.ai`; the base implementation used `https://api.kilo.ai`. Unless every workflow overrides the variable, Kilo's token exchange calls the OpenCode API despite the surrounding install/check endpoints and GitHub app being Kilo-branded.
- The generated `packages/kilo-docs/source-links.md:12`, `:57`, and `:158` entries are downstream evidence of these restored URLs, not independent sources to fix.

### Medium: `/init` reverted its model-facing Kilo guidance

- `packages/core/src/plugin/command/initialize.txt:3`, `:15`, and `:59` tell the agent it is preparing future "OpenCode sessions" and point it to `opencode.json`.
- `packages/core/src/plugin/command.ts:18-20` installs this template as the `init` command, and `packages/core/src/plugin/boot.ts:96` registers that command plugin. The corresponding base template used "Kilo sessions", `kilo.json`, and Kilo `instructions` guidance.
- This can cause Kilo users running `/init` to receive OpenCode-branded `AGENTS.md` content or have the agent inspect/recommend the wrong primary config name. Restore the Kilo wording and config examples while preserving any deliberate legacy-config discovery separately.

### Low: a new provider error tells Kilo users to run `opencode auth`

- `packages/opencode/src/provider/provider.ts:899` introduces a Snowflake Cortex credential error that directs users to "opencode auth". This is runtime error text in the Kilo CLI; use `kilo auth` unless the provider intentionally requires a separate OpenCode installation.
- The base tree has an older TUI tip with the same stale command, but that does not make this newly added occurrence correct. Consider fixing both for consistent help text.

## Human review

- `packages/server/src/auth.ts:32,56` and `packages/server/src/routes.ts:22` default the new private v2 server package's Basic Auth username to `opencode`, unlike Kilo's established `kilo` default. The CLI-mounted v2 routes explicitly provide the existing Kilo `ServerAuth.Config.defaultLayer`, so I did not find a current CLI behavior regression. Align the private package if its standalone `webHandler`/`createRoutes` exports are expected to be user-consumable or become the primary server path.
- `CONTEXT.md:1-3` is a new root architecture/domain document titled "OpenCode Session Runtime". It is developer-facing rather than product UI, so I did not classify it as a release-blocking user regression. Rename to Kilo if root engineering docs are expected to use fork branding; otherwise document that the term denotes the upstream runtime.

## Notable non-findings

- No new OpenCode branding was found in the changed VS Code UI, CLI help snapshots, generated SDK TypeScript comments, or public Kilo CLI reference page.
- `@opencode-ai/*` package/import names, `@opencode/*` Effect service tags, `OpenCode` public embedding API symbols, provider ID `opencode`, `.opencode`/`opencode.json` compatibility discovery, `OPENCODE_*` compatibility flags, legacy database fallback names, and tests/fixtures were treated as intentional upstream or compatibility identifiers.
- `packages/server/package.json`'s private `@opencode-ai/server` name and lockfile entries are internal workspace metadata, not user-facing package branding.
- The `opencode experimental HttpApi` title added in `packages/server/src/api.ts:34` and generated tags in `packages/sdk/openapi.json` were not reported as newly restored branding because the base OpenAPI already uses the same title across many route groups. It remains existing branding debt rather than a PR-specific regression.
- `anomalyco/tree-sitter-vue` URLs are upstream parser artifacts, not links intended to brand Kilo or direct users to OpenCode product properties.

## Commands

- `git status --short`
- `git diff --stat origin/main...HEAD`
- `git diff --name-status origin/main...HEAD`
- `git diff --numstat origin/main...HEAD`
- `git log --oneline --decorate origin/main..HEAD`
- `git diff --no-color --unified=0 origin/main...HEAD` filtered with Perl for added branding, URL, config/path, metadata, error, prompt, and OpenAPI candidates
- `git diff --no-color --unified=3 origin/main...HEAD -- <candidate paths>`
- `git show origin/main:<path>` and `git grep ... origin/main` for base comparisons
- Repository `grep`/file reads for runtime reachability and surrounding context

## Limitations

- This was a static diff review; no CLI, GitHub Action, server, UI, or generated-doc runtime was executed.
- `rg` is unavailable in the container, so equivalent Git/Perl searches were used. The PR's scale and generated OpenAPI churn mean indirect strings assembled without an `OpenCode` token could still escape keyword-based review.
- Other untracked root review reports (`CONFIG_REGRESSION.md`, `INFRASTRUCTURE_CHANGE.md`, and `TESTS.md`) appeared during this concurrent review and were not read or modified.
