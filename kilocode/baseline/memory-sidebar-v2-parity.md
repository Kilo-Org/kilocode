# Memory right-sidebar v2 parity

Source reference: local `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`, specifically the right-sidebar row
component `packages/opencode/src/kilocode/cli/cmd/tui/component/memory-status.tsx`
and its slot registration `packages/opencode/src/kilocode/plugins/memory-status.tsx`.
This is a local source and isolated-host comparison, not a live-account claim.

## Delivered surface

The v2 sidebar memory section
(`packages/kilo-cli/src/tui-plugin/sidebar-memory.tsx`, appended to the native
`sidebar.content` slot) renders exactly the compact current-main status row: a
bold **Memory** header and one `• {label}` row, bullet tone-colored, label in
default text color.

| Source behavior | V2 behavior | Evidence / boundary |
|---|---|---|
| Label set `Loading`, `Unavailable`, `Disabled`, `Enabled` from status fetch state | Same labels via exported `memoryRow` mapping | Unit test `test/sidebar-memory.test.tsx` runs the actual exported mapping |
| `Loading` and `Disabled` bullet muted | Both use `theme.text.subdued` | Fixture span assertions; mapping unit test |
| `Unavailable` bullet error-toned | `theme.text.feedback.error.default`; the earlier v2 adapter used warning | Mapping unit test asserts `tone: "error"` |
| `Enabled` bullet success only with per-session evidence (durable session message markers, or a 5s saved pulse after a `memory.status`/`memory.updated` event with `detail.type: "saved"`); muted otherwise | `Enabled` renders muted. No v2 seam exposes per-session injection evidence: the context hook pushes memory into ephemeral request system parts, never durable message parts, and the engine event sink (`MemoryEvents.setSink`) is not wired to the host bus, so no save event reaches the TUI. Claiming activity would be invented state. | Honest gap; see below |
| Bullet `•` + label in a row, label in default text | Same row layout and colors | Fixture asserts bullet and label spans exist with different foregrounds (muted bullet vs default label) |

The earlier v2 adapter also rendered `Auto:`, `Data:` estimated tokens,
`Injected:` tokens, `Last save:`, and `Data truncated` lines taken from real
`status` RPC fields. Johnny's parity request is the compact source row, so these
lines are consolidated out of the sidebar. No data is deleted: the same fields
remain available in the `/memory status` dialog
(`packages/kilo-cli/src/tui-plugin/memory-dialog.tsx`) and the public
`kilocode.memory` RPC; the sidebar still refreshes on enable/disable commands,
`session.execution.succeeded`, and a 5s poll while enabled, so label transitions
stay live.

Refresh wiring is unchanged: session/location changes re-fetch with the prior
request superseded, `/memory` mutations notify through the in-process memory UI
refresh bus, and a disabled memory is not polled.

## Honest gaps

- **Per-session active tone.** Current main turns `Enabled` success when the
  viewed session has memory markers in its durable message parts, or for 5s
  after a saved event for that session. V2 injection is request-scoped
  (ephemeral system parts), so no durable per-session marker exists, and no
  memory event is published to the TUI. `Enabled` therefore stays muted even
  right after this session's requests included memory.
- **Concrete seam needed (reported, not built):** either durable per-session
  injection evidence (e.g. persisting which sessions received injected context,
  exposed through the `status` RPC as a per-session fact — not the engine's
  single `lastInjectedSessionID`, which is latest-project attribution only and
  would false-negative session A after session B injects), or wiring the
  existing `MemoryEvents` sink to the host event bus so the sidebar can observe
  real `saved` events per session. Both are engine/host-owner decisions.
- The `activity.lastInjectedSessionID` engine field was deliberately not
  exposed on the RPC: latest-project attribution is not the v1 marker semantic,
  and with the active tone staying muted no consumer needs it.

## Verification

`packages/kilo-cli` ran with the bundled runtime (Bun 1.4.0):

```
./dist/interactive/bun run script/test.ts test/sidebar-memory.test.tsx
./dist/interactive/bun run script/test.ts test/sidebar-memory-ui.test.tsx
./dist/interactive/bun run typecheck
```

All pass. The real-renderer fixture launches the isolated production host and
TUI with models disabled, drives `/memory enable` and `/memory disable` through
the actual prompt, asserts the compact bullet row at 160 and 140 columns,
asserts the removed detail lines are absent, asserts the bullet span is muted
while the label span is default text, verifies the native auto-sidebar policy
hides the row at 100 columns and restores it at 140 without model work, and
confirms no session message or inbox item is created.
