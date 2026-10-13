# External resume parity (v2)

Validated against the pinned v2 baseline `76dbaf20adbd43fd208a00ef3cda4a51e125a234` and the local Kilo `origin/main` snapshot `f7115470740c51fd4200fedd9ad3edfad60589ce` on 2026-09-05. The source implementation audited here is Kilo main commit `e87dc77b73` (`feat(cli): resume Claude and Codex sessions`) plus the import endpoint added by `b59ebd7bbd` (`feat(cli): import Claude Code and Codex transcripts via a session-resume endpoint`).

## Scope

The v2 capability is an explicit local-file adapter in `packages/kilo-cli/src/resume-external.ts`:

- `import-external <file> --model provider/model --agent name` reads one caller-supplied Claude or Codex JSONL file.
- It resolves the target location through the public client, creates a fresh v2 session ID, and calls the public session-import endpoint.
- It does not discover or read ambient `~/.claude` or `~/.codex` history, write to the source transcript, start execution during import, or depend on private Core/Server APIs.
- Import is format-specific and bounded to Claude major 2 and Codex major 0.

The v1 implementation has additional user-visible workflows that are intentionally not claimed here:

| v1 behavior | v2 status | Reason |
|---|---|---|
| `/resume-claude` and `/resume-codex` ambient discovery by current project | gap | v2 does not read provider home directories or infer a source root |
| Interactive picker and source migration markers | gap | v2 has an explicit list/ID backend but no chooser or source deduplication marker |
| Import into an existing empty session through the v1 session service | gap | v2 uses public `session.import` and always mints a fresh session |
| Unsupported blocks represented as visible dropped markers/notices | intentionally stricter | v2 rejects opaque or lossy structures before import |
| Incomplete tool calls | supported with explicit error state | the tool remains in history with `status: incomplete`; no call is silently dropped |
| Explicit-directory list and ID selection | supported subset | `external-sessions.ts` requires an absolute caller-supplied directory and applies v1 filename rules without provider defaults |

## Proven common records

The Kilo fixtures under `packages/kilo-cli/test/fixtures/external/` are synthetic, non-user data tied to the audited v1 envelope shapes. They cover the common records that v1's source fixtures exercise without copying real provider history.

| Format | Accepted records | Preserved fields |
|---|---|---|
| Claude v2 | `user`, `assistant`, `thinking`, `text`, `tool_use`, `tool_result`; `ai-title`, `last-prompt`, `snapshot`, `mode`, `permission-mode`, and `attachment` metadata; sidechain records | transcript text, readable reasoning, tool IDs/names/JSON inputs, tool output text, error flags, source model, reasoning signatures, format/version |
| Codex 0 | `session_meta`, `response_item` message/function/custom-tool/reasoning records; `turn_context`, `event_msg`, and `world_state` metadata | input/output text, readable reasoning summaries, tool IDs/names/JSON inputs, output text, source status, source session ID, provider/model, format/version |

Provider reasoning signatures are retained under assistant message metadata as provenance only. They are not sent back as replayable provider state. Source tool status is retained under tool-state metadata; failed and incomplete results become explicit v2 error states.

The adapter rejects unsupported content, encrypted-only reasoning, malformed records, unknown tool outputs, duplicate tool outputs, mixed formats, unsupported major versions, and inconsistent source session/model identity. This keeps a source field from being silently discarded. The target continuation model is used for assistant history only when the source transcript contains no model; no `unknown/unknown` provenance is fabricated.

## Explicit-directory selection

`listExternalSessions({ directory, source, limit })` and `selectExternalSession({ directory, source, id })` are the non-ambient discovery boundary. They require an absolute directory supplied by the caller and never consult `HOME`, `~/.claude`, `~/.codex`, or a current-working-directory default. Claude scans only direct regular files named `<UUID>.jsonl`; Codex scans regular files recursively whose names match `rollout-…-<UUID>.jsonl`, matching the v1 picker’s accepted source names. The default list is ten entries, Claude is ordered by file modification time, and Codex by the rollout timestamp in the filename. Selection rescans the complete explicit directory, so an older ID outside the display window remains selectable.

The audited v1 implementation scopes Claude to `<provider-root>/<cwd-slug>` and filters Codex’s ambient root scan by the first `session_meta.payload.cwd`; its picker then offers at most ten UUID labels. The explicit v2 API makes the source directory itself the caller-visible scope, because inferring a provider root or silently applying the target project’s `cwd` would violate the no-ambient-read boundary.

Each candidate is parsed through the same bounded converter used by import. Malformed, unsupported, wrong-format, or oversized candidates remain visible as `valid: false` entries with the concrete error; selection refuses them rather than silently dropping them. Listing and selection only read source bytes. Unlike v1’s ambient Codex discovery, the explicit API does not infer or apply a project `cwd` filter—the caller chooses the source directory, making that scope visible and avoiding an implicit history read.

## Audited upstream fixtures

Origin/main's `packages/opencode/test/kilocode/fixture/session-resume/claude.jsonl` and `codex.jsonl` deliberately include unsupported blocks and interrupted tool rounds. The v1 parser preserves those as unsupported/error markers and appends an import notice. The v2 adapter now preserves interrupted calls as explicit incomplete tools, but still rejects the opaque `server_tool_result`, `redacted_thinking`, empty encrypted reasoning, and unknown content records. Those are documented compatibility gaps rather than silently dropped history.

## Proof and done criteria

Done for this slice means:

- bounded local reads and strict Claude 2/Codex 0 parsing pass;
- source text, reasoning, tool IDs/inputs/outputs, statuses, and available source provenance survive `buildExternalTransfer`;
- source session/model changes fail closed instead of mislabeling messages;
- absent source model metadata falls back to the requested continuation model without recording fabricated source provenance;
- explicit-directory listing and selection apply audited Claude/Codex filename rules, expose invalid candidates, and do not read provider defaults;
- import uses only public `location.get` and `session.import`, with a fresh `ses_` ID;
- the bundled Bun 1.4 host test imports both fixtures, prompts each through a local fake OpenAI-compatible model, exports both sessions, and byte-compares the source copies before and after;
- no real provider history, paid model, shared upstream hook, commit, or push is required.

Validation on this checkout:

- system Bun 1.3.14: `bun test test/resume-external.test.ts` — 9 pass, 1 runtime-gated host test skipped, 40 assertions;
- bundled Bun 1.4.0: `./dist/interactive/bun --no-env-file test test/resume-external.test.ts` — 10 pass, 0 fail, 56 assertions;
- system Bun 1.3.14: `bun test test/external-sessions.test.ts` — 3 pass, 17 assertions;
- bundled Bun 1.4.0: `./dist/interactive/bun --no-env-file test test/external-sessions.test.ts` — 3 pass, 17 assertions;
- package typecheck and the repository's broader checks remain to be run by the parent integration owner.

This is format/import parity for the supported subset, not full v1 Resume Claude/Codex cutover. Ambient discovery, picker/migration UX, unsupported-block fidelity, and other provider-specific records remain open by design.
