# Kilo v2 startup optimization

Continued the startup investigation from BB thread `thr_qr9z7p3cqc` on
2026-09-07. The earlier signed-out catalog and fixture-storage fixes were
already validated and confirmed working by Johnny. The temporary
`Starting Kilo…` text has been removed at his request.

## Result

- The native TUI renders without waiting for Gateway network activation.
  The existing server `Plugin.awaitActivation` gate still protects prompts,
  model execution, and restart recovery. Cold sessions wait for their catalog;
  they cannot race model resolution against its arrival.
- Interactive Gateway activation restores a schema-validated snapshot only
  when server, credential identity and value, and requested organization match.
  Default organization selection and explicit personal selection are distinct.
  The single stored snapshot expires after 60 seconds; it contains a hash of
  its identity, profile, and raw catalog, never the credential itself. Each
  Location still applies its own configuration and policy.
- A matching warm snapshot permits execution while a scoped background refresh
  replaces it. Failed refreshes withdraw the snapshot; a response for a changed
  credential or organization is discarded. Account and metadata RPCs reuse the
  matching loaded data instead of repeating the startup network requests.
  One-shot commands retain their synchronous catalog behavior.
- Argument parsing no longer imports the TUI. Execution-host imports are lazy,
  including on the daemon client path. Ordinary launches start or reuse a healthy
  Kilo daemon, allowing multiple terminal windows to share the store. Explicit
  sandbox, swarm, project configuration, indexing, custom server/cloud settings,
  and host-owning commands retain their dedicated host path. When a daemon is
  running, those paths fail immediately with instructions to stop it first.
  Database initialization takes place after acquiring the store lock, so
  simultaneous first launches cannot race database creation.
- `build:tui` now builds and selects the portable TUI bundle. Code splitting
  preserves dynamic import boundaries, and shared chunks stay under `src/`
  so plugin and daemon paths resolve correctly. The existing ACP bridge path
  and runtime PATH remain available through the launcher.

The rebuilt entry is `packages/kilo-cli/dist/interactive/kilo2`. Source edits
now require `bun run build:tui` with Bun 1.4+ to update that compiled launcher;
`bun run tui` remains the direct source-development command. Daemon-backed
clients detach on exit; `kilo2 service stop` stops the daemon explicitly.
After a rebuild, restart an existing daemon to load the updated server code.
Close any older in-process clients once before starting the new default launcher.
Clients with different package versions may replace the shared daemon; concurrent
windows should use the same build.

## Measurements

These are local, isolated diagnostic samples, not an apples-to-apples upstream
v2 benchmark or a promise about a particular remote Gateway response time.

| Measurement | Source / synchronous | Optimized |
|---|---|---|
| Headless real TUI home ready, first sample | 2678 ms from source | 1910 ms bundled |
| Headless real TUI home ready, second sample | 2319 ms from source | 1064 ms bundled |
| Warm catalog activation, controlled 800 ms response delay | 1003 ms | 182 ms with models already available |
| Existing bundled daemon reuse | — | 233 ms, same PID |
| Real terminal default attachment | — | 1493 ms to Kilo footer; `/exit` retained the same daemon |

The headless measurements include process startup, module loading, host startup,
and the rendered Kilo footer. Both versions run the same loopback prompt/reply
smoke afterward. The controlled catalog probe verifies a persisted warm cache
across separate host processes. Cold model execution still waits for network
readiness, but the TUI no longer shares that wait.

## Validation

- Gateway and CLI package `bun typecheck`: pass.
- Gateway plugin, startup-cache, and prompt-selector tests: 37 passed.
- TUI and signed-out Gateway tests: 6 passed, including a catalog response held
  until the full home screen renders, plus a prompt started against an explicit
  Kilo model before catalog readiness. No prompt message is admitted before
  activation, and the prompt completes after the response is released.
- Daemon lifecycle and multi-Location account transitions: passed.
- Portable artifact tests: 2 passed, including relocation, native routed model
  requests, TUI prompt/reply, launcher boot, and native PTY cleanup.
- Built bundle TUI smoke and real terminal daemon attachment: passed. The
  attachment check confirms `/exit` leaves the same daemon running.
- Cache coverage includes expiry, future timestamps, malformed data, different
  servers/credentials/organizations, and a late response after credential change.
- All runtime validation used temporary fixture storage and loopback servers;
  no live user credentials were read or changed by the test harnesses.

The independent GLM 5.3 Flash review found the initial cold-session resolution
race; it was fixed through the existing server activation gate and verified by
the early-prompt test. No shared Core hooks or generated protocol edits were
needed. The launcher review used Gemini 3.8 Flash and returned no actionable findings.
