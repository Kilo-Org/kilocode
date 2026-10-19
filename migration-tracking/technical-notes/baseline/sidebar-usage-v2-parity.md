# Session family usage v2 parity

The Kilo CLI sidebar now reads only the local `kilocode.session-usage` RPC. It labels the view **Session family usage** so its durable root-and-descendant aggregate is not confused with the native direct-session context spend shown elsewhere in the TUI.

It renders reported input, output, reasoning, cache-read, and cache-write tokens, the accumulated step count and USD cost, and per-model step/cost rows. Per-model rows expand to their token breakdown. Cache rate keeps the v1 denominator: `cache.read / (input + cache.read + cache.write)`. No throughput, benchmark, or inferred estimate is displayed because the durable RPC does not provide one.

The sidebar masks model identifiers and costs while the isolated Kilo privacy accessor is enabled. Mounting, expanding, resizing, and reading the aggregate never invokes a model: they make only the local authenticated usage RPC request. A changing session or location aborts the prior request and returns to loading before fetching the new identity; terminal execution, create/delete/revert/move, and server reconnect events request a fresh aggregate.

Family membership follows the source semantics: durable `parentID` descendants in the same project. A `session.fork` is transcript provenance (`fork_session_id`), not a family child, and is intentionally excluded. The renderer fixture creates a genuine parent child by exporting a completed session from a second local host and importing it with `parentID` into the root's host; it never uses a paid account or live inference service.

The fixture proves the public usage RPC includes the imported child, its aggregate has both model rows, the real TUI renders the masked counts, and sidebar-only resize leaves fake-model request count unchanged. A post-mount root completion updates the public aggregate and the visible 160-column sidebar. At 100 columns the native auto-sidebar policy hides the entire sidebar; resizing back to 140 columns restores the refreshed totals without another model request.

The real renderer fixture now mouse-clicks a distinguishable per-model row, verifies its actual token breakdown, checks that the other row stays collapsed and privacy remains masked, then collapses it again. Both interactions preserve the model-request count. After sidebar clicks the fixture explicitly refocuses the composer before `/exit`; omission of that step caused a test cleanup hang, not a usage-production defect. Parent final usage plus indexing run: 3 pass / 6 wrapper assertions (2026-09-07).
