# OpenCode Branding Review

**Scope and methodology**

Reviewed PR #12460 at `51d8031c9997bd5478bcde715562169f732d04d4` over `origin/main...HEAD` (`b367105c8d648c8e05b62c2d27a28a95a4772f61...51d8031c9997bd5478bcde715562169f732d04d4`). Searched added lines and surrounding user-facing UI, CLI/TUI, help, documentation, package metadata, OpenAPI/SDK, prompts, skills, headers, and URLs for `OpenCode`, `opencode`, `opencode.ai`, and `anomalyco/opencode`. Compared ambiguous additions with upstream tag `v1.17.9` (`5c23e88419c4743b9be42cea132f2fb1e6cb63ff`) and traced generated/runtime API rebranding.

**Findings**

1. **Medium severity, high confidence: Published `@opencode-ai/http-recorder` metadata now routes users to OpenCode.**

   References: `packages/http-recorder/package.json:13-14`.

   User-facing values introduced by this merge:

   ```json
   "homepage": "https://github.com/anomalyco/opencode/tree/dev/packages/http-recorder",
   "bugs": "https://github.com/anomalyco/opencode/issues"
   ```

   These fields are exposed by package registries and package tooling, so users seeking documentation or support for the Kilo-published package are sent to OpenCode. The package still declares `git+https://github.com/Kilo-Org/kilocode.git` as its repository, and `origin/main` used the matching Kilo homepage and issue tracker. The values match upstream `v1.17.9`, indicating an upstream metadata import rather than intentional Kilo attribution.

   Recommendation: restore the Kilo URLs:

   ```json
   "homepage": "https://github.com/Kilo-Org/kilocode/tree/main/packages/http-recorder",
   "bugs": "https://github.com/Kilo-Org/kilocode/issues"
   ```

**Notable Non-Findings**

- The new experimental-capabilities source annotation says `"Get experimental features enabled on the OpenCode server."` in `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts:140`. This is not an exposed API branding leak: the public OpenAPI transform invokes `matchLegacyKiloOpenApi` (`packages/opencode/src/server/routes/instance/httpapi/public.ts:194`), which recursively replaces `OpenCode` with `Kilo` (`packages/opencode/src/kilocode/server/httpapi/public.ts:131-147`). The committed generated artifact has `"Get experimental features enabled on the Kilo server."` at `packages/sdk/openapi.json:928`; the generated V2 SDK contains no `OpenCode`, `opencode`, `opencode.ai`, or `anomalyco/opencode` hits.

- The merge expands `packages/core/src/plugin/skill/customize-opencode.md` with OpenCode command paths and retains an `https://opencode.ai/config.json` example. This is upstream content, but production boot does not register `SkillPlugin.Plugin`: `packages/core/src/plugin/boot.ts:100-112` registers `ConfigSkillPlugin.Plugin` and deliberately omits the legacy skill. Kilo's registered built-in configuration skill is `kilo-config` (`packages/opencode/src/kilocode/skills/builtin.ts:14-20`), and the Kilo system prompt directs agents to `.kilo/` and `kilo.json` (`packages/opencode/src/kilocode/system-prompt.ts:25`). No current user-facing skill/prompt regression was found. Human verification is warranted only if another shipping client directly registers `SkillPlugin.Plugin` outside the normal boot path.

- Added `https://github.com/anomalyco/opencode/issues/...` references are source-code comments in `packages/opencode/src/mcp/index.ts` and the generated `packages/kilo-docs/source-links.md` manifest. They are upstream issue provenance, not rendered product documentation or runtime output. They are intentionally technical, although they currently cause the repository branding guard to report them.

- Added `@opencode-ai/*` imports, the `opencode` provider ID, legacy `opencode.json` compatibility paths, `.opencode-version`, and upstream merge metadata are technical identifiers or compatibility data. No evidence shows them rendered in the changed UI, CLI/TUI, errors, provider headers, generated SDK, or product help text.

**Command Outputs**

```text
$ git rev-parse HEAD
51d8031c9997bd5478bcde715562169f732d04d4

$ git rev-parse origin/main
b367105c8d648c8e05b62c2d27a28a95a4772f61

$ git show --no-patch --format='%H %s' v1.17.9
5c23e88419c4743b9be42cea132f2fb1e6cb63ff release: v1.17.9

$ git diff --stat origin/main...HEAD
208 files changed, 9294 insertions(+), 4906 deletions(-)

$ git show v1.17.9:packages/http-recorder/package.json
homepage and bugs are the same anomalyco/opencode URLs as HEAD.

$ git show HEAD:packages/sdk/openapi.json | rg -ni 'OpenCode|opencode|anomalyco/opencode|opencode\.ai'
no matches

$ bun run script/check-forbidden-strings.ts
exit 1; reports the two package-metadata URLs above and four upstream issue-comment URLs in packages/opencode/src/mcp/index.ts.
```

**Limitations**

- This was a static range review. The local server and package publication flow were not launched, but the `/doc` and SDK conclusions are supported by the explicit runtime transform and committed generated OpenAPI artifact.
- The inactive `customize-opencode` skill was traced through the normal production boot path. Direct registration by an unreviewed external consumer was not exercised.

**Result**

One medium-severity, high-confidence user-facing branding regression found. Report: `OPENCODE_MENTIONS.md`.
