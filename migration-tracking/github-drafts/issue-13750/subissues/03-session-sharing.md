# Complete v2 session sharing compatibility and acceptance

## Outcome

Complete the sharing contract across client, ingest service and public viewer.

## Scope

Viewer transcript compatibility, team ownership authorization, ongoing synchronization and deletion/revert semantics.

## Current position

Local share/unshare/fork paths and share metadata upload ahead of transcript content exist. Team sharing remains refused pending backend acceptance.

## Acceptance

- [ ] Verify the actual deployed token and metadata contracts when external testing is authorized.
- [ ] Implement or verify public viewer support for v2 self-contained messages.
- [ ] Establish backend team ownership authorization before enabling team uploads.
- [ ] Define and implement incremental synchronization with deletion/revert tombstones or an equivalent authoritative contract.
- [ ] Verify share, subsequent edits, revoke and fork with intentionally shareable data.
- [ ] Keep unsupported paths fail-closed and document cross-repository dependencies.

## Dependencies and boundaries

Requires cloud repository/backend work and later external acceptance. Local fixtures cannot stand in for deployed verification.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
