# Memory right-sidebar v2 parity

Source reference: pinned v1
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
| `Enabled` bullet success only with per-session evidence (durable session message markers, or a 5s saved pulse after a `memory.status`/`memory.updated` event with `detail.type: "saved"`); muted otherwise | The 5s save pulse half is delivered via the public `saved` RPC event (see [memory-activity-next-slice.md](memory-activity-next-slice.md)); the durable-marker half has no v2 seam, so without a fresh save the row stays muted. | Real capture-path pulse covered in the renderer fixture; marker half documented below |
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

## Activity acceptance — 2026-09-07

Both activity sources now reach the sidebar. A real per-session save produces
the existing five-second pulse. Separately, after the context hook appends
nonempty enabled memory, the Kilo plugin records `injected:v1:<sessionID>` in
its persistent storage with the memory root as its value. This stores no
memory content and creates no transcript or inbox entry. It records context
injection, not proof of model consumption or a successful save.

The optional session ID on the existing status RPC is validated against the
requested Location before reading the marker. The returned session-scoped
boolean lights Enabled after remount/restart; unrelated sessions remain
inactive, and Disabled stays disabled regardless of prior activity. Old
sessions are not backfilled from the project's latest-injection statistic.
This is a v2 storage adaptation of the v1 durable-marker indicator; v2's
request-scoped memory context still is not copied into durable message parts.

The real renderer fixture preserves the pulse-and-expiry proof, then disables
auto-save and makes a second actual local model request with saved memory.
It proves the injection marker, unrelated-session false, active tone after a
narrow/wide remount, and a second host reading the same fact after shutdown.
A foreign Location status request is refused. Four focused sidebar tests pass;
the fixture checks that only the two requested user/assistant pairs exist and
that no extra inbox items are admitted. All endpoints are loopback fixtures.

## Original compact-row verification (before the save-pulse follow-up)

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

The save-pulse follow-up intentionally adds one loopback-model session to the
fixture so it can prove an actual saved operation changes the bullet color
and then expires. Its evidence and remaining limits are recorded in
[memory-activity-next-slice.md](memory-activity-next-slice.md); the earlier
no-session-work statement describes the compact-row checks, not that new
capture scenario.
