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
    removal: () => undefined,
  }),
)
