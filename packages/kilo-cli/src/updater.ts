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
    // `kilo2 uninstall` runs the upstream handler with this service. `method` reports no install method, so the
    // handler never asks for a removal: it runs no package manager and prints no binary or shell PATH step. It
    // still stops the kilo2 background services and removes the kilo2 cache directory (test/uninstall.test.ts).
    removal: () => undefined,
  }),
)
