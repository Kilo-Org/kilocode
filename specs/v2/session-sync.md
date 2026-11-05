<!-- kilocode_change - new file -->

# Native v2 session sync producer

## Scope

Native v2 CLI sessions synchronize to Kilo by default while the user is signed in.
It includes persistent change capture, incremental uploads, private assets, retry, and restart recovery.
The CLI remains usable offline.

Native remote viewing and control use a separate ephemeral live relay and durable opaque command mailbox.
Legacy import and ownership handoff remain separate deliveries.

The cloud repository owns service routes, admission, and storage semantics in
[`services/session-sync/README.md`](https://github.com/Kilo-Org/cloud/blob/main/services/session-sync/README.md).
This document owns local capture, lifecycle, portability, and CLI behavior.

## Global setting and workspace enrollment

Session sync defaults to on and uses the fixed Kilo service at `https://session-sync.kiloapps.io`.
There is no user-facing destination flag, configuration setting, or environment override.
Signed-in users' native local workspaces enroll automatically at startup, status, and background passes.
Remote workspace drivers are not enrolled.
Each enrollment pins the service destination, personal or organization tenant, user, and source identity.
An account switch pauses a pinned workspace instead of transferring its enrollment or uploading under the new account.
Organization policy can prohibit synchronization.

To turn sync off for all workspaces, set the global-only `session_sync` setting in the global
Kilo config directory's `kilo2.jsonc` (normally `~/.config/kilo2/kilo2.jsonc`):

```jsonc
{
  "session_sync": false
}
```

Global `kilo2.json` is read first, then `kilo2.jsonc`; the last setting wins.
Workspace config cannot enable or disable sync.
Atomic setting replacement makes up to eight attempts for transient file-sharing errors, with at most 700 ms of backoff.
If a reader still denies replacement, the command returns a retryable `settings_unavailable` error and leaves the original file intact; it never truncates the file in place.
Setting false or signing out pauses journal capture and network activity, keeping the cloud copy and pending local work.
Set it back to true (or use `sync enable`) to resume; untouched messages, including completed history from the pause, are not recaptured.
Transport and grant-refresh outages retain enrolled workspace capture and pending changes.
Enrollment runs in the host background scope; starting the CLI never waits for the sync destination.
Sync includes sessions you create or continue after sync is on; it does not bootstrap untouched existing history.
The first native write to an existing session after enrollment enrolls that session and uploads its snapshot, including historical content.
Untouched history stays local; there is no history-backfill command.

Sync uploads persisted transcripts, pending input, API-managed instructions, and required attachment and tool-output assets.
Credentials, environment variables, execution claims, and process-local handles are excluded.
Native owned assets are included; legacy external files require explicit exact-file approval.
Local removal and delete-everywhere remain separate operations.
Reuse Kilo's existing credential storage and authentication flow; never upload credentials.
Tests inject an isolated peer through the service constructor, not a CLI flag, config, or environment variable.

## Current commands

```sh
kilo2 sync enable /absolute/workspace
kilo2 sync status --json /absolute/workspace
kilo2 sync flush --json /absolute/workspace
kilo2 sync disable /absolute/workspace
```

`enable` and `disable` persist the global setting for all workspaces without deleting cloud state.
Their optional directory selects the workspace whose status is returned; it does not narrow the setting.
`status` and `flush` remain workspace operations.
New enrollment follows the active Kilo account and organization resolved by the Gateway.
A provisional Personal selection never enrolls a workspace: sync waits for the profile to confirm Personal or resolve the default organization.
`enable --organization` must match that active selection; select a different organization in the Gateway first.
An account or organization switch pauses existing pinned workspaces instead of reassigning their history.
`enable --allow-asset` records explicit exact-file legacy approvals for the selected workspace.

Enrollment covers the canonical workspace and local descendant directories, not sibling clones or remote workspace drivers.
A descendant's more-specific enrollment remains its own boundary.
Native asset provenance cannot cross that boundary through a parent session; an external file requires exact-file approval.
Status reports pending changes and a structured error.
Flush exits unsuccessfully if pending work or an error remains.
An unavailable destination does not stop local agent execution.

Durable capture remains independent of ephemeral live events and remote control.
Offline operation and authoritative synchronized snapshots do not depend on a live socket.

## Capture boundary

Native event replay is not a complete capture mechanism.
The local bus does not retain event payloads by default.
Streaming deltas are ephemeral, and some portable state changes directly in storage.
Fork and import also create rows without a complete replayable event prefix.

Capture the portable state boundary in the same SQLite transaction as each persistent change.
Use an explicit allowlist of tables and columns.
Capture direct instruction writes, forks, imports, edits, inbox changes, and semantic removals.
Do not require retention of the complete internal event log merely to synchronize state.

A coalescing dirty set records entity identity and source position.
Unsent changes to the same entity can collapse to the newest value.
Assistant messages with persisted native parts use a body-free message envelope and independent `message-part` entities.
Every value is materialized with its source position in the native write transaction; no lazy full-message read can
accidentally include a later out-of-scope write. Ordinary part updates never read or serialize all other part bodies.
Read dirty identities first and materialize values incrementally within the packet byte budget.
One oversized released part can be read alone for externalization; do not stage a page of oversized values.
Local deletion and excluded mutations retain captured snapshots. A resumed message's first write reconciles its current parts and missing IDs once; body-free identity inventory survives ACK/restart, and re-enabling alone never recaptures history.
Freeze a bounded immutable packet before network transmission.
Keep that packet and its acknowledgement state in durable local storage.
Only clear work covered by the acknowledged packet.
A concurrent newer change must remain dirty.
Concurrent local producers may advance that acknowledgement while another upload is in flight.
A stale pass cannot park the newer receipt or reinterpret its next immutable packet as a conflicting predecessor.

Do not attach the outbox lifetime to a session-row cascade.
Local deletion, schema maintenance, or event-log cleanup must not silently erase unacknowledged synchronization intent.
Migrations distinguish a legitimate portable-state change from a local storage reset.
A restored database must not reuse an acknowledged position for different content.

## Portable entity set

| Kind | Captured state |
|---|---|
| `session` | Encoded native session metadata and settings, excluding active machine bindings. |
| `message` | Native transcript messages with stable identity and ordering; split assistants carry a body-free envelope. |
| `message-part` | One persisted assistant part, addressed by `<messageID>/<ordinal>`, or an explicit deferred placeholder. |
| `inbox` | Pending input needed to reconstruct the session. |
| `instruction-entry` | API-managed instruction values and observed removals. |
| `instruction-state` | Current and epoch-initial instruction state. |
| `instruction-blob` | Referenced immutable instruction values. |
| `asset` | Durable references and metadata for required attachment and tool-output bytes. |

Normalize local references through an explicit asset mapping.
Recorded paths are display information, not authority to read another machine's files.
Do not synchronize credentials, environment variables, execution claims, or process-local handles.

Retain provider replay data where required.
Its presence does not guarantee reuse with another provider credential or runtime.
A destination can need to rebuild model context from preserved history.

## Source positions and retries

Native message order, internal event sequence, and sync source position are distinct values.
Allocate source positions within the capture transaction.
A batch names its source, immutable batch ID, predecessor, covered position, and changes.
Positions can be sparse after coalescing.
Every captured entity change in the covered range must be represented or superseded explicitly.

The cloud accepts a batch only against the expected predecessor and source binding.
A successful response means the batch is durably committed.
A socket write or scheduled background task is not success.

Recover the pending packet after process death and retry with the same identity and payload.
Read cloud state before the first packet in each process and after errors or acknowledgement-history changes.
Successful receipts verify subsequent packets for the same session, destination, account, source, and local predecessor.
Keep at most 256 process-local verifications, evicting the least recently acknowledged session first.
Reconciliation drops verifications for deleted or out-of-scope sessions; eviction only requires another state read.
Steady-state packets post directly; the service still checks ownership, deletion, source, predecessor, and exact-body replay.
Batch conflicts and superseded packets return to state recovery without replacing retained packet bytes.
Retry network failures and retryable service responses with capped exponential full jitter.
Treat JSON `retryAt` and HTTP 429/503 `Retry-After` seconds or dates as lower bounds, then add jitter.
Exchange failures share a durable destination, organization, and credential-fingerprint cooldown across sessions and restarts.
Enable and sessions outside the failed pass consult the same cooldown; a different credential has its own identity.
Session retry deadlines carry their credential fingerprint, so a refreshed credential does not inherit another credential's outage.
Keep a received retry deadline even when the response body fails.
Explicit flush does not bypass server retry deadlines.
`rate_limited` is retryable HTTP 429 with an integer-seconds `Retry-After` header and JSON `error.retryAt`.
`tenant_unavailable` is retryable HTTP 503 with `Retry-After` and JSON `error.retryAt`.
`service_overloaded` is retryable HTTP 503 with `Retry-After: 3` and JSON `error.retryAt`.
It follows the same durable server-deadline and jittered-backoff path; cloud overload does not trigger immediate reconciliation.
`tenant_budget_exceeded` is HTTP 413 with `error.details` containing the `sessions` and `bytes` limits.
It pauses the session until enable or flush retries it.
State, entity, blob-read, and batch requests use a per-session in-memory budget of 1200 requests per minute.
A user-level binding grants ten prepaid request credits per call, with 120 blocks per minute.
Credits expire at the end of the current minute window; registration, blob PUT, and deletion keep direct binding admission.
Metrics use declared content lengths without wrapping known-length bodies.
Known-length responses record service latency when ready; unknown-length streams record transferred bytes on completion or cancellation.
Do not discard work after a fixed number of attempts.
Refresh expired grants without changing packet identity.
Surface invalid credentials, rejected ownership, deletion, and quota errors distinctly.

A different source cannot silently take over an existing session.
If local state rolls back behind a committed cloud position, park synchronization and report the conflict.
Do not overwrite the cloud with an older snapshot.

## Incremental content and assets

### Assistant parts and completeness

A split assistant `message` value is `{seq,message,parts:{count,through}}`: `message` is the native encoded
assistant object with only `content` removed. `through` is this envelope's dirty source position.
A `message-part` value is `{messageID,ordinal,position,part}`; `part` is the unchanged native encoded part
and `position` is its own dirty source position. Its entity ID is `<messageID>/<ordinal>`.
Capture the changed part (and any newly released predecessor) before the envelope.
The message's `seq` orders messages; numeric native ordinals order parts, never lexicographic entity IDs.
An assistant with no native part rows keeps its exact legacy inline message content; removing the last
native part restores that inline fallback. Opaque native/provider fields remain intact.

Active trailing text/reasoning is represented by `{messageID,ordinal,position,deferred:true}`, without its
mutable body. A new higher ordinal releases the preceding trailing text/reasoning; assistant
`time.completed` releases the current trailing text/reasoning. Tool bodies remain deferred until their
state is `completed` or `error`, even if another ordinal already exists.
Direct edits to released parts still recapture their exact current native value.
Deferred entities are explicit incomplete data, not silently suppressed updates or a complete transcript.
An interrupted/deleted unfinished message can therefore retain an incomplete snapshot.
This bounds ordinary streaming uploads to envelope/placeholder metadata plus each settled body, rather
than repeatedly uploading a large mutable text or tool body as a new content-addressed blob.

Readers must obtain all pages at one cloud revision, resolve entity blobs, and use the `position`
returned on those pages (not a later state request). A split message is complete only when source position is at least `parts.through`,
the number of matching part entities equals `parts.count`, all ordinals are unique, no part position
exceeds `parts.through`, and no part is deferred. Otherwise retry a fresh revision-consistent snapshot
or show an explicit incomplete state. Never join pages from different revisions or infer completion
from count alone. `reconstructMessage` in the producer protocol implements this rule and restores the
native `{seq,message}` object without changing opaque values.
Ordinary native part removal/reordering uses semantic cause `part-removed`; semantic revert preserves
`revert`. Removing a part also removes its obsolete asset mappings in the same packet.
Changing a native message to a non-assistant type or removing its content field also tombstones
its previously split part entities and their asset mappings. Returning to a split assistant
recaptures the retained native part rows.

The default-on producer is merged but not released, and the service namespaces held zero sessions
before this protocol change. This is a clean wire change, with no migration or dual-format aliases.

Inline values are limited to 64 KiB, 8192 JSON nodes, and 64 nested containers. Every value/container
and object key counts as a node; keys add no depth. Wider/deeper native JSON is externalized as a
content-addressed entity blob even below 64 KiB. Packets remain within 512 KiB, 64 changes, 32768
JSON nodes including protocol metadata, and 67 nested containers. Preparation splits by both bytes
and nodes, leaving bounded headroom for the outer packet; it never sends a valid native value into
a permanent inline JSON-budget rejection.

Upload assets outside the state transaction and verify their content hashes.
Upload required blobs before admitting their references.
Pin temporary local files until the service acknowledges them.
If an asset is already unavailable, report it; never claim full portability.

Native message JSON remains unchanged.
Separate asset entities map a native JSON pointer to verified portable bytes.
Removing an attachment or its owning portable entity removes the obsolete asset mappings in the same packet.
Cloud blobs move through `pending`, `unreferenced`, `ready`, and `cleaning`.
Verified uploads that have never been referenced remain unreferenced for fifteen minutes.
A hash that loses its last entity reference after a batch becomes unreferenced with a deadline of now.
The sweep can reclaim it after its safety margin; a reference in the same batch keeps it ready.
References make unreferenced blobs ready.
A reference to an absent, pending, or cleaning hash returns HTTP 409 `blob_missing` with `error.details.hash`.
Beginning an unreferenced upload refreshes its deadline and returns ready without another upload.
Reads serve both ready and unreferenced blobs.
Readers that receive `blob_not_found` for a superseded hash re-read session state before retrying.
Inline native attachments carry their own bytes.
Database-backed native `media:` attachments require session-owned native blob references.
Their verified bytes receive durable asset mappings without rewriting the original message JSON.
The host records provenance for files allocated by native tool-output handling.
A transcript path alone never authorizes a filesystem read, even inside an opted-in workspace.

For a legacy file without native provenance, approve that exact regular file explicitly:

```sh
kilo2 sync enable --allow-asset /absolute/legacy-output.txt /absolute/workspace
```

Repeat `--allow-asset` for each file.
Approval pins the current bytes; it does not authorize future replacements or directory contents.
Missing, changed, oversized, symbolic-link, and special-file assets pause synchronization visibly.
Required bytes must fit the service blob bound.
The command does not silently upload an incomplete portable entity.

Local spooling retains only bytes that a pending packet, current portable entity, exact approval, or active preparation pin requires.
Bytes for superseded acknowledged generations become reclaimable.
Cleanup rechecks every durable pin inside a short database transaction before moving a candidate aside; deletion happens after commit.
Global cleanup runs at startup, enable, and at most once per minute during background passes.
Acknowledgement cleanup visits only the acknowledged session and retains its packets and preparation pins.
Only successful cleanup advances its throttle; a cleanup failure preserves enabled consent and reports a retryable background error.
While sync is off or signed out, native output records metadata only and does not read file contents for sync.
Unreferenced provenance metadata is bounded by a seven-day age and a 4096-path cap.
After that metadata expires, an earlier output requires explicit exact-file approval.

Each request deadline scales with body size and has a five-minute cap.
A background pass can run for six minutes; an explicit flush keeps its shorter command deadline.
Persist session/hash/length blob acknowledgements across packets and process restarts.
Keep only the newest 256 hints per session; eviction is safe because a missing hint causes another upload.
Disabling sync or deleting a local session clears its hints without discarding pending packet bytes.
This knowledge is a hint: `blob_missing` with `details.hash` drops that hint and retries the upload.
Persist last-attempt ordering so continuously dirty sessions cannot starve waiting sessions.
A pass uploads at most four different sessions concurrently, with one immutable packet per session.
Consent changes use a durable epoch, so a concurrent disable in another local process fences an enable that has not committed.

Keep live text, controls, and metadata separate from bulk transfer scheduling.
A historical import or large attachment must not create an unbounded foreground queue.
A cloud quota failure pauses synchronization visibly while local execution can continue.
Local storage remains finite; never silently delete unacknowledged required assets to conceal pressure.

## Lifecycle

Initialize capture through Kilo-owned host composition before the runner mutates portable state.
Do not start a second native runtime merely to upload sessions.
Keep the uploader in the host scope and release it with that scope.
Use existing filesystem, database, credential, and Effect conventions.
Minimize changes to shared upstream services.

The source identity persists across normal restarts.
Consent changes take effect without requiring an unrelated session mutation.
Default workspace enrollment records the capture boundary without scanning existing sessions into the journal.
Sessions created or first written after enrollment enter incremental synchronization.
For an existing session, that first native write enrolls its full snapshot, including earlier historical content.
Re-enabling preserves the journal cursor and does not recapture completed history from the pause.
Journal new sessions, local deletions, directory or workspace moves, and consent changes transactionally to request reconciliation.
Idle passes skip directory scans until that journal changes or a sixty-second safety interval expires.
While the global setting is off or the user is signed out, passes skip journal capture, reconciliation, and network activity.
Startup, status, and background passes enroll eligible native local workspaces for the signed-in user.
Startup and enable reconcile enrolled workspaces before relying on incremental capture.
Maintain a bounded pending packet rather than loading an entire workspace into memory.

A graceful exit attempts a bounded drain but correctness does not depend on shutdown hooks.
An abrupt exit retains recoverable work on disk.

## Native remote viewing and control

`kilo2 remote` starts a private headless host, advertises kind `remote`, and waits until a signal.
It requires Kilo sign-in and synchronization. It never enables control on an unrelated background daemon.
The launch directory is the boundary for new sessions and directory discovery; canonical paths reject symlink escapes.
`create_session` accepts optional directory, title, agent, model, variant and matching organization.
An organization argument cannot change the active signed-in organization.

Ordinary processes default to control disabled. `/remote` toggles it and shows a header indicator.
`remote_control: true` in global `kilo2.jsonc` or `KILO_REMOTE=1` enables control at startup.
The authenticated local API exposes `GET /remote/status`, `POST /remote/enable` and `POST /remote/disable`.
Each returns `{enabled, connected}`; repeated enable/disable calls are idempotent.

Signed-in processes with sync on keep one presence socket, independently of control acceptance.
Only sessions created or continued in this process are advertised as live; untouched synchronized history is not.
Ownership and relay sockets are bounded to the 100-session presence advertisement limit.
New activity evicts the least-recently active unwatched session; identity changes clear process ownership.
Native text/reasoning deltas, part/tool updates, permission/question requests and execution lifecycle events
are published only while a viewer watches the session, including when remote control is disabled.
Runner event bodies are `{version:1,syncPosition,sourceID,incarnation,runID?,data}`.
`data` is the native bus envelope, or the command outcome for `command.outcome`.
The sync position identifies the local durable capture boundary, not the relay sequence or server receipt.
On each watch/re-watch and runner reconnect, and whenever run or pending-request state changes, the runner emits
`remote.state` with `{version:1,syncPosition,sourceID,incarnation,runID:null|string,running:boolean,pending:{permissions:[{requestID,tool,summary}],questions:[{requestID,fields}]}}`.
This inventory replaces the viewer's pending state; `fields` retain native form keys and schemas.
`runID` is the opaque durable execution-start event ID, never a timestamp; idle state uses null.
The initial state follows relay hello even if the watch arrived before the session socket connected.

Instance commands are `create_session`, `list_directories`, `list_models` and `list_agents`.
Session commands are `send_message`, `interrupt`, `drop_queued_message`, `permission_respond`,
`question_reply`, `question_reject`, `send_command`, `list_commands`, `list_models`, `list_agents`,
`detach` and `session.renamed`.
There is no clone/fork-at-message, suggestion or pull-request-link command because this native surface has no equivalent.
`send_message` accepts native queue/steer delivery; its command ID is durably admitted before acknowledgement.
Interrupt and permission/question responses require `liveOnly:true`, the current runner incarnation and run ID.
Permission/question request IDs must belong to that running session.
Slash dispatch allows only `/compact`, `/new` in the same workspace, `/skill <ID>`, `/models` and `/agents`.
All other commands produce a visible failed `command.outcome`, never arbitrary shell or command execution.
Outcomes are `{commandID,status,result?,error?,duplicate?,identity?}`; `status` is `succeeded`, `failed` or `unknown`.
The SQLite receipt ledger prevents re-execution of a retried command ID, including after process restart.
An uncertain admitted operation is reported unknown rather than repeating possible external effects.

Tickets are carried in Authorization Bearer headers, never query strings.
Fresh tickets renew at `reauthAt` before expiry; account/sync changes close transport without changing enrollment.
Reconnects respect server hints and add jitter. Session-runner close 4009 is terminal for that session;
presence close 4009 may retry. Relay loss never changes durable sync authority.

A remote client persists its projection and applied cursor atomically.
It loads recent content first, pages history, and resumes from a service cursor.
An expired cursor causes an explicit reset.
Background mobile behavior uses notifications rather than a promise of a permanent socket.

Remote prompts use a durable command ID and a runner receipt ledger outside revert-pruned history.
Cloud-queued, runner-admitted, and model-delivered are distinct states.
Offline prompts retain visible expiry.
Cancel and approval replies bind to their exact run or request and runner incarnation.
Permission replies use native once/always/reject policy; request and run validation precedes any reply.
Do not replay uncertain external tool effects automatically.

Default continuation elsewhere creates a fork from verified portable state.
A same-identity move requires the old owner to stop and flush an agreed checkpoint.
A disconnected old process can still execute tools; a cloud fence cannot stop it.

## Verification

Exercise a real native CLI and the real Worker against isolated local storage and synthetic authentication.
Verify the uploaded transcript and required portable entities through the service read API.
Disconnect the service, mutate the session, restart the producer, and confirm eventual convergence.
Interrupt acknowledgement delivery and prove the packet applies once.
Mutate an entity during upload and prove its newer state remains pending.
Verify workspace exclusion, ownership conflict, cross-account isolation, and asset integrity.
Verify that local removal does not become an implicit remote delete.

The synthetic scale target is 100,000 concurrently streaming sessions.
Watched healthy regional paths target source-commit-to-foreground-apply p95 at or below 250 ms.
Report intercontinental paths separately.
Measure emission-to-apply too, so batching delay remains visible.
The initial ingestion implementation does not establish these capacity claims.

Compare per-session storage and regional packed commits under the same correctness requirements.
Choose the physical layout and fleet cost ceiling from measurements before production-scale rollout.
