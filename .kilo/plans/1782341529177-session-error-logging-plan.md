# JetBrains Session Error Logging Plan

## Context

The `maple-squirrel` branch currently adds logging for normal `ChatEventDto.Error` events on the backend chat route, backend RPC route, frontend client route, and prompt acceptance path. A read-only audit found that explicit `session.error` DTOs are now visible once parsed, but several edge cases can still silently miss or under-report session errors.

Affected package: `packages/kilo-jetbrains/`.

## Decisions

- Keep the PR focused on diagnostic logging only.
- Do not reintroduce the previously reverted session-error footer UI work.
- Treat any chat event that carries an error payload as error-bearing for logging purposes.
- Preserve content-safety behavior by using existing `ChatLogSummary` preview controls and body summaries rather than logging full payloads by default.
- Prefer WARN logs for actual error-bearing events and abnormal flow termination; keep normal subscription lifecycle at INFO.

## Implementation Tasks

1. Add a shared event helper in `ChatLogSummary` or a nearby logging utility.
   - Identify error-bearing events: `ChatEventDto.Error` and `ChatEventDto.MessageUpdated` where `event.info.error != null`.
   - Add a summary that includes `sid`, event type, error type, optional status code, and previewed message via existing preview controls.
   - Avoid exposing full response bodies unless existing chat-content preview/full logging is enabled.

2. Update backend chat event logging in `KiloBackendChatManager.start`.
   - WARN-log every error-bearing parsed event before emitting it to `_events`.
   - Include `route=chat-events`, `emit=true`, raw SSE type, byte count, and current subscriber count if available.
   - This catches errors even when there are no frontend/RPC subscribers.

3. Make backend event normalization failure-safe.
   - Wrap `normalizer.parse(event.type, event.data)` in `runCatching` inside the SSE collector.
   - On failure, log WARN with event type, byte count, body summary/hash, and exception.
   - Continue collecting subsequent SSE events after parse failures.
   - Keep the existing `parse returned null` warning, but make it clear when the null came from `session.error` or another chat event type.

4. Update backend RPC flow logging in `KiloSessionRpcApiImpl.events`.
   - WARN-log error-bearing events that pass the session filter.
   - Use `onCompletion { cause -> ... }`.
   - Log INFO for normal completion or cancellation.
   - Log WARN with the cause for non-cancellation failures.

5. Update frontend client flow logging in `KiloSessionService.events`.
   - WARN-log error-bearing events received from RPC.
   - Use `onCompletion { cause -> ... }`.
   - Log INFO for normal completion or cancellation.
   - Log WARN with the cause for non-cancellation failures.

6. Update frontend controller subscription logging in `SessionController.subscribeEvents`.
   - Add a catch path around event collection that logs WARN with `sid`, route/controller context, and exception.
   - Keep the existing final unsubscribe/debug lifecycle log.
   - Do not change UI state behavior unless a current state change already exists for that failure path.

7. Consider child session subscription logging in `SessionController.subscribeChild`.
   - Add the same WARN-on-collection-failure pattern for child permission subscriptions.
   - Keep this diagnostic-only unless it would alter visible behavior.

8. Improve SSE transport failure detail in `KiloBackendConnectionService.onFailure`.
   - Pass the throwable to `log.warn(..., t)` when present.
   - Log response code and body summary when `response` is present.
   - Avoid consuming large response bodies beyond the existing safe summary behavior.

9. Add targeted tests where practical.
   - Parser/chat manager test: malformed `session.error` SSE does not kill the watcher and logs a warning.
   - Logging helper test: `MessageUpdated.info.error` is classified as error-bearing.
   - Flow completion test, if lightweight test seams exist, for abnormal completion logging.
   - Do not add broad UI tests unless production behavior changes.

## Validation

- Run `./gradlew typecheck` from `packages/kilo-jetbrains/`.
- Run the smallest relevant JetBrains tests if new tests are added.
- Inspect `git diff main...HEAD` and confirm the PR remains limited to logging/diagnostic files.
- Reproduce with JetBrains custom debug category `#ai.kilocode:all:separate` and verify logs show:
  - prompt accepted,
  - subscription start,
  - backend chat error-bearing event WARN,
  - RPC/client error-bearing event WARN when subscribed,
  - parse failures as WARN without stopping later events,
  - abnormal flow completion as WARN with cause.

## Risks

- WARN logs may become noisy if `MessageUpdated.info.error` repeats during streaming. Mitigate by summarizing and, if necessary, logging only when the error identity changes per message ID.
- Subscriber-count logging may require accessing `MutableSharedFlow.subscriptionCount`; keep that localized to `KiloBackendChatManager` where the mutable flow is owned.
- Response bodies can contain sensitive provider details. Use existing preview/full controls and safe body summaries.

## Out Of Scope

- Showing session errors in the UI footer.
- Changing retry, auth, or model-selection behavior.
- Replaying/caching global errors for UI delivery. This plan only makes missed delivery diagnosable.
- CLI/server changes outside `packages/kilo-jetbrains/`.
