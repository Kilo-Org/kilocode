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

## Save permission regression fix (2026-09-05)

The Plan agent could never actually save a plan file. Core tool authorization
evaluates in-Location mutations against a Location-relative resource
(`LocationMutation.Target.resource`, e.g. `.kilo/plans/approved.md`), while the
Plan policy's `edit` allowance used an absolute `<location>/.kilo/plans/*.md`
glob. `Wildcard.match` never matched the two forms, so every real `write`/`edit`
call fell through to the trailing `*`/`*` deny. Earlier tests precreated the
plan file, called `plan_exit` directly, and evaluated `Permission.evaluate`
with absolute paths, masking the mismatch. The allowance now uses the
Location-relative `.kilo/plans/*.md` form. A dead `external_directory`
allowance for the location's own plans directory was removed: `LocationMutation`
marks those paths internal lexically, so an external request for them is
unreachable, and no blanket external allow exists. Inherited configured denies
stay appended last, so global user denies (e.g. `edit *.md`) still win over the
Plan allowance, verified through a real denied `write` and unchanged file
contents. Saved-permission grants still cannot bypass configured denies.

`plan_exit` diagnostics for missing targets now distinguish ENOENT ("save the
plan ... before calling plan_exit") from other filesystem errors, which surface
with their real message instead of being reported as nonexistent.

## Prompt save-consent workflow (2026-09-05)

The owned native plan prompt now instructs the model to use the native question
tool to ask the user to choose between "Finalize and save the plan" and
"Continue refining" before creating or updating a plan file, matching V1's Plan
File reminder behavior at `ecccd1f`. This save consent is prompt-directed only:
there is no host-enforced deterministic write-consent gate, and the host cannot
force a modal before `write`. Host enforcement remains at `plan_exit`, which
requires the saved non-empty real Markdown file; a cancelled save form leaves
no file, no completion form, and no implementation (covered by a test), while a
user-declined save ("Continue refining" answer) is prompt-directed behavior not
host-tested. The prompt also resolves the former contradiction where the final
"Do not implement source or documentation changes" line read as prohibiting the
plan file itself: plan files under `.kilo/plans` are now stated as the one
permitted exception, and the old "tell the user to switch agents" line is
scoped so normal completion always flows through `plan_exit` rather than a
manual switch suggestion.

Test evidence exercises the real flow against a loopback fixture model: with no
`.kilo/plans` directory, the model's native question opens the save form, a
real `write` tool call creates the plan file (persisted contents asserted),
`plan_exit` opens the completion form, and "Continue here" implements in
session. The captured model request is asserted to advertise the `write` and
`edit` tools and to carry the updated system prompt including the
save-consent instruction and the plan-file exception. Writes outside the plan
directory are denied through real tool authorization and leave the tree
untouched.
