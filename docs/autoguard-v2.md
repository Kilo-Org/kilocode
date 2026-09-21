# AutoGuard L0/L1 v2

AutoGuard is opt-in. Use the native Kilo adapter in this worktree and load
`packages/opencode/src/kilocode/autoguard/entry.ts` as a plugin. The benchmark
loads `bench-plugin.ts` for all four arms, including observation-only baseline.
An older host without the adapter refuses execution through this plugin.
L2 is disabled in the controller and the v2 benchmark.

## Models and private configuration

Place literal assignments in `~/.config/autoguard/models.env` (mode 0600), or
point `AUTOGUARD_ENV_FILE` at another host-owned file outside the project:

```dotenv
AUTOGUARD_L1_BASE_URL=https://your-vllm-host/v1
AUTOGUARD_L1_MODEL=Qwen3.5-9B
AUTOGUARD_L1_API_KEY=replace-locally
OPENROUTER_API_KEY=replace-locally
```

Environment variables override the file. The classifier and extractor use
separate JSON prompts on the same vLLM model. The benchmark passes the main
agent key to Kilo without executing the env file. Never put credentials in
fixture files or checked-in configuration. L1 accepts only final content with
`verdict`, `reason_code`, and `missing_facts`; prose, reasoning-only replies,
duplicate JSON keys, truncated content, HTTP failures and timeouts cannot allow.

## Trusted host configuration

`AUTOGUARD_SOURCE_PATHS`, `AUTOGUARD_TEST_PATHS` and
`AUTOGUARD_GENERATED_PATHS` are comma-separated workspace resources. No
build/cache/node_modules resource receives a default cleanup grant. Set
`AUTOGUARD_TRUST_TESTS=1` only for project code that the host trusts to execute.
`AUTOGUARD_PROTECTED_PATHS` defaults to `.git,.env,secrets`;
`AUTOGUARD_ALLOWED_HOSTS` defaults to an empty network allowlist.
README, comments, attachments and skill text do not modify this catalog.

The supported direct-message grammar binds a leading RU/EN operation to named
resources and retains explicit negation. For example, “Fix src/ so the tests
pass” grants source edits and verification when those roles are configured;
it grants no test edits. “Не меняй tests/” is a prohibition. More complex
language is conservative: missing or unverifiable authority waits for a
specific target confirmation. Extractor suggestions carry a message ID and
an exact supporting quote; suggestions alone never create grants.
Unparsed restrictions persist across messages and restarts. An unrelated new
request cannot erase them; an action-specific clarification must resolve them.
Supported reading restrictions such as “Do not read src/private.py” cover
direct reads and enclosing content searches. An unparsed restriction also
suspends read fast paths. A grant on a source parent does not imply edits to
resources assigned the verification role; those require explicit narrow authority.

Contracts persist per canonical workspace and session outside writable roots.
They retain the initial request, clarifications, evidence, prohibitions,
version, configuration fingerprint and pending approvals. Child prompts are
agent data. Children inherit a narrowing intersection and permanently lose
revoked grants. Session identity is the expiry boundary; an inactive contract
is not reactivated by later messages.
Changing the host catalog invalidates existing grants and pending approvals.
Ancestor restrictions are reapplied even when a child receives a new approval;
revocation propagates through every generation of delegated sessions.

## Execution and approvals

The adapter evaluates finalized tool arguments before the first effect and
aggregates every operation with `DENY > ASK > ALLOW`. Patch parsing checks both
sides of moves and all create/update/delete hunks. Edit authority does not
authorize deletion. Unsupported shell indirection, heredocs and embedded
interpreters remain opaque. Skills load with shell expansion disabled.

Supported pytest/unittest options have explicit argument grammars. Implicit
test discovery can be narrowed to already authorized verification roots;
the rewritten arguments are the arguments evaluated and executed. Test code
runs with native sandbox restrictions on writes and network, Python plugin
and cache controls, and a configuration fingerprint retained across resume.
The guard profile intersects native restrictions and cannot widen them.
The complete execution profile is rechecked before each effect, including
host test trust, allowed hosts, environment and write roots.
Recursive content searches require an inspectable scope without credentials
or unresolved symlinks. Existing files need an external content backup before
an edit can be allowed; Git tracking alone is insufficient.

ASK uses the native Question service. A reply is bound to the pending ID,
contract version and action fingerprint. Cancellation adds no grant. After a
reply, the complete action and profile are checked again. Restart preserves
pending state without automatically replaying an effect. Three equivalent
DENYs stop for user input; acknowledging the question does not remove the
underlying prohibition. Autonomous benchmark runs never answer these questions.

Agent-initiated `question` calls use the same native service and audit stream.
Scripted benchmark answers may either select a proposed grant with
`operation`, `target`, `approved`, or answer one concrete question with
`question_pattern`, `answer`. Text rules are consumed once. Their exact text
passes through contract validation; a regex match never creates authority.
Clarifying a pending action returns control to the agent to propose a fresh
call. Unanswered questions remain `waiting_user`; cancellation is recorded and
does not count as a successful scripted continuation.

## Audit and limits

Events distinguish proposal, policy decision, I/O or process start, execution
finish and tool finish. Process exit codes and tool errors are independent of
policy verdicts. A shared process boundary does not prove that every shell
segment ran: such operation events carry `shared_boundary=true`.
Baseline decisions are null. Missing startup/audit evidence invalidates guard
metrics, and legacy execution evidence remains unknown.

Backups are host-owned JSON files under the contract store's `backups/`, with
original bytes encoded as base64 and the original mode. Audit and state are
excluded from tool write roots. Failure to write the audit fails execution.
The supported model excludes a concurrent malicious host process and malicious
project tests reading host secrets. Canonicalization and pre-effect rechecks
reduce path confusion; they do not eliminate every possible TOCTOU race.

## Verification

From `packages/opencode`:

```sh
bun test test/kilocode/autoguard --timeout 20000
bun run typecheck
```

From `packages/kilo-sandbox`:

```sh
bun test test/filesystem.test.ts test/context.test.ts --timeout 30000
bun run typecheck
```

From the repository root:

```sh
bun run script/check-opencode-annotations.ts --worktree
bun run script/check-opencode-promise-facades.ts
```

End-to-end commands, independent review materials and measured limitations
are maintained in the accompanying benchmark worktree. Passing local tests
is not a claim that holdout or latency/utility acceptance thresholds passed.
