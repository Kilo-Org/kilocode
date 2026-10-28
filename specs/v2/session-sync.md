<!-- kilocode_change - new file -->

# Native v2 session sync producer

## Scope

The first delivery continuously synchronizes opted-in native v2 CLI sessions to the new cloud service.
It includes persistent change capture, incremental uploads, private assets, retry, and restart recovery.
The CLI remains usable offline.

Mobile viewing, remote commands, legacy import, and ownership handoff are later deliveries of this design.
They are not inactive implementations in the initial producer.

The cloud repository owns service routes, admission, and storage semantics in
[`services/session-sync/README.md`](https://github.com/Kilo-Org/cloud/blob/main/services/session-sync/README.md).
This document owns local capture, lifecycle, portability, and CLI behavior.

## Workspace consent

Synchronization is disabled until the user enables it for a workspace.
Store consent in user-owned local state rather than a repository file that can enable uploads after cloning.
Bind consent to the workspace and selected personal or organization account.
A workspace enable action must identify the destination service and disclose the uploaded content categories.
Organization policy can prohibit synchronization.

Provide commands to enable, disable, inspect, and flush workspace synchronization.
Disabling stops future uploads without deleting the cloud copy.
A local removal and delete-everywhere are separate operations.
Do not overload the existing local delete command with undisclosed remote deletion.

Reuse Kilo's existing credential storage and authentication flow.
Never place credentials in workspace configuration or upload entities.
A local endpoint override supports isolated verification; production transport requires HTTPS.

## Current commands

```sh
kilo2 sync enable --url https://sync.example /absolute/workspace
kilo2 sync status --json /absolute/workspace
kilo2 sync flush --json /absolute/workspace
kilo2 sync disable /absolute/workspace
```

The destination is explicit; no production endpoint is assumed.
For isolated verification, `--local` permits HTTP only on a loopback destination.
The default account scope follows the active Kilo account and organization.
`--organization` selects an explicit organization.

Consent covers the canonical workspace and local descendant directories, not sibling clones or remote workspace drivers.
The producer pins the destination, tenant, account, and source identity.
An account change pauses uploads rather than transferring consent.
Status reports pending changes and a structured error.
Flush exits unsuccessfully if pending work or an error remains.
An unavailable destination does not stop local agent execution.

The initial implementation captures persisted native state, not ephemeral token deltas.
It does not expose remote viewing, control, restore, or handoff commands.

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
Freeze a bounded immutable packet before network transmission.
Keep that packet and its acknowledgement state in durable local storage.
Only clear work covered by the acknowledged packet.
A concurrent newer change must remain dirty.

Do not attach the outbox lifetime to a session-row cascade.
Local deletion, schema maintenance, or event-log cleanup must not silently erase unacknowledged synchronization intent.
Migrations distinguish a legitimate portable-state change from a local storage reset.
A restored database must not reuse an acknowledged position for different content.

## Portable entity set

| Kind | Captured state |
|---|---|
| `session` | Encoded native session metadata and settings, excluding active machine bindings. |
| `message` | Native transcript messages with stable identity and ordering. |
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
Retry network failures and retryable service responses with bounded backoff.
Do not discard work after a fixed number of attempts.
Refresh expired grants without changing packet identity.
Surface invalid credentials, rejected ownership, deletion, and quota errors distinctly.

A different source cannot silently take over an existing session.
If local state rolls back behind a committed cloud position, park synchronization and report the conflict.
Do not overwrite the cloud with an older snapshot.

## Incremental content and assets

Do not serialize a growing assistant message after every token.
The initial delivery captures persistent native state and periodic checkpoints.
Fine-grained watched delivery extends capture with bounded content chunks, not whole-message replacements.
An append names its content generation and expected offset.
An edit or replacement invalidates obsolete append targets.

Upload assets outside the state transaction and verify their content hashes.
Upload required blobs before admitting their references.
Pin temporary local files until the service acknowledges them.
If an asset is already unavailable, report it; never claim full portability.

Native message JSON remains unchanged.
Separate asset entities map a native JSON pointer to verified portable bytes.
Inline native attachments carry their own bytes.
The host records provenance for files allocated by native tool-output handling.
A transcript path alone never authorizes a filesystem read, even inside an opted-in workspace.

For a legacy file without native provenance, approve that exact regular file explicitly:

```sh
kilo2 sync enable --url https://sync.example --allow-asset /absolute/legacy-output.txt /absolute/workspace
```

Repeat `--allow-asset` for each file.
Approval pins the current bytes; it does not authorize future replacements or directory contents.
Missing, changed, oversized, symbolic-link, and special-file assets pause synchronization visibly.
Required bytes must fit the service blob bound.
The command does not silently upload an incomplete portable entity.

Local spooling retains only bytes that a pending packet, current portable entity, exact approval, or active preparation pin requires.
Bytes for superseded acknowledged generations become reclaimable.
Cleanup rechecks every durable pin inside a short database transaction before moving a candidate aside; deletion happens after commit.
Before the first enable, native output records metadata only and does not read file contents.
Unreferenced provenance metadata is bounded by a seven-day age and a 4096-path cap.
After that metadata expires, an earlier output requires explicit exact-file approval.

Each request deadline scales with body size and has a five-minute cap.
A background pass can run for six minutes; an explicit flush keeps its shorter command deadline.
Packet-scoped blob acknowledgements let an interrupted large packet resume without retransmitting uploaded blobs.
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
Enabling synchronization includes existing sessions in the selected workspace.
A scan establishes initial state; transactional capture covers changes during the scan.
Maintain a bounded pending packet rather than loading an entire workspace into memory.

A graceful exit attempts a bounded drain but correctness does not depend on shutdown hooks.
An abrupt exit retains recoverable work on disk.

## Future viewing and control

A remote client persists its projection and applied cursor atomically.
It loads recent content first, pages history, and resumes from a service cursor.
An expired cursor causes an explicit reset.
Background mobile behavior uses notifications rather than a promise of a permanent socket.

Remote prompts use a durable command ID and a runner receipt ledger outside revert-pruned history.
Cloud-queued, runner-admitted, and model-delivered are distinct states.
Offline prompts retain visible expiry.
Cancel and approval replies bind to their exact run or request and runner incarnation.
Permission replies support allow-once and reject, not persistent workspace grants.
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
