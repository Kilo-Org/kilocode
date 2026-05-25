# Session Export Replay Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cheap sender-side payload improvements for downstream replay and parsing.

**Architecture:** Keep all behavior in `packages/opencode/src/kilocode/session-export/`. The CLI assigns persistent per-session event sequence numbers, capture attaches turn ids to related events, the worker uploads base64 zstd chunks, and the workspace provider reports baseline completeness metadata.

**Tech Stack:** Bun, TypeScript, Bun SQLite, existing session-export worker/storage/uploader tests.

---

### Task 1: Persistent Event Sequence

**Files:**
- Create: `packages/opencode/src/kilocode/session-export/sequence.ts`
- Modify: `packages/opencode/src/kilocode/session-export/session-export.ts`
- Modify: `packages/opencode/src/kilocode/session-export/envelope.ts`
- Test: `packages/opencode/test/kilocode/session-export/sequence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `sequence.test.ts` with a test that creates a sequencer on a temp SQLite path, calls `next("s1")` twice, closes it, creates a new sequencer on the same path, and expects `next("s1")` to return `2`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test ./test/kilocode/session-export/sequence.test.ts` from `packages/opencode/`.

- [ ] **Step 3: Implement the sequencer**

Add `createSequencer(dbPath)` using Bun SQLite with table `session_export_sequence(session_id TEXT PRIMARY KEY, next INTEGER NOT NULL)`. `next(sessionId)` must atomically return the current value and increment it.

- [ ] **Step 4: Wire it into session export**

In `session-export.ts`, default `syncSeq` to `sequencer.next(sessionId)` and close the sequencer during `shutdown()`. Update the `syncSeq` type to accept `sessionId`. Add `eventSeq` to `ExportEnvelope` and set it equal to `seq` in all created envelopes.

- [ ] **Step 5: Run targeted tests**

Run: `bun test ./test/kilocode/session-export/sequence.test.ts ./test/kilocode/session-export/capture.test.ts ./test/kilocode/session-export/worker/uploader.test.ts`.

### Task 2: Cheap Turn Id Propagation

**Files:**
- Modify: `packages/opencode/src/kilocode/session-export/events.ts`
- Modify: `packages/opencode/src/kilocode/session-export/capture.ts`
- Modify: `packages/opencode/src/kilocode/session-export/sync-subscriber.ts`
- Test: `packages/opencode/test/kilocode/session-export/capture.test.ts`
- Test: `packages/opencode/test/kilocode/session-export/sync-subscriber.test.ts`

- [ ] **Step 1: Write failing tests**

Add a capture test proving `llm_request_started`, `llm_request_completed`, and `workspace_delta_captured` carry `turnId: "u1"`. Add a sync subscriber test proving `tool_executed` and `terminal_outcome` use `getTurnId(sessionId)`.

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test ./test/kilocode/session-export/capture.test.ts -t turnId` and `bun test ./test/kilocode/session-export/sync-subscriber.test.ts -t turnId`.

- [ ] **Step 3: Implement turn id propagation**

Use `userMessageId` as the cheap `turnId`. Store the current turn per session in `Capture`. Pass `getTurnId` into `SyncSubscriber` from `session-export.ts`. Attach `turnId` to all eligible events when available.

- [ ] **Step 4: Run targeted tests**

Run: `bun test ./test/kilocode/session-export/capture.test.ts ./test/kilocode/session-export/sync-subscriber.test.ts`.

### Task 3: Base64 Uploaded Chunks

**Files:**
- Modify: `packages/opencode/src/kilocode/session-export/envelope.ts`
- Modify: `packages/opencode/src/kilocode/session-export/worker/uploader.ts`
- Test: `packages/opencode/test/kilocode/session-export/worker/uploader.test.ts`

- [ ] **Step 1: Write failing test**

Add an uploader test that inserts a chunk-referencing event, runs `flush()`, parses the uploaded body, and expects `chunks[0].bytes` to be a base64 string and `chunks[0].encoding` to be `"zstd+base64"`.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test ./test/kilocode/session-export/worker/uploader.test.ts -t base64`.

- [ ] **Step 3: Implement upload serialization**

Keep storage unchanged. In `Uploader.flush`, map storage chunks to upload chunks with `Buffer.from(chunk.bytes).toString("base64")` and `encoding: "zstd+base64"`.

- [ ] **Step 4: Run targeted tests**

Run: `bun test ./test/kilocode/session-export/worker/uploader.test.ts ./test/kilocode/session-export/worker/chunks.test.ts`.

### Task 4: Baseline Completeness Metadata

**Files:**
- Modify: `packages/opencode/src/kilocode/session-export/events.ts`
- Modify: `packages/opencode/src/kilocode/session-export/workspace-provider.ts`
- Modify: `packages/opencode/src/kilocode/session-export/workspace-fiber.ts`
- Test: `packages/opencode/test/kilocode/session-export/workspace-provider.test.ts`
- Test: `packages/opencode/test/kilocode/session-export/workspace-fiber.test.ts`

- [ ] **Step 1: Write failing tests**

Add a workspace provider test expecting `baseline.capture` to include `root`, `mode`, `fileCount`, `totalBytes`, `omittedCountsByReason`, and `truncated: false`. Add a workspace fiber test proving the metadata appears on `workspace_baseline_completed`.

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test ./test/kilocode/session-export/workspace-provider.test.ts -t capture` and `bun test ./test/kilocode/session-export/workspace-fiber.test.ts -t capture`.

- [ ] **Step 3: Implement metadata**

Have the provider return `capture` from `baseline()`. Compute mode from git detection, file count from captured entries, total bytes from sizes, omitted counts by reason from file omissions, and `truncated: false`. Pass the metadata through `startBaselineFiber`.

- [ ] **Step 4: Run targeted tests**

Run: `bun test ./test/kilocode/session-export/workspace-provider.test.ts ./test/kilocode/session-export/workspace-fiber.test.ts`.

### Task 5: Final Verification

**Files:**
- Verify all modified session-export files.

- [ ] **Step 1: Run focused suite**

Run from `packages/opencode/`:

```bash
bun test ./test/kilocode/session-export/sequence.test.ts ./test/kilocode/session-export/capture.test.ts ./test/kilocode/session-export/sync-subscriber.test.ts ./test/kilocode/session-export/worker/uploader.test.ts ./test/kilocode/session-export/worker/chunks.test.ts ./test/kilocode/session-export/workspace-provider.test.ts ./test/kilocode/session-export/workspace-fiber.test.ts ./test/kilocode/session-export/e2e.test.ts ./test/kilocode/session-export/worker.test.ts
```

- [ ] **Step 2: Run typecheck if targeted suite passes**

Run from `packages/opencode/`: `bun run typecheck`.

- [ ] **Step 3: Commit**

Commit the implementation and unit tests with `feat(cli): optimize session export replay payloads`.
