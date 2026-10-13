# Port reliability checkpoint — 2026-09-07

Scope: current working tree, including existing uncommitted ports. No live
accounts or user stores were used. This is a regression checkpoint, not whole
capability acceptance or deployed-service verification.

## Fixed regressions

- **Signed-out Gateway availability.** A configured endpoint could leave the
  provider enabled when its public catalog was empty or failed. The Gateway
  transform now disables the provider when there are no anonymous free records,
  in addition to withdrawing models. A later successful refresh restores the
  provider and free model. The existing real-host login test reproduced the
  failure before the fix and passes afterward.
- **Sidebar registration lifetime.** Repeated narrow/wide resizing duplicated
  credits/version rows and clipped benchmark content. Sidebar installers were
  called inside the app-slot render callback, although their registrations live
  for the plugin activation. Register them once in plugin setup instead. The
  existing benchmark resize test failed independently before the change and
  passes afterward; it now also checks repeated resizes and exactly one credits
  section and version row. UI hooks remain in the app contribution.

## Validation

- Fresh-artifact CLI regression run: **528 passed, 9 skipped, 2 failed** across
  92 files (3,154 assertions). The two failures are the regressions above. The
  run started before the fixes; do not describe this as a clean final-tree run.
- Gateway package: **65 passed**, 687 assertions. After adding the recovery
  assertion, the plugin suite passed **34 tests**, 528 assertions.
- Real-host Gateway login and anonymous catalog scenarios: **5 passed**,
  88 assertions after the fix.
- Benchmark sidebar, full TUI and privacy retests: **7 passed**, 31 assertions.
- Gateway and CLI package typechecks passed; whitespace checks passed.
- Portable launcher rebuilt with both fixes and passed real TUI rendering,
  daemon start/reuse and real-terminal attachment with independent client exit.
- Independent GLM review confirmed the sidebar registration lifetime correction;
  the upstream remount trigger itself remains unconfirmed.

The nine skips comprise seven host-dependent sandbox cases and two explicitly
gated MCP host scenarios. They are not passing coverage. Existing deployment,
IDE and sandbox activation-seam gates remain open.

Detailed logs are in BB thread storage for `thr_p5ywnfq8qz`, named
`reliability-suite.log`, `reliability-gateway.log`,
`reliability-gateway-recovery.log`, `reliability-sidebar-final.log` and
`reliability-bundle-smoke.log`.
