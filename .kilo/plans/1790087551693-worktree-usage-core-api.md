# Worktree Usage Core API Plan

## Goal

Add a read-only CLI-core API that reports retained worktree economics across the primary checkout and linked worktrees: total/model/agent/session/subagent usage, timing, and a content-free orchestration timeline. Do not implement IDE adapters or UI in this change.

## Fixed Decisions

- Add no database tables, columns, indexes, migrations, or durable accounting ledger. Do not modify the SQL schemas or migration manifests.
- Report `basis: "retained"`: deleted or reverted transcript data is not recoverable and the result must not be described as lifetime billed spend.
- A root session's current canonical `Session.directory` owns its complete descendant tree and prior history. Moving the root session moves the tree's economics.
- Include archived retained sessions. Deleted sessions remain out of scope.
- Include the primary checkout (`kind: "primary"`) and linked worktrees (`kind: "linked"`), returning zero-valued summaries for worktrees with no sessions.
- Expose three authenticated, workspace-routed endpoints: batched summaries, current routed-worktree detail, and a separately paginated current-worktree timeline.
- Communication reporting is activity-only. Return counts, participants, timestamps, durations, and stored board-body byte counts, never prompt/message bodies and never attributed or estimated communication USD.
- Reuse existing persisted data only. Do not add future-write metadata as part of this core-only change.

## Public Contract

Add Effect schemas and domain functions in a Kilo-owned module such as `packages/opencode/src/kilocode/worktree/usage.ts`. Give every reusable public schema a stable OpenAPI identifier.

### Common values

- `basis`: literal `"retained"`.
- `currency`: literal `"USD"`; `cost` is the already-persisted provider-reported or computed step cost. The source quality is unavailable and must not be invented.
- `tokens`: non-negative input, output, reasoning, cache-read, and cache-write counts.
- `usage`: non-negative step count, sanitized finite non-negative cost, and tokens.
- `time`: optional `firstActivity`/`lastActivity`/`wallMs`, plus `modelMs`, `toolMs`, and `activeMs`.
  - `modelMs` is the sum of stored `step-finish.time.elapsed` values and may exceed wall time under concurrency.
  - `toolMs` is the sum of closed tool intervals and may include parent tools waiting on children.
  - `activeMs` is the union of all closed generation/tool intervals and must not double-count concurrency.
  - Include coverage counts for timed versus total generation steps and tool calls so legacy/in-flight gaps are visible.
- `communication`: counts for board posts, board reads, Agent Manager prompts, and Agent Manager replies; stored board-body bytes; and explicit `directCost: 0`.

### Endpoints

1. `GET /kilocode/worktree/usage/summaries`
   - Operation ID: `kilocode.worktreeUsage.summaries`.
   - Query: `WorkspaceRoutingQuery` only.
   - Response: current project ID, `basis`, `currency`, `asOf`, and one compact summary per primary/linked worktree.
   - Each summary contains canonical directory, kind, total usage/time/communication, root-session count, total session count, and subagent count.

2. `GET /kilocode/worktree/usage`
   - Operation ID: `kilocode.worktreeUsage.get`.
   - Query: `WorkspaceRoutingQuery` only; the target is `InstanceState.context.worktree`, not an arbitrary path parameter.
   - Response: the common envelope and selected-worktree summary plus:
     - model groups keyed by actual step provider/model and optional assistant-message variant, ordered by cost descending;
     - agent groups keyed by assistant-message agent, ordered by cost descending;
     - session rows ordered by creation time, with ID, parent/root IDs, title, optional agent, archived timestamp, direct usage, subtree usage, per-session model groups, and activity time.
   - `sum(session.direct.cost)`, `sum(model.cost)`, and worktree total cost must agree within normal floating-point tolerance. Never sum propagated `Session.cost` or assistant-message costs.

3. `GET /kilocode/worktree/usage/timeline`
   - Operation ID: `kilocode.worktreeUsage.timeline`.
   - Query: workspace routing fields plus optional opaque `before` cursor and integer `limit` (default 100, range 1-200).
   - Response: common envelope, selected worktree reference, events sorted by `(start, id)` descending, next cursor, and `hasMore`.
   - Use a versioned opaque cursor containing the last `(start, id)` key; reject malformed/unsupported cursors with `InvalidRequestError` rather than silently restarting.
   - Define a discriminated event union:
     - `generation`: session/root IDs, interval, agent, actual provider/model, optional variant, and direct step usage;
     - `tool`: session/root IDs, tool name, status, and optional closed interval, without input/output/title content;
     - `subagent`: the transformed Task tool event with parent/child session IDs, optional agent type, background flag, status, and invocation interval;
     - `communication`: channel (`board` or `agent_manager`), action (`post`, `read`, `prompt`, or `reply`), source/optional target or recipient, reply reference where present, optional board-body bytes/type, and point/interval time.
   - Merge `board_post` tool calls with their existing `kilo_board_message` row through source message/call IDs and emit one communication event. Emit `board_read` from its tool part. Classify Agent Manager `action=prompt` as `reply` when `replyTo` exists. Suppress these specialized calls from generic tool events.
   - Never return tool inputs, outputs, board bodies, or peer prompts.

## Data Flow And Query Rules

1. Resolve and canonicalize the current worktree family with `WorktreeFamily.list()`. Ensure the routed context worktree is present and identify the primary path from the project record; longest-containing-root matching assigns nested Agent Manager worktrees before the primary checkout.
2. Read root sessions (`parent_id IS NULL`) including archived rows, map each root's current directory to a worktree, and recursively load descendants by `parent_id` regardless of each child's directory. This deliberately implements session ownership and also tolerates project-ID drift across linked worktrees.
3. Run each summary/detail read as one database transaction so concurrently streaming updates cannot make totals and breakdowns disagree.
4. Query concrete scoped session IDs in bounded chunks to stay below SQLite parameter limits and allow the existing `part_session_idx`, partial step-finish index, message-session index, session-parent index, and board-root index to be used. Add no index migration.
5. Aggregate only valid assistant `step-finish` parts joined to their messages. Clamp malformed negative/non-finite numeric values to zero, ignore invalid JSON rows, prefer the step's routed model, and fall back to the assistant message provider/model.
6. Derive activity bounds from retained message/part timestamps, falling back to session creation for empty sessions. Missing legacy step timing contributes usage but not duration and lowers coverage. Open tools have no end and do not contribute a closed duration.
7. Build direct per-session usage first, then compute subtree usage by a post-order traversal. A fork's copied zero-cost parts stay zero; no special fork compensation is needed.
8. Derive communication without parsing human-readable text:
   - board posts from existing board rows, including cleared-but-retained history;
   - board reads, Agent Manager prompts/replies, and Task delegations from typed tool names plus structured input/metadata;
   - all other tool parts remain generic timeline events.
9. Keep summary responses compact. Detail and timeline calculations are on demand; add no cache or new SSE event in this change. Existing session/part events can drive client invalidation later.

## API Wiring

1. Extend `packages/opencode/src/kilocode/server/httpapi/groups/kilocode.ts` with the three paths, query/response schemas, OpenAPI descriptions, authorization, instance context, and workspace routing consistent with other Kilo-owned endpoints.
2. Extend `packages/opencode/src/kilocode/server/httpapi/handlers/kilocode.ts` with thin handlers that obtain the routed worktree context, call the domain module, and translate an invalid timeline cursor to the declared `InvalidRequestError`.
3. Keep all implementation and focused tests under paths containing `kilocode`; no `kilocode_change` markers are needed. Do not modify shared upstream session/worktree behavior.
4. Regenerate the JavaScript SDK with `./script/generate.ts`; do not hand-edit generated files. IDE consumption remains out of scope.
5. Add a minor `@kilocode/cli` changeset describing the new worktree usage and timeline API.

## Tests

1. Add focused domain tests under `packages/opencode/test/kilocode/` that seed real session/message/part/board records and verify:
   - primary, linked, empty, archived, nested-directory, unrelated-project, and project-ID-drift assignment;
   - moving a root session changes ownership of its whole descendant tree;
   - nested subagents, direct versus subtree usage, actual routed model fallback, variants, agents, token/cache totals, and no propagated-cost double-counting;
   - concurrent generation/tool intervals, active interval union, running tools, and legacy steps without timing/coverage;
   - Task, board, and Agent Manager event classification without content leakage;
   - board post de-duplication, cleared retained board history, byte counts, and communication direct cost zero;
   - stable timeline ordering, same-timestamp cursor pagination, `hasMore`, and invalid cursor rejection;
   - malformed JSON/negative values cannot corrupt or make the response non-finite.
2. Add all three protected routes to `packages/opencode/test/kilocode/server/httpapi-exercise-scenarios.ts` so the HTTP API coverage/auth/effect gates remain complete.
3. Extend `httpapi-public.test.ts` to lock operation IDs, workspace-routing query fields, timeline limit bounds, response schema identifiers, and the absence of content-bearing communication fields.
4. Regenerate the SDK and assert the generated client exposes all three typed methods and discriminated timeline event types through compilation.

## Validation

Run, in this order:

1. From `packages/opencode/`: targeted worktree-usage and public-contract tests.
2. From `packages/opencode/`: `bun run test:httpapi`.
3. From `packages/opencode/`: `bun run typecheck`.
4. From the repository root: `./script/generate.ts`.
5. From `packages/sdk/js/`: `bun run typecheck`.
6. From the repository root: `bun run lint` and `bun run script/check-opencode-annotations.ts --worktree`.

Inspect the final diff to confirm there are no SQL schema/migration changes, no IDE changes, no prompt/board/tool content in the wire contract, and no generated SDK edits beyond regeneration output.

## Explicitly Out Of Scope

- VS Code or JetBrains integration/UI/RPC adapters.
- Durable spend after deletion/revert, worktree deletion history, immutable task IDs, or cross-machine/team aggregation.
- Communication-triggered or marginal communication cost estimates.
- Todo transition history or an explicit worktree completion lifecycle.
- New persistence, metadata writes, indexes, caching, or SSE events.
