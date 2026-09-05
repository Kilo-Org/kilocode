# Memory UI v2 parity slice

Source reference: local `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`, specifically
`packages/opencode/src/kilocode/cli/cmd/tui/component/dialog-memory.tsx`.
This is a local source and isolated-host comparison, not a live-account claim.

## Delivered UI surface

| Source behavior | V2 UI behavior | Evidence / boundary |
|---|---|---|
| Memory help presents an actionable command surface instead of a plain alert | Bare `/memory` opens a native selectable menu for status, show, inspect, enable/disable, auto, rebuild, remember, correct, forget, and purge. Text actions use native prompts and purge requires native confirmation. Invalid input retains a large custom usage-help dialog with the parser reason. | Menu selections re-enter the same parser/RPC dispatcher used by direct slash arguments; cancel and empty prompts make no mutation. The public plugin dialog API has no supported append-to-composer operation, so it does not recreate v1's selectable prompt drafts. |
| Show presents state, root, source counts, and stored items | `/memory show` has a large refreshable, scrollable dialog with the real `show` RPC state, formatted root, source names, parsed stored entries, and page controls | Entries are parsed only from actual `- key :: text` source lines. No source-specific count or item is invented. |
| Status presents state and index details | `/memory status` has the same refreshable, scrollable dialog shell and uses the real `status` RPC fields for state, automatic mode, index bytes/tokens/truncation, local-file presence, and persisted engine activity. | Activity is projected from real engine state: injection time/bytes/estimated tokens, session-digest time, typed-consolidation time, and operation count. It does not present a cost or model-usage value that the public `generate.text` result does not supply. |
| Mutating commands provide lightweight feedback | Enable, disable, auto, rebuild, remember, correct, forget, purge, and inspect now use native toasts rather than blocking alerts | Operations continue through the existing typed local RPC and retain refresh notifications for the sidebar. |
| Palette has one Memory command | `kilo.memory` is not suggested, preventing the native unfiltered command palette from rendering it in both Suggested and Kilo sections | The command remains palette-visible and slash-visible. |
| Slash completion has one executable Memory command | The existing native shadow rule keeps the local `/memory` ahead of the server command; the real-renderer fixture counts actual slash rows rather than just a matching description | The public server command remains available to non-TUI clients; no backend command was removed. |

## Verification

`packages/kilo-cli` ran:

```
./dist/interactive/bun run script/test.ts test/memory-ui.test.tsx
```

It passed with Bun 1.4.0. The isolated production-host/TUI fixture verifies one
actionable `/memory` autocomplete row and one palette row, immediate
enable/auto/remember RPC effects, native menu selections for Status and Show,
a cancelled Remember prompt that preserves the source bytes, the rendered
Memory show dialog, persisted source text, and no created session or
inbox/model work.

`./dist/interactive/bun run typecheck` also passes.

## Deliberate gaps

- The public host generation result supplies text, not provider usage or cost.
  The status dialog consequently omits consolidation billing/token claims; the
  persisted activity fields above are timestamps, operation count, and actual
  injection byte/estimated-token measurements, not a cost estimate. This is
  narrower than the v1 capture port, which receives provider usage for its
  internal token statistic; v1 itself hard-codes consolidation cost to zero, so
  cost is not a missing v1 user-facing capability.
- The public plugin dialog API cannot inject a selected command draft into the
  composer, so v1's selectable help-menu drafting is not ported.
- This UI slice does not change the separate engine/capture gaps recorded in
  [memory-v2-parity.md](memory-v2-parity.md).
