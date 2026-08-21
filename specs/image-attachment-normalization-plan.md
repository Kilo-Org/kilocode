# Image Attachment Normalization Plan

## Problem

Large screenshots can fail a Session request even though the V1 backend already normalizes most prompt images. The current behavior has several gaps:

- VS Code sends the original image as a base64 data URL before backend normalization.
- The V1 default allows one normalized image to contain up to 5 MiB of base64 data and to be up to 2,000 x 2,000 pixels.
- The request pruning threshold is 1.25 MB, but pruning keeps media from the current user turn.
- Context estimation replaces encoded media with a placeholder and cannot estimate provider-specific image token use.
- V2 prompt attachments and MCP resource images do not consistently use the normalizer.
- Limits apply to each image. There is no total media budget for one model request.
- HTTP 413 responses can be classified as context overflow even when the request body is too large.

The result is an inconsistent system. A pasted 4K screenshot normally gets smaller before it reaches the model, but it can still exceed a gateway payload limit or consume more model context than local preflight predicts.

## Goals

- Normalize every model-visible image at a backend boundary before persistence or provider use.
- Keep each image small enough for common model and gateway limits.
- Limit the total encoded media in one provider request.
- Estimate image context use without counting base64 bytes as text tokens.
- Return a clear attachment error before a provider request when media cannot fit.
- Reduce VS Code webview memory and transport costs for pasted screenshots.
- Keep original files unchanged outside Session storage.
- Preserve delivery-only `send_file` behavior.

## Non-Goals

- Do not add OCR or replace image input with extracted text.
- Do not make one exact image-token formula work for every provider.
- Do not remove images from the durable transcript after successful admission.
- Do not recompress PDFs or other binary attachments in this work.
- Do not make client-side normalization a security or correctness boundary.
- Do not change delivery-only `send_file` attachments.

## Proposed Policy

Use one backend policy for every model-visible image.

| Policy | Proposed default |
|---|---:|
| Maximum width | 1,600 px |
| Maximum height | 1,600 px |
| Maximum encoded bytes per image | 1.5 MiB |
| Maximum encoded media per request | 3 MiB |
| Known payload-limit reserve | 512 KiB |
| Automatic resize | Enabled |
| Preferred output | PNG when it fits, otherwise JPEG |
| JPEG quality sequence | 85, 80, 70, 55, 40 |

The encoded byte limits apply to the base64 payload, without the data URL prefix. The aggregate media limit includes base64 payloads for current and historical images that remain in the final model request.

For a provider with a known request-body limit, calculate the effective media budget as the smaller of:

```text
configured aggregate media limit
known provider body limit - measured non-media request bytes - safety reserve
```

For a provider without a known body limit, use the configured aggregate media limit. Do not assume that every provider has a 4 MiB limit.

Keep the backend settings configurable through the existing attachment image configuration. Add an aggregate media setting only if one does not already exist. A user can raise the defaults for a provider that supports larger images, but the request still must pass provider-specific hard limits.

## Design Rules

1. The backend is the source of truth.
2. Normalize before durable persistence when the image enters as user input.
3. Normalize before tool-result persistence when a tool creates model-visible media.
4. Validate dimensions before native image decoding.
5. Apply an aggregate budget to the final model-visible request.
6. Remove historical media before reducing or rejecting media from the current user turn.
7. Never silently remove a current-turn attachment.
8. Return typed, actionable errors without including image data.
9. Keep Kilo-specific request-budget behavior in Kilo-owned paths where possible.
10. Keep changes to upstream-owned OpenCode files small and mark them with `kilocode_change` comments.

## Target Flow

```text
Client image
  -> client preflight resize when available
  -> backend MIME and base64 validation
  -> header-based dimension and pixel safety check
  -> per-image resize and recompression
  -> current-turn aggregate media normalization
  -> durable Session persistence
  -> historical media pruning
  -> final request media budget check
  -> image context estimate
  -> provider adapter
```

Client normalization reduces transport and memory use. The backend repeats validation and normalization because other clients can bypass VS Code.

## Phase 1: Consolidate Backend Image Policy

### Work

- Define one internal policy shape for maximum dimensions, per-image encoded bytes, aggregate encoded bytes, auto-resize, and output qualities.
- Keep the existing configuration keys for `auto_resize`, `max_width`, `max_height`, and `max_base64_bytes`.
- Add an aggregate media setting with a 3 MiB default if the current schema has no equivalent.
- Change the default dimensions from 2,000 x 2,000 to 1,600 x 1,600.
- Change the default per-image base64 limit from 5 MiB to 1.5 MiB.
- Make the JPEG quality sequence monotonic: 85, 80, 70, 55, 40.
- Return normalization metadata with the result: original dimensions, final dimensions, original encoded bytes, final encoded bytes, and final MIME type.
- Keep metadata out of the persisted public file-part schema unless later request processing needs it.
- Reuse the Core header parser before Photon decoding in the V1 path, or add an equivalent safe parser in a Kilo-owned module.
- Reject zero dimensions, dimensions over 16,384 pixels per side, and images over 25,000,000 pixels before Photon allocation.

### Main Code Areas

| Area | Expected files |
|---|---|
| V1 normalization | `packages/opencode/src/image/image.ts` |
| V1 attachment config | `packages/core/src/v1/config/attachment.ts` |
| V2 normalization | `packages/core/src/image.ts`, `packages/core/src/image/photon.ts` |
| V2 attachment config | `packages/core/src/config/attachments.ts` |
| Safe dimension parsing | `packages/core/src/kilocode/image-size.ts` or a shared Kilo-owned equivalent |

### Acceptance Criteria

- A 3,840 x 2,160 screenshot becomes no larger than 1,600 x 900.
- A normalized image contains no more than 1.5 MiB of base64 data.
- An in-limit image stays byte-for-byte unchanged.
- A malformed or unsafe image fails before native decode.
- A transparent PNG stays PNG when it fits the budget.
- A PNG that does not fit can become JPEG with the returned MIME and data URL kept consistent.
- Normalization errors report limits and measured metadata, but not base64 content.

## Phase 2: Cover Every Model-Visible Ingress Path

### Work

- Keep V1 data URL prompt attachments on the existing normalization path.
- Change V1 local file attachment handling so a large but safe source image can reach the normalizer instead of being truncated before resize.
- Use a bounded raw-ingest limit, then perform header validation and normalization.
- Wire V2 prompt attachment materialization through the Core image normalizer before it is lowered to an LLM media part.
- Normalize MCP resource images before persistence and provider use.
- Confirm that remote image attachments enter the same normalizer after fetch materialization.
- Keep normal image-producing tool results on the normalization path.
- Keep `send_file` exempt because it is delivery-only and removed from future model context.
- Reject or normalize unsupported client image formats before the provider adapter. Do not let client-specific MIME support create provider-specific failures.

### Main Code Areas

| Ingress | Expected files |
|---|---|
| V1 user prompt | `packages/opencode/src/session/prompt.ts` |
| V1 tool result | `packages/opencode/src/session/processor.ts` |
| V2 prompt admission | `packages/core/src/session/input.ts` |
| V2 model lowering | `packages/core/src/session/runner/to-llm-message.ts` |
| MCP resources | `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/tools.ts` |
| Remote attachments | `packages/opencode/src/kilocode/remote-attachments.ts` |
| Delivery-only exemption | `packages/opencode/src/kilocode/tool/send-file.ts`, `packages/opencode/src/session/message-v2.ts` |

### Acceptance Criteria

- The same source image produces the same normalized limits through V1 data URL, V1 file URL, V2 prompt, MCP resource, and remote attachment paths.
- Tool-generated model-visible images use the same limits.
- An image source up to the bounded raw-ingest limit can be resized instead of being rejected only because its original encoding exceeds 1.5 MiB.
- `send_file` delivers the original allowed bytes and does not appear in later model context.
- No model-visible image bypasses MIME, dimension, pixel-count, and encoded-size validation.

## Phase 3: Add an Aggregate Request Media Budget

### Work

- Add a Kilo-owned media-budget helper near Session request assembly.
- Measure base64 payload bytes for every model-visible image after historical pruning.
- Apply the 3 MiB aggregate budget before the provider call.
- Use a lower dynamic budget when the provider has a known request-body limit.
- Remove historical image and PDF media first, using the existing placeholder behavior.
- If current-turn images still exceed the budget, progressively normalize the largest image first.
- Stop when every image respects its per-image limit and the request respects its aggregate limit.
- Return a typed attachment-budget error if the current turn cannot fit at the minimum supported size and quality.
- Do not send an over-budget request with only a warning log.
- Apply the same check after provider transforms if the transform can materially change inline media representation.

### Budget Algorithm

```text
collect model-visible image parts
-> remove media already eligible for historical stripping
-> calculate effective aggregate budget
-> if total is within budget, continue
-> sort current-turn images by encoded bytes, largest first
-> reduce the largest image one candidate step
-> repeat until within budget or no image can be reduced
-> fail admission or request preparation with AttachmentBudgetError
```

The first implementation should optimize for predictable limits, not perfect quality allocation. It must preserve attachment order and aspect ratio.

### Main Code Areas

| Area | Expected files |
|---|---|
| Kilo media policy | New file under `packages/opencode/src/kilocode/session/` |
| Request assembly | `packages/opencode/src/session/prompt.ts` |
| Historical stripping | `packages/opencode/src/kilocode/session/prompt.ts` |
| V2 request assembly | V2 Session runner request preparation under `packages/core/src/session/runner/` |
| Provider capability data | `packages/opencode/src/provider/provider.ts` |

### Acceptance Criteria

- One image cannot exceed 1.5 MiB with default settings.
- All images in one unknown-provider request cannot exceed 3 MiB with default settings.
- Known provider body limits reduce the effective media budget.
- Several images are reduced predictably instead of causing a provider 413 response.
- A current-turn image is never silently replaced with placeholder text.
- The user receives a clear error when the current attachments cannot fit.

## Phase 4: Add Image-Aware Context Estimation

### Work

- Continue to exclude base64 bytes from text-token estimation.
- Parse normalized image dimensions from data URL headers without fully decoding pixels.
- Add a conservative provider-neutral estimate based on image dimensions and tiles.
- Add provider-specific estimation only where the provider publishes a stable formula.
- Count the estimate in preflight compaction and output-token reservation.
- Keep raw encoded bytes as a separate payload metric.
- Prefer the larger of the provider-reported prior-turn usage and the local estimate, as the current logic does.
- Record the estimate separately from actual provider usage so diagnostics do not present estimates as billed tokens.

### Initial Estimator Contract

```ts
type ImageEstimate = {
  width: number
  height: number
  tokens: number
  encodedBytes: number
  method: "provider" | "conservative"
}
```

The exact type can follow repository conventions. The contract must keep context tokens and payload bytes separate.

### Main Code Areas

| Area | Expected files |
|---|---|
| Current estimator | `packages/opencode/src/kilocode/session/overflow.ts` |
| Output cap | `packages/opencode/src/kilocode/session/llm.ts` |
| Model limits | `packages/opencode/src/provider/provider.ts` |
| V2 compaction estimate | V2 Session runner compaction and request-budget code |

### Acceptance Criteria

- Increasing image dimensions increases estimated context use even when encoded byte size stays similar.
- Base64 characters are not counted as ordinary text tokens.
- A large image can reduce reserved output tokens or trigger preflight compaction.
- Provider-reported actual usage supersedes a lower local estimate on later turns.
- Logs and diagnostics identify whether an image-token value is estimated or reported.

## Phase 5: Separate Payload and Context Failures

### Work

- Add a distinct payload-too-large classification.
- Classify HTTP 413 as payload-too-large unless the provider response explicitly identifies context length.
- Keep explicit `context_length_exceeded` and known token-window messages classified as context overflow.
- Retry payload failures only when request reduction is safe and no side effects have occurred.
- On a payload retry, strip eligible historical media and old tool output, then reapply the aggregate media budget.
- Do not start normal context compaction only because the HTTP body is too large.
- Surface attachment-specific guidance when current media caused the failure.

### Main Code Areas

| Area | Expected files |
|---|---|
| Provider error classification | `packages/opencode/src/provider/error.ts` |
| Session recovery | `packages/opencode/src/session/processor.ts` |
| Payload recovery | `packages/opencode/src/kilocode/session/compaction-payload-recovery.ts` |
| Session error schema | Session message and server error schemas used by clients |

### Acceptance Criteria

- A plain provider 413 is reported as payload-too-large.
- A provider response with `context_length_exceeded` is reported as context overflow.
- Payload recovery does not create an unnecessary context summary.
- A repeated payload failure ends with a clear error and does not loop.
- The UI can distinguish attachment-size failures from context-window failures.

## Phase 6: Add VS Code Client Preflight Normalization

### Work

- Normalize pasted and native-dropped images before `FileReader.readAsDataURL` stores the attachment.
- Decode with `createImageBitmap` where supported.
- Resize on a canvas while preserving aspect ratio.
- Keep PNG when it fits. Use JPEG for oversized opaque screenshots.
- Avoid converting animated GIF input in the client. Let the backend apply the authoritative policy.
- Cap the client result at the same 1,600-pixel dimensions and 1.5 MiB encoded target.
- Apply a total 3 MiB client-side attachment target for immediate feedback.
- Show progress while a large image is processed.
- Show a clear error when decoding or normalization fails.
- Revoke object URLs and release decoded image resources after use.
- Do not persist the original full-size data URL in draft or Agent Manager webview state.

### Main Code Areas

| Area | Expected files |
|---|---|
| Attachment hook | `packages/kilo-vscode/webview-ui/src/hooks/useImageAttachments.ts` |
| Attachment utilities | `packages/kilo-vscode/webview-ui/src/hooks/image-attachments-utils.ts` |
| Prompt feedback | `packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx` |
| Agent Manager | `packages/kilo-vscode/webview-ui/agent-manager/NewWorktreeDialog.tsx` |

### Acceptance Criteria

- Pasting a 4K screenshot does not put the original 4K base64 data URL in webview state.
- The attachment preview remains clear enough to read normal UI text.
- The resulting client attachment respects the target dimensions and byte size.
- Sending the same image through a client without preflight still produces a valid backend-normalized image.
- Multiple attachments that exceed the client aggregate target produce immediate feedback.
- Animated GIF behavior does not regress because of client canvas conversion.

## Phase 7: Other Clients

### Work

- Add the same optional preflight optimization to JetBrains clipboard images.
- Apply the existing JetBrains file-size limit after clipboard PNG encoding, not only to file attachments.
- Consider CLI preflight only if measurements show that local base64 conversion is a material cost.
- Keep backend normalization mandatory for JetBrains, CLI, ACP, remote Sessions, and future clients.
- Align accepted image MIME types with the provider protocol boundary.

### Acceptance Criteria

- JetBrains clipboard images cannot bypass all encoded-size checks.
- CLI and ACP images receive the same backend policy without client changes.
- Client MIME support does not exceed formats that the backend can normalize and providers can accept.

## Phase 8: Observability and User Feedback

### Work

- Add structured debug logging for normalization outcomes.
- Record only MIME type, dimensions, byte counts, ingress path, provider ID, and normalization result.
- Never log data URLs, base64 data, filenames that may contain sensitive text, or image contents.
- Add counters for resized images, converted formats, rejected images, aggregate-budget failures, provider payload failures, and provider context failures with images.
- Show the final dimensions and approximate attachment size in UI error details where useful.
- Use one user-facing message for a local attachment-budget failure and a different message for a provider context-window failure.

### Suggested User Messages

```text
This image could not be attached because it is too large after resizing. Use a smaller crop or attach fewer images.
```

```text
These attachments exceed the request media limit. Remove an image or send the images in separate messages.
```

```text
The model context is full. Compact the Session or start a new Session before sending this image.
```

## Test Plan

### Unit Tests

- Preserve an in-limit PNG without re-encoding.
- Resize a 3,840 x 2,160 PNG to no more than 1,600 x 900.
- Resize a 2,160 x 3,840 portrait screenshot to no more than 900 x 1,600.
- Convert a large PNG to JPEG when PNG cannot fit.
- Keep MIME type and data URL prefix consistent after conversion.
- Reduce JPEG quality in monotonic order.
- Reject invalid base64 and mismatched MIME data.
- Reject zero, excessive, and unsafe dimensions before Photon decode.
- Fit two or more images within the aggregate budget.
- Fail with a typed error when aggregate normalization cannot fit.
- Estimate more context tokens for larger dimensions.
- Keep encoded bytes separate from estimated context tokens.
- Distinguish plain 413 payload errors from explicit context overflow.

### Integration Tests

- Send a 4K VS Code data URL through the Session HTTP API and inspect the persisted normalized part.
- Send the same image by local file URL and confirm equivalent limits.
- Admit a V2 image prompt and confirm normalization before LLM lowering.
- Attach an MCP resource image and confirm it cannot bypass normalization.
- Return a large image from `read` and confirm tool-result normalization.
- Use `send_file` and confirm the original allowed bytes are delivered but omitted from model replay.
- Send several current-turn images and confirm the final request stays within the aggregate budget.
- Include historical images and confirm they are stripped before current-turn images are reduced.
- Simulate provider payload and context errors and confirm different recovery paths.

### VS Code Tests

- Paste and drop a 4K PNG.
- Paste a large JPEG.
- Paste several images over the aggregate target.
- Paste an animated GIF.
- Restore a prompt draft and confirm only normalized image data is stored.
- Create an Agent Manager worktree with an attached screenshot.
- Confirm backend rejection is shown as an attachment error.

### Performance Checks

- Measure webview memory before and after pasting one 4K screenshot.
- Measure webview-to-extension message bytes before and after client normalization.
- Measure normalization latency for 4K PNG and JPEG samples.
- Measure backend peak memory during Photon decode.
- Confirm header validation rejects unsafe images before native allocation.

## Validation Commands

Run the smallest relevant checks after each phase.

```sh
# V1 CLI and Session changes
cd packages/opencode
bun run typecheck
bun test ./test/image/image.test.ts
bun test ./test/session/prompt.test.ts
bun test ./test/kilocode/session-overflow.test.ts

# V2 Core changes
cd packages/core
bun run typecheck
bun test

# VS Code changes
cd packages/kilo-vscode
bun run typecheck
bun run lint
bun run test:unit
bun run knip
bun run check-kilocode-change

# Shared OpenCode changes
cd ../..
bun run script/check-opencode-annotations.ts --worktree
bun run script/check-opencode-promise-facades.ts
```

Adjust targeted test paths to the final file names. Do not run the root `bun test` command.

## Rollout

1. Add backend coverage and tests without changing defaults.
2. Add aggregate measurement in log-only mode to collect request-size and image-count distributions.
3. Enable the lower per-image defaults and aggregate enforcement.
4. Add payload/context error separation.
5. Add image-aware context estimation.
6. Add VS Code preflight normalization.
7. Add JetBrains preflight normalization.
8. Remove temporary rollout logs after the policy is stable.

Use one concise changeset for the user-visible behavior. The release note should state that Kilo automatically reduces large screenshots and prevents image attachments from exceeding model request limits.

## Compatibility and Migration

- Existing persisted Session images remain unchanged.
- Request-time aggregate checks apply when old images are replayed to a model.
- Existing user configuration overrides continue to work.
- Lower defaults affect only images normalized after the change.
- If an aggregate config key is added to public config, update all generated schemas and the cloud config schema required by repository policy.
- Client-side normalized attachments remain ordinary file parts and need no protocol version change.
- A new typed error may require SDK regeneration if it changes a server endpoint schema.

## Security and Privacy

- Validate dimensions before Photon or another native decoder allocates image memory.
- Bound raw fetch and local file ingestion separately from encoded output size.
- Do not trust MIME declarations without checking decoded image headers.
- Do not log image content or complete data URLs.
- Do not upload images to a third-party compression service.
- Keep all normalization local to the client or Kilo backend.

## Open Decisions

Resolve these decisions with measurements during Phase 1 and Phase 2:

- Whether 1.5 MiB per image provides enough text clarity for dense screenshots.
- Whether the unknown-provider aggregate default should be 2 MiB or 3 MiB.
- Whether transparent images that cannot fit as PNG should use a fixed background before JPEG conversion.
- Whether provider-specific image-token formulas are stable enough to maintain.
- Whether aggregate normalization should happen only at admission or also before every provider request.
- Whether V1 and V2 can share one normalization service without increasing upstream merge conflicts.

## Definition of Done

- Every model-visible image ingress path uses the backend policy.
- Default normalized images are at most 1,600 x 1,600 and 1.5 MiB encoded.
- Final requests enforce an aggregate media budget.
- Image dimensions contribute to context estimation.
- Payload-too-large and context-overflow failures are distinct.
- VS Code reduces large pasted screenshots before storing or transmitting them.
- Unit, integration, and VS Code tests cover 4K screenshots and multiple images.
- Relevant typecheck, lint, unit, guard, and manual extension checks pass.
- A changeset documents the user-visible behavior.
