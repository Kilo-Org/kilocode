# Current architecture relevant to the autonomous goal engine

Paths are relative to `packages/opencode/src` unless noted.

## Existing `/goal` loop

- Files: `kilocode/session/goal/{state,runner,policy,tool,instructions}.ts`.
- Command registered in `command/index.ts:118-124`, dispatched at `session/prompt.ts:2314` via `goals.command(input)`.
- `Goal.make(ops)` (`runner.ts:177`) returns `{ command, pause, arm }`. `drive()` (`runner.ts:245`) re-prompts the same session with `GoalInstructions.prompt(text)` until the model calls `goal_report`, a permission is rejected, or a turn fails or makes no progress.
- Status is stored in `session.metadata["kilo.goal"] = { text, status, active, reason }` through `sessions.setMetadata`. `GoalState.project()` (`state.ts:61`) rewrites a persisted `active` to `paused` when no run is live, so restarts show paused.
- Cancellation: `KiloSessionControl.Ticket` (`kilocode/session/control.ts`), `GoalState.prepare/start/pause` tokens, per-session `commit()` semaphore.
- Tools: `goal` (arm start/resume) and `goal_report` (`tool.ts`), gated by `GoalPolicy.available` (`policy.ts:27`) which also hides `question` during goals.
- UI: `kilocode/cli/cmd/tui/component/goal.tsx` row, `goal-sync.ts` reconnect sync, VS Code `kilo-vscode/webview-ui/src/components/chat/goal/`.
- Headless: `kilocode/cli/cmd/run.ts validateGoal` allows only bare, `pause`, `clear`.
- Tests: `test/kilocode/session/goal.test.ts` (template for engine tests).

## Child sessions and structured output

- Task tool path (`tool/task.ts:224-301`): `sessions.create({ parentID, title, agent, permission })`, then `ops.prompt({ sessionID, agent, model, variant, parts })`, then `SessionDrain.wait(child)`. Result is the last non-synthetic text part; `info.cost` and `info.tokens` hold usage.
- Structured output: `PromptInput.format = { type: "json_schema", schema }` adds a `StructuredOutput` tool with `toolChoice: "required"` (`session/prompt.ts:1781-1897`). The result is in `assistant.structured`; missing output produces `StructuredOutputError`. `retryCount` is unused, so callers retry.
- Depth: `cfg.subagent_depth` (default 1) prevents subagents from spawning subagents.
- `SessionPrompt.Interface.prompt(PromptInput)` (`session/prompt.ts:147`) runs the turn to completion and returns `SessionV1.WithParts`.

## Agents and permissions

- `Agent.Info` (`agent/agent.ts:40-66`): `name, mode, permission: Ruleset, model?, prompt?, steps?`. No `tools` field; tool visibility is derived from permission rules.
- Built-ins in `agent/agent.ts:167-325`; Kilo additions in `patchAgents` (`kilocode/agent/index.ts:481`): `code`, hardened `plan`/`explore`, `debug`, `ask` (read-only).
- Agents are looked up by name (`session/prompt.ts:1687`), so engine agents must be registered in `patchAgents`.
- Rules: `{ permission, pattern, action }`, last match wins (`permission/index.ts:102`). `Permission.fromConfig`, `readOnlyBash` (`kilocode/agent/index.ts:55-144`).
- Unattended: `KiloHeadless.mark(rootID)` (`kilocode/permission/headless.ts`) makes any `ask` under that root fail immediately.
- Bash patterns are matched per parsed command with arity prefixes (`permission/arity.ts`), so `git push *` matches `git push origin main`.

## Persistence

- `Storage.Service` (`storage/storage.ts:53`): `read/update/write/list/remove` keyed by string arrays, stored as JSON files. Example: `kilocode/wakeup/index.ts`.
- Session metadata (`session.metadata`) for small UI-facing status, synced automatically to TUI and VS Code.
- SQLite via drizzle only for queryable state (`kilocode/board/store.ts`), needs a core migration.

## Cost and tokens

- Per step: `Session.getUsage` (`session/session.ts:419`), applied in `session/processor.ts:621-676` to `assistantMessage.cost/tokens`.
- Pricing: `Provider.Model.cost` `{ input, output, cache }` USD per 1M tokens (`provider/provider.ts:1072`).
- Session totals: `Session.Info.cost/tokens`, written by SQL so `session.updated` does not fire for cost changes.
- `KiloCostPropagation` (`kilocode/session/cost-propagation.ts`) rolls child cost into the parent message.

## Models

- Identity `{ providerID, modelID }`; `Provider.parseModel("provider/model")`, `defaultModel()`, `getSmallModel()`.
- Config: `model`, `small_model`, `subagent_model`. No notion of local vs cloud providers exists.

## Config

- Schema in `packages/core/src/v1/config/config.ts`, Kilo keys inside the `kilocode_change` block near line 117. New keys must be mirrored in the cloud repo `extras.ts`. Regenerate SDK with `./script/generate.ts` from the repo root.

## Tests

- Run from `packages/opencode/`: `bun test ./test/kilocode/<path>`.
- Harness: `test/lib/effect.ts` (`testEffect`, `it.instance`), `test/fixture/fixture.ts` (`TestInstance`), `test/lib/llm-server.ts` (`TestLLMServer`, `reply().text()/.tool()/.usage()/.stop()`).
