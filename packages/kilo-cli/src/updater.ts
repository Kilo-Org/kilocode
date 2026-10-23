export * as KiloUpdater from "./updater"

import { Updater } from "@opencode/cli/services/updater"
import { Effect, Layer } from "effect"

export const message = "Kilo updates are disabled. Update Kilo manually using the method used to install this build."

export const layer = Layer.succeed(
  Updater.Service,
  Updater.Service.of({
    run: () => Effect.succeed(undefined),
    check: () => Effect.succeed({ type: "unavailable", message }),
    apply: () => Effect.fail(new Error(message)),
    method: () => Effect.succeed(undefined),
    latest: () => Effect.fail(new Error(message)),
    upgrade: () => Effect.fail(new Error(message)),
    // TODO(rebrand, #15324): Before installer/service identity work, test isolated uninstall dry-run
    // and cleanup paths. Undefined skips package removal, not upstream cache cleanup or service
    // shutdown. Verify kilo2-only paths and confirmation text; preserve v1/OpenCode data and shell config.
    removal: () => undefined,
  }),
)
