# OpenCode Mentions Review

## Scope
- PR: https://github.com/Kilo-Org/kilocode/pull/10387
- Base compared: main

## Findings

- Severity: High
- File: `packages/opencode/src/cli/cmd/providers.ts:472`, `packages/opencode/src/cli/cmd/providers.ts:481`
- Exact mention/link: `https://opencode.ai/auth`; `https://opencode.ai/docs/providers/#cloudflare-ai-gateway`
- Why user-facing or risky: These are printed during `kilo auth login` provider setup, so users can be sent to OpenCode web properties instead of Kilo-owned docs/auth pages.
- Recommendation: Replace with Kilo-owned auth/docs URLs or remove the OpenCode provider-specific prompt if that provider should not be exposed in Kilo.

- Severity: High
- File: `packages/opencode/src/config/config.ts:143`, `packages/opencode/src/config/config.ts:146`, `packages/opencode/src/config/config.ts:237`
- Exact mention/link: `Server configuration for opencode serve and web commands`; `https://opencode.ai/docs/commands`; `https://opencode.ai/docs/agents`
- Why user-facing or risky: These schema descriptions surface in generated config docs/schema tooling and direct users to OpenCode docs for Kilo configuration.
- Recommendation: Change descriptions to Kilo terminology and Kilo docs URLs.

- Severity: High
- File: `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:54`, `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:63`, `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:72`, `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:83`, `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:92`, `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:102`, `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:103`
- Exact mention/link: `OpenCode server`; `OpenCode system`; `OpenCode configuration`; `OpenCode instances`; `Upgrade opencode`; `Upgrade opencode to the specified version or latest if not specified.`
- Why user-facing or risky: These OpenAPI annotations generate public SDK/OpenAPI docs and API client comments, so external integrators see OpenCode instead of Kilo.
- Recommendation: Replace OpenCode/opencode with Kilo in the source annotations and regenerate the SDK/OpenAPI artifacts.

- Severity: High
- File: `packages/sdk/js/src/v2/gen/sdk.gen.ts:566`, `packages/sdk/js/src/v2/gen/sdk.gen.ts:568`, `packages/sdk/openapi.json:416`, `packages/sdk/openapi.json:417`
- Exact mention/link: `Upgrade opencode`; `Upgrade opencode to the specified version or latest if not specified.`
- Why user-facing or risky: These generated artifacts are published SDK/OpenAPI surfaces. The source appears to be `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts`.
- Recommendation: Fix the source OpenAPI annotations and regenerate `packages/sdk/js/` and `packages/sdk/openapi.json`.

- Severity: Medium
- File: `packages/opencode/src/cli/cmd/debug/index.ts:59`
- Exact mention/link: `opencode version: ${InstallationVersion}`
- Why user-facing or risky: `kilo debug info` prints this directly to the terminal, making Kilo identify itself as opencode in diagnostic output.
- Recommendation: Change the label to `kilo version`.

- Severity: Medium
- File: `packages/opencode/src/cli/cmd/run.ts:281`
- Exact mention/link: `attach to a running opencode server (e.g., http://localhost:4096)`
- Why user-facing or risky: This is CLI help text for `kilo run --attach`, so users see OpenCode terminology while using Kilo.
- Recommendation: Change to `kilo server`.

- Severity: Medium
- File: `packages/opencode/src/cli/cmd/tui/attach.ts:52`
- Exact mention/link: `basic auth username (defaults to KILO_SERVER_USERNAME or 'opencode')`
- Why user-facing or risky: This is CLI help text and is also inconsistent with `packages/opencode/src/server/auth.ts`, which defaults to `kilo`.
- Recommendation: Change the help text default to `'kilo'`.

- Severity: Medium
- File: `packages/sdk/js/src/v2/client.ts:92`, `packages/sdk/js/src/v2/client.ts:110`, `packages/sdk/js/src/v2/client.ts:113`
- Exact mention/link: `OpenCode Server`; `opencode server ${method} ${url}`
- Why user-facing or risky: These SDK runtime errors can be shown in extension, CLI, or downstream app error handling when requests fail.
- Recommendation: Replace with `Kilo server`/`Kilo Server`.

- Severity: Medium
- File: `packages/opencode/src/cli/cmd/providers.ts:401`, `packages/opencode/src/cli/cmd/providers.ts:457`, `packages/opencode/src/cli/cmd/providers.ts:466`, `packages/opencode/src/cli/cmd/providers.ts:471`
- Exact mention/link: `opencode: "recommended"`; `opencode.json`; `provider === "opencode"`
- Why user-facing or risky: The auth provider picker can mark OpenCode as recommended and related CLI messages instruct users to configure `opencode.json` rather than Kilo config. Some `opencode.json` support may be intentional compatibility, but this should be verified for user-facing copy.
- Recommendation: Do not mark OpenCode as recommended in Kilo unless intentional. Prefer `kilo.json` in user-facing guidance, with `opencode.json` only framed as legacy compatibility if needed.

- Severity: Medium
- File: `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts:30`, `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts:41`, `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts:77`, `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts:127`, `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts:238`, `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts:263`, `packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts:92`, `packages/opencode/src/server/routes/instance/httpapi/groups/pty.ts:50`, `packages/opencode/src/server/routes/instance/httpapi/groups/pty.ts:117`, `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:117`, `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:138`, `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:205`, `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:444`, `packages/opencode/src/server/routes/instance/httpapi/groups/v2.ts:10`
- Exact mention/link: `OpenCode configuration`; `OpenCode state`; `OpenCode sessions`; `OpenCode session`; `OpenCode`; `opencode experimental HttpApi`
- Why user-facing or risky: These are OpenAPI annotations for API docs and SDK generation. Even if the routes are experimental, generated docs are user/developer-facing.
- Recommendation: Replace OpenCode/opencode wording with Kilo and regenerate API artifacts.

- Severity: Low
- File: `packages/extensions/zed/extension.toml:9`, `packages/extensions/zed/extension.toml:11`, `packages/extensions/zed/extension.toml:13`, `packages/extensions/zed/extension.toml:14`, `packages/extensions/zed/extension.toml:15`, `packages/extensions/zed/extension.toml:18`, `packages/extensions/zed/extension.toml:19`, `packages/extensions/zed/extension.toml:20`, `packages/extensions/zed/extension.toml:23`, `packages/extensions/zed/extension.toml:24`, `packages/extensions/zed/extension.toml:25`, `packages/extensions/zed/extension.toml:28`, `packages/extensions/zed/extension.toml:29`, `packages/extensions/zed/extension.toml:30`, `packages/extensions/zed/extension.toml:33`, `packages/extensions/zed/extension.toml:34`, `packages/extensions/zed/extension.toml:35`
- Exact mention/link: `[agent_servers.opencode]`; `./icons/opencode.svg`; `opencode-*.zip`; `opencode-*.tar.gz`; `cmd = "./opencode"`; `cmd = "./opencode.exe"`
- Why user-facing or risky: This is extension packaging metadata. Zed may expose server IDs, icon names, download archive names, or command paths in logs/install UI, even though the visible server name is `Kilo` and release URLs point to Kilo GitHub.
- Recommendation: Verify Zed requires these names for compatibility. If not required, rename package assets and command metadata to Kilo branding.

- Severity: Low
- File: `.opencode/agent/triage.md:31`, `.opencode/agent/triage.md:35`, `.opencode/agent/triage.md:39`
- Exact mention/link: `opencode web`; `Core opencode server`; `OpenCode Zen, OpenCode Go`
- Why user-facing or risky: The agent is hidden, but this prompt drives GitHub issue triage behavior and can route Kilo issues using upstream OpenCode product/team names.
- Recommendation: Update triage language to Kilo product names or confirm these upstream labels are intentionally retained for internal routing.

## Checked Patterns
- Compared changed files with `git diff --name-only main...HEAD` on the checked-out PR branch.
- Searched added diff lines for `opencode`, `OpenCode`, `open code`, `opencode.ai`, `github.com/sst/opencode`, `github.com/opencode`, `@opencode`, and URL-bearing lines.
- Searched changed files directly with hidden files included for `opencode|open code|opencode\.ai|github\.com/sst/opencode|github\.com/opencode|sst\.dev`.
- Focused review on UI strings, CLI help/output, SDK/OpenAPI generated docs, config schema descriptions, package/extension metadata, provider login messages, error messages, and hidden command/agent prompts.
- Ignored purely internal imports, package paths such as `packages/opencode`, test fixture strings, compatibility config filenames where not presented to users, and comments unless they referenced an OpenCode web property or affected user-facing generation.
