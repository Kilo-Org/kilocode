# Skills v2 parity

Audited on 2026-09-05 at current v2 HEAD
`59b29de40966803e2c7cd734d439843fb773f6a6` and the local Kilo
`origin/main` ref `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`.
The earlier pin `76dbaf20adbd43fd208a00ef3cda4a51e125a234` is baseline
provenance, not a claim that these host additions exist at that pin.

This note records the supported Kilo v2 slice and the host-owned shell
compatibility extension. Upstream v2 itself has no v1 skill trust field.

## Supported v2 slice

The Kilo interactive host now has an opt-in project configuration adapter in
`packages/kilo-cli/src/project-config.ts`:

- native project documents are read only when `projectConfig` is enabled;
- `.kilo/` and `.kilocode/` are walked inside the canonical project boundary;
- native and supported v1 markdown agent frontmatter is converted through the
  exported v2 `ConfigMarkdown`, `ConfigAgent`, `ConfigAgentV1`, and
  `ConfigMigrateV1` schemas;
- `skills/` emits the native `AgentsDirectory` entry, while generic project
  directory entries (which can discover plugins) are never emitted;
- symlinked files and directories are ignored, and project plugin declarations
  are reported but not loaded;
- `packages/kilo-cli/src/skill-policy.ts` contributes the Kilo configuration
  builtin from the real `skill-policy-kilo-config.md` asset; a project skill
  with the reserved `kilo-config` ID cannot replace it and produces a fixed
  diagnostic.

The public v2 skill transform is sufficient for that bounded policy. The
transform receives `list`, `get`, `add`, `update`, and `remove` only; it does
not receive source provenance. The host therefore registers this policy in
the post phase, after config skill discovery, and reserves the builtin ID
explicitly.

## v1 behavior audited

The relevant v1 sources are under `origin/main`:

- `packages/opencode/src/skill/index.ts:34-40` defines `Skill.Info.trusted`;
  discovery carries a `trusted` bit on each match (`:85-102`), derives it
  from the source roots and project realpaths (`:185-195`, `:245-280`), and
  seeds builtins before discovered skills (`:296-316`);
- `packages/opencode/src/kilocode/skills/inject.ts:41-105` parses live
  `!\`cmd\`` placeholders, leaves fenced/documentation examples inert, blocks
  disabled or untrusted skills, asks for permission for the complete command
  batch, and only then runs bounded commands;
- `packages/opencode/src/tool/skill.ts:45-56` is the only call site of
  `SkillInject.render`. Thus `SkillInject` executes for a model-initiated
  `skill` tool load. The user-initiated `/skill` path does not call
  `SkillInject` and never gets that injector behavior;
- the separate v1 command/template path in
  `packages/opencode/src/session/prompt.ts:2406-2425` has its own shell
  substitution branch. That path is not evidence that the v1 `SkillInject`
  contract can be reused by a v2 public plugin.

The v1 builtin inventory is in
`packages/opencode/src/kilocode/skills/builtin.ts`; it embeds
`kilo-config.md` and identifies the builtin with the special `builtin`
location. User-skill replacement by name was a v1 behavior, but v2's Kilo
policy intentionally reserves its own builtin ID because the public transform
cannot distinguish a trusted builtin from a project overlay.

## Current v2 seams and host-owned approval

Current v2 `packages/schema/src/skill.ts:19-27` has `id`, `name`, optional
display flags, `location`, and `content`; it has no `trusted`, source-root, or
provenance field. Content is passed directly by
`packages/core/src/skill.ts:37-68`. The model skill tool calls
`Permission.Service` and `Skill.prepare` at
`packages/core/src/tool/plugin/skill.ts:48-60`, and prompt skill attachments
call `Skill.prepare` at `packages/core/src/session/prompt.ts:56-72`; neither
path parses or executes `!` placeholders.

The public plugin API does not provide the missing approval boundary:

- `packages/plugin/src/effect/permission.ts:22-24` exposes only
  `list`, `get`, `reply`, and an `evaluate` hook;
- `packages/plugin/src/effect/shell.ts:15-17` exposes only a
  `create.before` shell hook;
- `packages/plugin/src/effect/plugin.ts:47-64` exposes those domains through
  plugin context, but has no first-class forced-interactive approval request.

The initial plugin-only gap is now closed by Kilo-owned host composition,
not a new shared Core/schema patch. The host supplies source provenance,
native permissions, Core Form approval and the native shell tool to a narrow
callback. The post plugin wraps only the model-initiated `skill` tool. It does
not spawn Bun itself and does not modify user `session.skill` activation.
See [trusted shell evidence](skill-shell-parity.md) for the exact API, bounds,
forced-human confirmation, headless cancellation and native policy tests.

## Acceptance coverage and open items

Covered by the Kilo tests:

- project native/v1 markdown agents, precedence, boundary checks, symlink
  rejection, and plugin-directory non-discovery;
- native project skills under `.kilo/` and `.kilocode/` only when opt-in is
  enabled;
- the real Kilo builtin asset, reserved-ID collision behavior, and literal
  user-activated `!` placeholder content through the interactive host;
- trusted model skill output is expanded only after native preflight and a
  mandatory Form; native deny, explicit rejection and headless auto execute
  no command;
- project-config filesystem skill roots are canonically confined before
  becoming native config entries. Absolute and relative out-of-project
  sources are omitted; remote URLs retain native cache confinement and remain
  untrusted. Missing or symlinked roots require correction/restart;
- inner project skill-file symlinks resolving outside the project are removed
  from inventory, so neither model nor user skill loads expose that content.

Remaining items are intentionally unclaimed:

- exporting a new shared v2 skill provenance field (host-owned checks suffice);
- automatic scanning of existing v1 home-directory skill stores;
- broad project plugin trust or generic executable directory discovery.
