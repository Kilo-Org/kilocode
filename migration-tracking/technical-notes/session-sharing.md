# V2 session sharing contract and remaining gates

Source audit: 2026-09-05, sibling `cloud` repository. The adapter targets its
cached `origin/main` at `08c4887fa68738f19089284101084f404eb6c9b8` (2026-09-03),
read with `git show`. The clean checkout at
`c32be17d69e5340ab804b8e1f32ff7298fc91ee9` (2026-08-12) is 407 commits behind:
it returns UUID `public_id` and disables public reads. Later commits
`b0997ec63` and `211b1f17b` restore sharing with purpose-bound JWT tokens.
Neither source revision proves what is deployed. No live sharing smoke test was
performed, and no cloud checkout files were changed.

## Current backend contract

Paths below are relative to `cloud/services/session-ingest/src/`.

| Operation | Verified contract | Source |
|---|---|---|
| Bootstrap | `POST /api/session` with `{ sessionId }`; returns `{ id, ingestPath }` | `routes/api.ts` |
| Upload | `POST ingestPath` with `{ data: [{ type, data }] }`; stored session data is loose, message data requires an `id` | `types/session-sync.ts`, `ingest/validate.ts` |
| Share | `POST /api/session/:sessionId/share`; returns `{ success: true, share_token }`, a purpose-bound JWT | `routes/api.ts`, `services/session-share-token.ts` |
| Unshare | `POST /api/session/:sessionId/unshare` | `routes/api.ts` |
| Public read | `GET /session/:shareToken`; backend verifies token purpose/signature and current share generation | `app.ts`, `services/session-share-token.ts` |
| Export body | `{ info, messages: [{ info, parts }] }` | `dos/SessionIngestDO.ts`, `getAllStream()` |

The initial local sharing fixture used flat message exports. The gateway and
fixtures now use the nested export envelope and retain the newer `share_token`
contract. The client checks token transport syntax only; authentication and
revocation remain backend responsibilities.

V2 messages are self-contained. Fork-from-share validates each nested `info`
against the v2 message schema and requires an empty `parts` array. Legacy
transcripts and separate parts are rejected rather than silently dropped. The
import creates new session and message IDs and removes source parent/fork/revert
links before calling the existing host import service. Assistant snapshot
references are also removed: export transfers no snapshot trees, so retaining
source hashes would make destination undo attempt to restore missing trees.

A snapshot upload sends session and message facts only. It does not manufacture
an `idle` status: the exported idle time is a historical watermark, not the
current execution state. Disabling sharing or ingestion prevents new uploads,
but still permits unsharing an existing link.

## Preview controls

The Kilo-owned TUI plugin supplies `/share`, `/unshare`, and
`/fork-from-share` (alias `/fork-share`) through the existing keymap priority
seam. Sharing asks for confirmation before uploading the transcript, tool
output, attachments, and local paths. Fork accepts a public URL/token, imports
into the active project, and navigates to the new session. These controls do
not make the remaining cloud/viewer gates complete.

## Remaining gates

- Verify the target deployment uses the newer token contract and public read
  route. Local fixtures do not establish deployed behavior.
- Update the public viewer for v2 messages. At the audited `origin/main`,
  `apps/web/src/app/s/[sessionId]/shared-transcript.ts` requires
  `message.info.role` to be `user` or `assistant` and renders separate parts.
  V2 uses `type` and self-contained content; the current viewer drops those
  messages even though the ingest storage schema accepts them.
- Preserve team ownership before enabling team sharing. Bootstrap creates
  personal ownership; only a validated `kilo_meta.orgId` claim changes it.
  Current snapshots do not emit that item. Use the actual selected organization
  UUID and its membership policy, not session metadata or a guessed default.
  The preview now rejects sharing when the actual account selection is a team
  or unavailable, before bootstrap or upload. Personal sharing and unsharing
  remain available.
- Implement post-share updates only after the backend contract is settled,
  including transcript removals/reverts and actual execution status. Ingest
  upserts fixed message/part identities; omitted messages are retained, and
  there is no per-item tombstone. Re-uploading a snapshot is not replacement.
  `?v=2` selects lifecycle handling, not an OpenCode v2 transcript schema.
  Session/message-only uploads do not change lifecycle alarms; no synthetic
  `session_open`, `session_close`, or status items are sent to change that.
  Current uploads are explicit snapshots, not continuous synchronization.
- Validate deployed behavior with an intentionally shareable fixture before
  marking the plan's sharing inventory row done.

## Local validation

- Gateway: 30 tests, 232 assertions; package typecheck and lint pass.
- Interactive host integration: 79 assertions, including rejected team sharing
  with zero cloud session calls and a fork that continues in another directory.
- Terminal sharing fixtures: three cases, covering cancel, successful
  transcript import/navigation, and revocation. Existing account/login/branding
  terminal fixtures also pass (three cases).
- CLI package typecheck passes. Runtime tests use the embedded Bun 1.4.0.
- Independent review confirmed the snapshot cleanup and account gate; no
  additional high/medium correctness issue was found in those changes.

These checks use local servers and do not publish real sessions. No Protocol
or Server HttpApi was changed, and no generated client files were edited.
