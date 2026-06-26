# Performance and Resource-Safety Review: PR #11712

## Conclusion

The PR has one confirmed resource-lifecycle defect and two additional performance/resource-safety concerns. The console stack wizard can retain an in-flight request after route disposal because its `AbortController` is not connected to SolidJS cleanup. I did not find an unbounded heap-retention leak in the Effect services, VS Code panel/controller subscriptions, retry timers, or stack webview subscriptions: scoped temp files/directories and transactions have finalizers, the panel disposes listeners/subscriptions/controller state, and SolidJS message subscriptions and retry timers are cleaned up. However, the route-disposal issue can retain the wizard closure and response payload until the network/filesystem request completes, and repeated concurrent stack-summary loads can amplify transient memory and network usage.

## Findings

### PERFORMANCE-001 — Stack route disposal does not abort its active request

- **Severity:** Medium
- **References:** `packages/kilo-console/src/routes/config/StackRoute.tsx:28`, `packages/kilo-console/src/routes/config/state/stack.ts:487`, `packages/kilo-console/src/routes/config/state/stack.ts:501`, `packages/kilo-console/src/routes/config/state/stack.ts:706`, `packages/kilo-console/src/routes/config/state/stack.ts:747`, `packages/kilo-console/src/routes/config/state/stack.ts:807`
- **Evidence / reproduction:** `createStackWizard()` stores the current `AbortController` in its closure and exposes no disposal method. `StackRoute` creates the wizard but registers no `onCleanup`. Start Detect, Preview, or Apply, then navigate away before completion. The request remains active; its promise callbacks retain the wizard's signals, catalog/draft/resource arrays, and route state until the operation settles. The revision/project checks prevent stale UI writes but do not release the request or closure early. This is most visible with a slow backend or a detection request queued behind filesystem I/O.
- **Impact:** Avoidable network/backend work continues after the UI is gone. Repeated enter/start/leave cycles can temporarily retain multiple complete wizard states and responses. A hung request can make that retention effectively indefinite for the page lifetime. Apply is intentionally guarded from normal cancellation, so disposal semantics need an explicit policy rather than silently abandoning the client request.
- **Fix:** Expose `dispose()` from `createStackWizard()` that increments `revision`, aborts the active controller, clears its reference, and releases large signal values where useful; call it from `onCleanup` in `StackRoute`. If Apply must be non-cancellable server-side, still abort the client wait on unmount and make the backend operation independently transactional/idempotent, then reload state on the next mount.

### PERFORMANCE-002 — Stack summary refreshes are not deduplicated or cancellable

- **Severity:** Low
- **References:** `packages/kilo-vscode/webview-ui/src/context/stack-summary.tsx:46`, `packages/kilo-vscode/webview-ui/src/context/stack-summary.tsx:49`, `packages/kilo-vscode/webview-ui/src/components/shared/StackPopover.tsx:39`, `packages/kilo-vscode/src/KiloProvider.ts:435`, `packages/kilo-vscode/src/stack/client.ts:49`
- **Evidence / reproduction:** Every `refresh()` posts immediately and schedules a retry while `loaded()` is false. Opening the popover, the initial provider refresh/retry, connection/config events, and explicit `requestStackSummary` messages can all call `fetchAndSendStackSummary()` concurrently. That method has no in-flight promise, generation guard, or cancellation and each call runs two HTTP requests via `StackHttpClient.load()`. Rapidly open/close the popover while delaying stack endpoints and observe duplicate catalog/state requests; older completions can also overwrite a newer project summary because there is no directory/generation check before caching/posting.
- **Impact:** Duplicate catalog parsing and response objects increase transient memory, backend work, and network traffic. Under slow or failed connections, repeated triggers can accumulate outstanding requests and retain each provider/client promise chain until completion. This is bounded by user/events rather than a permanent listener leak, but it is a resource-amplification path and stale-result race.
- **Fix:** Keep one in-flight summary promise per provider/directory, coalesce callers, and use a generation token or `AbortController` when the directory, feature flag, or provider lifecycle changes. Clear the retry as soon as a matching response arrives, and only cache/post a result if its directory and generation are still current.

### PERFORMANCE-003 — Filesystem detection performs thousands of serial directory reads and repeated full-list scans

- **Severity:** Low
- **References:** `packages/opencode/src/kilocode/stack/catalog/detect.ts:40`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:41`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:183`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:189`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:196`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:145`
- **Evidence / reproduction:** The walker is bounded to depth 8 and 8,000 discovered files and skips symlinks/known heavy directories, which bounds retained file-path memory. However, directories do not count toward `FILE_LIMIT`, and recursive `yield* visit(...)` serializes every `readDirectoryEntries`. A broad tree containing many empty directories can therefore issue far more than 8,000 filesystem calls. After collection, each path detector runs `input.files.some(...)`; with roughly a dozen glob-based detectors this repeatedly scans up to 8,000 strings. Reproduce with a depth-8 tree containing tens of thousands of empty directories, or trace a maximum-size repository detection.
- **Impact:** Detection can monopolize an Effect request fiber for a long time and create excessive filesystem latency/CPU despite the advertised file bound. Concurrent `/stack/detect` calls have no shared limiter, so multiple clients multiply this work. The memory bound is reasonable, but request duration and I/O concurrency are not robustly bounded.
- **Fix:** Count visited entries/directories against a single traversal budget, add an explicit directory limit and/or deadline, and process directories with small bounded concurrency (for example 4–16) while preserving cancellation. Compile the finite detector patterns once and evaluate them during traversal, or build a compact path index, instead of repeatedly scanning the complete file array.

## Reviewed Areas Without Additional Findings

- Effect scopes/fibers: stack Apply is wrapped in `Effect.scoped`; staged archives, stage directories, store temp files, backups, and transactions register release/finalizer cleanup.
- Rollback/runtime loops: actions execute over finite plan arrays, rollback sets are finite, and transaction completion/rollback is guarded by `closed`.
- VS Code panel lifecycle: panel listeners, workspace listeners, connection subscriptions, controller state, and pending-load references are released in `StackPanelProvider.cleanup()`.
- Timers/subscriptions: stack-summary retry timers and VS Code/Solid message subscriptions have cleanup hooks; no repeating stack timer was introduced.
- SSE/event listeners: the stack feature adds REST calls rather than a new SSE subscription; no unpaired stack-specific browser event listener was found.
- Catalog/assets: the built-in catalog is large but module-static, and dashboard icon assets add roughly 388 KiB to each of the console and extension asset trees. Icons are referenced as external assets rather than eagerly decoded into one JS object; no release-blocking bundle or heap issue was established.
