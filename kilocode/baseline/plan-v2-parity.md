# V1 Plan workflow parity boundary

At Kilo `origin/main` commit `ecccd1f`, Plan is a workflow rather than only a
read-only agent: the native Plan prompt prohibits implementation, `plan_exit`
requires a saved plan, and `PlanFollowup` presents Start new session, Continue
here, and Keep refining. Dismissal or rejection performs no implementation.

V2's built-in `opencode.plan` is narrower. It gives agent `plan` write access
only to `$HOME/.opencode/plan`, injects that directory in its hard-coded
reminders, and has no plan-file completion or follow-up transition.

The existing SDK post-registration seam can make a host-enforced definition
with ID `opencode.plan` win the built-in duplicate ID. A separate post policy
cannot remove the builtin reminder or its `$HOME/.opencode/plan` allowance, so
replacement is required to establish `.kilo/plans` as the sole Plan boundary.

## Implemented public seam

`packages/kilo-cli/src/plan-policy.ts` is a Kilo-owned post replacement. The
supervisor deliberately retains the last SDK post plugin for an enforced
duplicate ID, so the builtin is suppressed rather than composed. No shared Core
patch or private Core import is involved.

`ToolEditor.get("question")` exposes the native bound executor, input schema,
output schema, and `ToolContext`. The policy validates through those schemas,
calls that executor with the original `plan_exit` context, and thus reuses
native Form display, question permission evaluation, and its deliberate
cancellation defect. It only calls public `SessionDomain.create`,
`switchAgent`, or `prompt` after an exact listed answer. Rejection, dismissal,
and an unlisted free-form answer do not transition to implementation.

`plan_exit` is additionally passed through the interactive host's
`ToolAuthorizer` before path validation or a completion Form. The plugin fails
closed if that host callback is absent. Its visibility carries the same
`plan_exit` action, while explicit configured global denials are copied from
`build` when the native Plan agent is constructed after config discovery. A
reload resets Kilo ownership before checking for a configured `plan` agent, so
a newly configured Plan agent remains wholly user-owned. New-session handoff
preserves the active session's selected model, matching V1's fallback when no
separate Code model is configured.

The replacement keeps V1's planning behavior and safe-tool posture while making
the V2 boundary explicit: only existing, non-empty regular Markdown files whose
realpath is beneath `<project>/.kilo/plans` can complete Plan mode. V2 has no
equivalent to V1's read-only shell allowlist, so `shell` is denied rather than
presenting a non-enforced read-only claim. Config discovery runs first. A
configured `plan` agent is left wholly untouched, including a `question` deny;
that custom agent cannot use Kilo's `plan_exit`. The public editor has no
provenance for individual built-in versus configured permission rules, so the
owned native Plan policy does not try to retain arbitrary preexisting denies.
