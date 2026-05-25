# Session Export Replay Optimizations Design

## Goal

Make the session-export payload easier for downstream offline jobs to parse and replay without adding service-side processing or compatibility layers.

## Scope

Implement four sender-side wire-format improvements:

- Add a persistent per-session `eventSeq` that does not reset between CLI processes.
- Add `turnId` where the sender already has a cheap user-turn identifier.
- Serialize uploaded zstd chunks as base64 strings instead of JSON numeric byte objects.
- Add baseline capture completeness metadata from the existing workspace scanner.

Skip session manifests, duplicated R2 metadata in the body, first-class snapshot objects, delta before/after hashes, sub-format schema versions, replay checkpoint events, and normalized alternate payloads.

## Design

`eventSeq` is generated in the CLI process using the existing session-export SQLite database. A new small sequencer table stores the next sequence number by `sessionId`, so a later `kilo run --session ...` continues after the previous process. Existing `seq` remains equal to `eventSeq` for the current uploader and service headers.

`turnId` is the existing user message id. `llm_request_started` already receives this id, and follow-up model calls after tool results keep the same user message id in normal session execution. Capture stores the current turn id per session so tool events and filesystem deltas can attach to the same turn when available.

Chunks remain internally stored as zstd blobs in SQLite, but the uploaded batch JSON serializes each chunk as `{ id, bytes: "<base64>", size, encoding: "zstd+base64" }`. This keeps the service dumb while avoiding numeric JSON byte objects.

Baseline completeness metadata is attached to `workspace_baseline_completed` as `capture`. It includes the capture root, capture mode, file count, total byte count, omitted counts by reason, and whether the baseline was truncated.

## Verification

Unit tests cover the sequencer, turn id propagation, base64 upload chunks, and baseline capture metadata. The existing session-export worker and capture tests remain the regression suite for upload behavior.
