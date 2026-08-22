# Agent Manager Tool Schema: Re-landing Strictness Safely

## Status

PR #13197 (`fix(agent-manager): make tool requests strict`) was reverted by
#13203 because it broke every Claude request in the VS Code extension. This
document records the provider constraints that were discovered by live testing
and describes how to re-land the same improvement without reintroducing the
outage.

The improvement itself is still desirable: the model should not be able to
confuse "start new sessions" with "manage an existing session". Nothing about
that goal was wrong. Only the mechanism was.

## What Went Wrong

#13197 changed the advertised `input_schema` for `agent_manager` from a flat
object into a root-level `anyOf` union of five operation branches, deriving the
wire schema directly from the Effect `Params` union.

Anthropic rejects that shape on every route (direct, Bedrock, and Vertex):

```
tools.0.custom.input_schema.type: Field required
```

Supplying the missing `type: "object"` surfaces the real constraint:

```
input_schema does not support oneOf, allOf, or anyOf at the top level
```

The failure is not scoped to Agent Manager. `agent_manager` is advertised
whenever `KILO_CLIENT=vscode`, and the tool map is sorted alphabetically before
the provider call, so it becomes `tools[0]`. A single rejected tool schema
aborts the whole request, so every message to every Claude model failed,
including messages that never touch Agent Manager. The prompt
`"Say OK and nothing else."` reproduces it under `KILO_CLIENT=vscode` and
succeeds under `KILO_CLIENT=cli`.

This was the second occurrence. #12244 fixed the same incompatibility on
2026-07-15 and added a regression test for it. #13197 did not delete that test,
it inverted the assertions in place:

```diff
- expect(schema.type).toBe("object")
- expect(schema.anyOf).toBeUndefined()
+ expect(schema.type).toBeUndefined()
+ expect(schema.anyOf).toHaveLength(5)
```

The test was also renamed from "uses an object-root input schema without
combinators" to "advertises each operation as a strict union branch", so it no
longer read as a compatibility guard. CI stayed green. An inverted assertion is
harder to catch in review than a deleted one, because the test count does not
move and the diff looks like routine maintenance for a new design.

## Provider Constraints

These were verified against live APIs, not inferred from documentation. Any
design must satisfy all of them at the same time.

| # | Constraint | Enforced by | Failure mode |
|---|---|---|---|
| C1 | Root `input_schema` must include `type: "object"` | Anthropic direct, Bedrock, Vertex | 400 `input_schema.type: Field required`, whole request aborted |
| C2 | No `anyOf` / `oneOf` / `allOf` at the root | same | 400 `does not support oneOf, allOf, or anyOf at the top level` |
| C3 | Every advertised property must accept `null` | OpenAI strict structured outputs | Model force-populates junk values for irrelevant fields |
| C4 | Runtime validation must treat `null`, `""`, and `[]` extras as absent | Claude in lenient mode, OpenAI in strict mode | Legitimate calls rejected as mixed payloads |
| C5 | No prefix-only `pattern` on `sessionID` in the advertised schema | llama.cpp | Schema rejected |

C3 and C4 are consequences of C1 and C2, not independent preferences. A flat
schema is the only shape Anthropic accepts, and a flat schema is exactly what
causes providers to populate fields outside the intended operation. Fixing only
C1 and C2 trades a Claude outage for an OpenAI one.

Observed payloads that motivate C3 and C4:

```jsonc
// gpt-5.1, strict structured outputs, flat schema without nullable fields
{"action":"list","mode":"worktree","tasks":[{"prompt":"init"}],"sessionID":"","prompt":"x"}

// claude-sonnet-4.5, lenient mode, unprompted null-fill on a stop request
{"action":"stop","sessionID":"ses_abc","mode":null,"tasks":null,"filter":null,"prompt":null}
```

Lenient mode is real and relevant: `strict: false` is forced for
`@ai-sdk/openai`, `@ai-sdk/azure`, and `@ai-sdk/amazon-bedrock/mantle` in
`packages/opencode/src/session/llm/request.ts`, and Anthropic never grammar
constrains tool arguments at all. Invalid arguments are not repaired into a
valid shape; `experimental_repairToolCall` in
`packages/opencode/src/session/llm.ts` converts them into the `invalid` tool, so
a rejected payload surfaces as a failed tool call.

## Sequencing

Two pull requests, in this order. The protection must exist before the change it
protects against, otherwise the same inversion can happen a third time.

### PR 1: Registry-Wide Schema Invariant

Scope: one new test file. No source changes. Passes against current `main`
because the reverted schema already has a flat object root.

Add `packages/opencode/test/kilocode/tool-schema-provider-compat.test.ts`:

- Build the real tool registry under `KILO_CLIENT=vscode`, which advertises the
  widest tool set and includes both Agent Manager tools.
- Walk every advertised tool through `registry.all()` and
  `ToolJsonSchema.fromTool`.
- Assert for each tool that the root has `type === "object"` and no `anyOf`,
  `oneOf`, or `allOf`.
- Assert that the collected IDs contain `agent_manager`, so the loop can never
  silently cover zero relevant tools.
- Collect all offenders and assert on the full list, so one run reports every
  broken tool rather than only the first.

Design notes that matter more than the assertions:

- The file lives outside `agent-manager-tool.test.ts` on purpose. The failure
  mode was a per-tool assertion being rewritten by the same change that broke
  the shape. A guard sitting next to the tool is the easiest thing to "update
  for the new design".
- The assertion is phrased as an invariant across all tools. Flipping it
  requires consciously exempting one tool from a shared rule, which is visible
  in review.
- New tools are covered automatically, including future MCP-adjacent additions.

Acceptance requirement: demonstrate the guard failing before merging it.

```bash
cd packages/opencode
git stash
git checkout eb731248cb -- src/kilocode/tool/agent-manager.ts
bun test ./test/kilocode/tool-schema-provider-compat.test.ts
# expected: agent_manager: input_schema.type is undefined
```

A guard that has never been observed failing is not yet a guard.

No changeset. Test-only, no user-facing change.

### PR 2: The Strictness Improvement

Gate before starting: #13197 closed no issue, and its motivation was a
hypothetical mixed payload rather than a reported bug. Confirm the team still
wants it. If no mixup has ever been observed in practice, the description-only
subset below delivers most of the value at nearly zero risk.

#### Design

Keep the advertised schema and the runtime validator as two deliberately
separate layers. Collapsing them is precisely what #13197 did.

| Layer | Shape | Purpose |
|---|---|---|
| Advertised (`WireParams`) | Flat object, every field optional and nullable | Provider compatibility: C1, C2, C3, C5 |
| Runtime (`Params`) | Strict five-branch `Schema.Union` | The actual guarantee |

1. `wireSchema()` derives from `WireParams`, never from `Params`. Add a comment
   naming C1 and C2 so the indirection is not "simplified" away later.
2. Every `WireParams` field is `Schema.optional(Schema.NullOr(...))`, including
   `action`, `mode`, `tasks`, `sessionID`, and `prompt`.
3. The `strict()` branch check ignores extra keys whose value is `null`,
   `undefined`, `""`, or `[]`. A populated foreign key is still rejected, so
   `{action: "list", mode: "local", tasks: [...]}` still fails.
4. Extract shared field definitions into one object consumed by both layers.
   Duplication between the branch schemas and the wire schema is how the two
   drifted apart twice.
5. Preserve the existing `sessionID` pattern strip for C5.

#### Descriptions Carry The Guidance

A flat schema gives the model no structural hint about mutual exclusivity, so
the per-field descriptions have to state it. Mark `mode` and `tasks` as start
only, instruct the model to send `null` for fields outside the operation it
picked, and keep the existing "use list first" guidance on `action`.

Most of the practical benefit of #13197 was clearer guidance rather than
structural enforcement, and guidance requires no change to the advertised shape.
Shipping only this part is a legitimate outcome.

#### Tests

- Each of the five branches accepts a clean payload.
- Fully null-filled variants of each branch are accepted, covering C3 and C4.
- Populated cross-branch keys are rejected, per pair.
- An invalid `sessionID` is rejected.
- A mixed payload never reaches `ctx.ask`.
- Do not add or modify root-shape assertions here. PR 1 owns that invariant, and
  it should live in exactly one place.

Changeset: `patch`, written for release notes in terms of what a user gets, not
in terms of unions or schemas.

## Verification Protocol

Unit tests cannot catch C1 through C4. They all passed on #13197. Live provider
calls are mandatory for PR 2.

```bash
cd packages/opencode
KILO_CLIENT=vscode bun run --conditions=browser ./src/index.ts run --auto \
  --model <model> "<prompt>" </dev/null
```

Two details are easy to get wrong. `KILO_CLIENT=vscode` is required because the
Agent Manager tools are not advertised under `cli`, which makes the bug
invisible. Redirecting stdin from `/dev/null` is required when looping, because
the subprocess otherwise consumes the loop's input.

Smoke test for C1 and C2, with no Agent Manager involvement. The prompt
`"Say OK and nothing else."` must return `OK` on `claude-sonnet-4.5`,
`claude-opus-4.8`, `claude-fable-5`, and `claude-opus-5`.

Branch matrix for C3 and C4. Exercise `list`, `prompt`, `stop`, `move`,
`unassign` (move with `sectionID: null`), `start-local`, `start-worktree`,
`start-multi`, and `start-versions` against at least one Claude model, one
OpenAI model, and one Gemini model.

Interpreting results: reaching the permission prompt or the Agent Manager
extension timeout means validation passed. `Unexpected Agent Manager parameter`
or `invalid arguments` means it failed. Use `--auto` to get past permission
prompts. Models frequently call `list` first when asked to start something, so
word the start prompts to force the start branch or those branches silently go
untested.

Known gap to close: during the original investigation the `start-*` branches
were never confirmed against a live Claude call. Do not skip them.

## Review Checklist

1. Does the advertised schema still have an object root with no top-level
   combinator? PR 1 answers this automatically.
2. Is `wireSchema()` still derived from `WireParams` rather than `Params`?
3. Is any existing shape assertion being modified or renamed? Treat that as a
   red flag and require justification, because that is exactly how this
   regressed twice.
4. Does every advertised property accept `null`?
5. Were live calls run under `KILO_CLIENT=vscode` against at least one Claude
   model, and is the output recorded in the PR discussion?

## What Not To Do

- Do not derive the advertised schema from a `Schema.Union`.
- Do not add `type: "object"` to a union root and assume it is fixed. Anthropic
  rejects top-level combinators separately from the missing `type`.
- Do not make advertised fields non-nullable in a flat schema.
- Do not rely on unit tests alone. They passed on the broken code.
- Do not rewrite the shared invariant to accommodate one tool.
