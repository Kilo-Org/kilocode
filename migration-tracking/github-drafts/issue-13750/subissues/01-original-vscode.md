# Complete original Kilo VS Code client parity

## Outcome

Port and validate the original Kilo webviews and host contracts against v2.

## Scope

Original sidebar and editor panels; lifecycle and streaming; permissions/questions; settings/accounts/models; timeline and diffs; Agent Manager/notebook host contracts.

## Current position

Original sources build and several adapters have focused local tests. Full client typechecking and original-UI acceptance remain incomplete.

## Acceptance

- [ ] Resolve remaining backend facade and consumer typecheck failures without no-op success shims.
- [ ] Verify prompt → response → idle, responsive Stop, reconnect and restart in the original UI.
- [ ] Complete original notifications and suggestions, including their request/reply lifecycle.
- [ ] Implement agent and skill removal and session message deletion required by the original client.
- [ ] Complete viewer presence registry/relay integration and validate original visibility reporting.
- [ ] Verify independent editor sessions, restore, settings persistence and account changes.
- [ ] Verify ticket-based terminal open, stream, resize, close and reconnect.
- [ ] Complete Agent Manager/notebook contracts or retain them explicitly as open scope.
- [ ] Record original-UI acceptance and remaining limitations in the repository plan.

## Dependencies and boundaries

Feature-specific FIM, speech and additional clients belong to the companion editor-services issue. Shared runtime defects belong to runtime parity.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
