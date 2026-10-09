# Gateway model-prompt audit — 2026-09-05

Read-only comparison of Kilo `origin/main` at `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`
and the v2 source inherited from `59b29de4` (port checkpoint `82040801cd`).
No live catalog or model call was used. No historical prompt assets were installed.

## Existing extension and precedence

V1 `packages/opencode/src/session/system.ts:49-75` selects a prompt from the
catalog's closed `opencode.prompt` enum before model-name heuristics. Its LLM
request uses a custom agent prompt instead when one is present.

V2 already has a real mutable `ctx.session.hook("context")` system-prompt seam.
`packages/core/src/session/model-request.ts` constructs the agent or native base
prompt before this hook. Native `packages/core/src/plugin/system-prompt.ts`
replacements skip truthy custom agent systems. A Kilo post hook could likewise
replace the base part while preserving instruction/history parts and custom
agents; a new shared Core hook is not required. The catalog's policy tag would
need an in-process, location/account-scoped handoff, not model settings or a
second authenticated fetch on every prompt.

That seam does **not** make historical prompt contents compatible. Native GPT
adds a separate system part; replacing only the base leaves its delegation
instructions intact. Any port must test this composition, not clear the entire
system array and accidentally discard project instructions.

## Asset compatibility

| Catalog selector | Source finding | Safe next step |
|---|---|---|
| `anthropic` | Historical prompt names TodoWrite, Task, Bash and WebFetch. | Reuse the maintained v2 Anthropic asset, which already uses v2 tools. |
| `trinity` | Historical prompt names Bash, Task and an `ls` tool. | Reuse the maintained v2 Trinity asset. |
| `anthropic_without_todo` | Historical `default.txt` still names nonexistent Bash/Task/ls tools. | Use the native v2 baseline, including its tool-dependent guidance. |
| `codex` | Mostly reusable guidance, but references `apply_patch` and title-case tool names. | Port only with explicit tool-name corrections and real request tests. |
| `gpt55` | Same tool vocabulary problems, plus proactive Task delegation conflicts with native GPT's delegation restriction. | Resolve against v2 delegation semantics; do not silently combine conflicting prompts. |
| `gemini` | Incorrect tool/argument names, multiple-path assumptions, and legacy background execution guidance. | Requires a separately reviewed v2 adaptation. |
| `ling` | Requires a nonexistent shell `description` argument and legacy tool/lifecycle behavior. | Requires a separately reviewed v2 adaptation. |
| `beast` | Assumes unavailable durable Todo/memory/sequential-thinking tools and mandatory recursive web crawling. | Do not install unchanged; requires an explicit v2 design. |

Actual v2 tool schemas, not substitutions inferred from display labels, are the
authority: for example `shell` accepts `command`, `workdir`, `timeout` and
`background`; native delegation is `subagent`. Historical `gpt.txt` is not one
of the catalog enum selections and must not be invented as another selector.

## Resolution and v2 adaptations (2026-09-07)

All eight catalog `opencode.prompt` closed-enum selectors now have resolved, source-backed v2 implementations:
- `anthropic` and `trinity`: reuse maintained v2 assets via public core exports (`SystemPromptPlugin.AnthropicPrompt`, `SystemPromptPlugin.TrinityPrompt`).
- `anthropic_without_todo`: verified v2 equivalent using `SessionSystemPrompt.make(tools)` with actual tool guidance, overriding conflicting `claude` heuristics without legacy tool names.
- `codex`: source-backed adaptation of v1 `codex.txt`, adapting tool names to lowercase v2 tools (`read`, `edit`, `write`, `glob`, `grep`, `shell`), replacing `apply_patch` with `edit`/`write`, and preserving scannable CLI formatting.
- `gemini`: source-backed adaptation of v1 `gemini.txt`, adapting background shell execution to `background: true` on `shell`, adapting file paths to the `path` parameter, replacing `Bash` with `shell`, and replacing guaranteed confirmation-dialog claims with respecting configured permission rules and user refusals.
- `ling`: source-backed adaptation of v1 `ling.txt`, omitting the non-existent shell `description` schema parameter requirement, adapting long-running processes to `background: true`, and preserving stop signals and objectivity.
- `gpt55`: source-backed adaptation of v1 `kilocode-gpt-5.5.txt`, adapting tool names to v2 (`read`, `edit`, `write`, `glob`, `grep`, `shell`), removing `apply_patch`, and reconciling subagent delegation with native v2 delegation rules (no proactive subagent spawning).
- `beast`: source-backed adaptation of v1 `beast.txt`, preserving autonomous iteration and rigorous verification while replacing unavailable web/Task/Todo tool assumptions with native v2 tools.

Provider transport support is tracked separately: fixing `ai_sdk_provider` does not earn prompt-policy parity.
