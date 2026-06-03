# OpenCode Mention Review: PR #10822

## Scope and methodology

Reviewed PR [#10822](https://github.com/Kilo-Org/kilocode/pull/10822) at snapshot `94fc42255c35827b197d97368d75d079242e9f4d` against PR base snapshot `2f7f23deac683078a350014ec8a1a946aae46ce4`. The review covered the 181 added, modified, and renamed files in the snapshot diff, with focused searches across added lines and the checked-out snapshot for `OpenCode`, `opencode`, OpenCode-hosted URLs, and upstream web properties. The pristine upstream target checkout at `/Users/marius/Documents/git/kilocode/.worktrees/opencode-merges/v1.14.46/merge/.worktrees/opencode-merge/opencode` was searched to confirm the origin of the newly merged built-in skill.

The review prioritized user-facing surfaces: CLI and TUI strings, docs and help-like content, config guidance, package metadata, server/OpenAPI descriptions, generated SDK descriptions, URLs, and error text. Existing mentions outside the PR diff were used only as context and are not reported as newly introduced findings.

## Findings

### Likely branding leak: upstream `customize-opencode` built-in skill was merged without Kilo adaptation

The PR adds an upstream built-in skill that is surfaced to the model on unstable channels and can directly guide edits to a user's configuration. This is user-impacting even though the text is consumed by the agent rather than rendered as ordinary UI. The skill consistently teaches OpenCode branding, config filenames, directories, and schema URLs instead of Kilo's preferred configuration surface.

Registration and trigger description:

- `packages/opencode/src/skill/index.ts:39` registers the skill as `"customize-opencode"`.
- `packages/opencode/src/skill/index.ts:41` says: `"Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. ..."`
- `packages/core/src/flag/flag.ts:58` through `packages/core/src/flag/flag.ts:60` make the skill default-on for `dev`, `beta`, and `local`, while stable channels remain opt-in via `KILO_EXPERIMENTAL_CUSTOMIZE_SKILL`.

Representative skill-body leaks:

- `packages/opencode/src/skill/prompt/customize-opencode.md:7`: `# Customizing opencode`
- `packages/opencode/src/skill/prompt/customize-opencode.md:11`: `` `https://opencode.ai/config.json` (the JSON Schema) and validate against it. ``
- `packages/opencode/src/skill/prompt/customize-opencode.md:13`: ``Every `opencode.json` should declare `"$schema": "https://opencode.ai/config.json"` ``
- `packages/opencode/src/skill/prompt/customize-opencode.md:20`: project config is documented as ``./opencode.json`, `./opencode.jsonc`, or `.opencode/opencode.json` ``.
- `packages/opencode/src/skill/prompt/customize-opencode.md:21`: global config is documented as ``~/.config/opencode/opencode.json` ``.
- `packages/opencode/src/skill/prompt/customize-opencode.md:22` through `packages/opencode/src/skill/prompt/customize-opencode.md:25`: agent and skill locations are documented only under `.opencode/` and `~/.config/opencode/`.
- `packages/opencode/src/skill/prompt/customize-opencode.md:335`: the `KILO_CONFIG_CONTENT` escape hatch still embeds ``"$schema":"https://opencode.ai/config.json"``.
- `packages/opencode/src/skill/prompt/customize-opencode.md:346`: instructs the model to fetch `https://opencode.ai/config.json` when uncertain.

Why this appears wrong for Kilo: existing Kilo-specific guidance establishes `kilo.json` / `kilo.jsonc`, `.kilo/`, `~/.config/kilo/`, and `https://app.kilo.ai/config.json` as the preferred modern surface while retaining OpenCode paths only for compatibility. Examples include `packages/opencode/src/kilocode/system-prompt.ts:18`, `packages/opencode/src/kilocode/skills/kilo-config.md:3`, `packages/opencode/src/kilocode/skills/kilo-config.md:226`, and `packages/kilo-docs/pages/contributing/architecture/config-schema.md:8`. The new upstream skill can therefore steer agents toward legacy OpenCode locations and bypass Kilo's schema overlay.

Human verification requested: decide whether Kilo should drop this upstream skill, adapt it into a Kilo-branded skill, or delegate entirely to the existing Kilo-owned `kilo-config` built-in skill. If retained for compatibility, the prompt should clearly mark OpenCode names and URLs as legacy fallback paths rather than the preferred configuration.

## Intentional compatibility references

- `.opencode/tui.json:2` contains `"$schema": "https://opencode.ai/tui.json"`. This line is present before and after the PR; the PR only removes an empty `"keybinds": {}` block. It is not a newly introduced OpenCode URL, but it remains an OpenCode-hosted schema reference worth retaining only if Kilo intentionally has no branded TUI schema endpoint.
- The many added `@opencode-ai/core/...` imports are internal package namespace references caused by moving schema utilities into `packages/core/`. They are not user-facing branding leaks.
- The added references in `packages/opencode/specs/effect/migration.md`, `packages/opencode/specs/effect/schema.md`, `packages/opencode/specs/openapi-translation-cleanup.md`, and `packages/opencode/specs/v2/tui-command-shim.md` describe internal package paths and implementation work. They are developer-facing upstream provenance, not end-user product copy.
- The new tests at `packages/opencode/test/server/httpapi-provider.test.ts:266` and `packages/opencode/test/server/httpapi-provider.test.ts:306` use `https://opencode.ai/config.json` in fixtures. They exercise compatibility behavior and do not surface text to users.

## Notable non-findings

- No new display-cased `OpenCode` product strings were added in changed UI or CLI runtime content. The only added match in the changed UI/CLI subtree is the internal import `@opencode-ai/core/schema` in `packages/opencode/src/cli/cmd/tui/event.ts:3`.
- No new OpenCode branding or OpenCode-hosted URLs were added to generated artifacts in `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/types.gen.ts`, `packages/sdk/js/src/v2/gen/types.gen.ts`, or `packages/sdk/js/src/v2/gen/sdk.gen.ts`.
- Existing generated SDK comments at `packages/sdk/js/src/gen/types.gen.ts:1212` and `packages/sdk/js/src/gen/types.gen.ts:1269` still link to `https://opencode.ai/docs/commands` and `https://opencode.ai/docs/agent`, but those lines are unchanged from the PR base snapshot and were not introduced by this merge.
- Changed package metadata in `packages/opencode/package.json`, `packages/kilo-console/package.json`, `packages/kilo-web-ui/package.json`, and `bun.lock` adds dependency metadata only; no new user-visible OpenCode name or URL was introduced there.
- The Kilo OpenAPI generation path still applies explicit branding rewrites in `packages/opencode/src/cli/cmd/generate.ts:40` through `packages/opencode/src/cli/cmd/generate.ts:44`, including `OpenCode` to `Kilo` and `https://opencode.ai/` to `https://kilo.ai/`. The changed generated outputs contain no newly added OpenCode residue.

## Command outputs

- `git rev-parse HEAD` in the review checkout returned `94fc42255c35827b197d97368d75d079242e9f4d`.
- `git diff --name-status 2f7f23deac683078a350014ec8a1a946aae46ce4..94fc42255c35827b197d97368d75d079242e9f4d` reported 181 changed paths.
- Searching added lines for OpenCode web links found the unchanged `.opencode/tui.json:2` schema URL in a rewritten line, five `https://opencode.ai/config.json` references in the new skill prompt, and two test-fixture schema URLs.
- Searching generated artifact additions for `opencode`, `OpenCode`, `opencode.ai`, `anomalyco`, and `sst.dev` returned no matches.
- Searching the pristine upstream target confirmed that `packages/opencode/src/skill/index.ts`, `packages/opencode/src/skill/prompt/customize-opencode.md`, and the associated preload note originated upstream.

## Limitations

- This was a static diff and content-search review. No CLI, TUI, extension, or agent session was launched.
- Existing OpenCode mentions outside the PR diff were not exhaustively audited. Some pre-existing user-facing references remain in the repository and may merit a separate branding audit.
- The new built-in skill is default-on only for unstable channels unless explicitly enabled, so its exact production exposure depends on release channel and environment overrides.
