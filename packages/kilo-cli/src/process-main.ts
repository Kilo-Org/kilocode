// Shared CLI process harness used by both the full CLI entrypoint (`./main`) and the lightweight
// `serve --stdio` fast path (`./stdio-serve`). Keeps proxy setup, diagnostics, crash logging,
// Observability/NodeServices wiring, and SIGTERM teardown identical without pulling in CLI commands.
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Cause, Effect } from "effect"
import { defaultTeardown, getErrorReported } from "effect/Runtime"
import type { Scope } from "effect/Scope"
import { Observability } from "@opencode/util/observability"
import { Global } from "@opencode/util/global"
import { OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "@opencode/cli/version"
import { Heap } from "@opencode/cli/heap"
import { CpuProfile } from "@opencode/cli/cpu-profile"
import { ShutdownDeadline } from "@opencode/cli/shutdown-deadline"
import { KiloApp } from "./app"

/** Keep requests to the local service off any proxy (Bun reads lowercase `no_proxy` alone). */
export function configureLocalNoProxy(): void {
  const noProxy = [
    ...new Set(
      [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
        (value ?? "").split(",").flatMap((entry) => entry.trim() || []),
      ),
    ),
  ].join(",")
  process.env.NO_PROXY = noProxy
  process.env.no_proxy = noProxy
}

export function runCliProcess<E>(
  program: Effect.Effect<void, E, Scope | NodeServices.NodeServices | Global.Service>,
): void {
  let terminated = false

  Effect.gen(function* () {
    yield* Heap.listen
    yield* CpuProfile.listen
    yield* ShutdownDeadline.install()
    // runMain reports every signal interruption as 130; remember a SIGTERM so the exit code is 143.
    process.once("SIGTERM", () => {
      terminated = true
    })
    const runFork = Effect.runForkWith(yield* Effect.context<never>())
    const uncaughtException = (cause: Error, origin: "uncaughtException" | "unhandledRejection") => {
      runFork(Effect.logError("uncaught exception", { cause, origin }))
    }
    const unhandledRejection = (cause: unknown) => {
      runFork(Effect.logError("unhandled rejection", { cause }))
    }
    process.on("uncaughtException", uncaughtException)
    process.on("unhandledRejection", unhandledRejection)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        process.off("uncaughtException", uncaughtException)
        process.off("unhandledRejection", unhandledRejection)
      }),
    )
    yield* Effect.logInfo("cli starting", {
      version: OPENCODE_VERSION,
      channel: OPENCODE_CHANNEL,
      local: OPENCODE_LOCAL,
      args: process.argv.slice(2),
    })
    return yield* program
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("cli process failed", {
        cause,
        args: process.argv.slice(2),
      }).pipe(Effect.andThen(Effect.failCause(cause))),
    ),
    Effect.annotateLogs({ role: "cli" }),
    Effect.provide(
      Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
    ),
    Effect.provide(
      Observability.layer({
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
        client: KiloApp.name,
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      }),
    ),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
    // runMain's default reporter logs the fatal cause to stdout. Write it to stderr instead: the
    // desktop and `Service.ensure` only capture stderr from `serve --service`, so this is the only
    // channel through which a startup failure's reason reaches the user.
    Effect.tapCause((cause) =>
      Effect.sync(() => {
        if (Cause.hasInterruptsOnly(cause)) return
        if (!getErrorReported(Cause.squash(cause))) return
        process.stderr.write(Cause.pretty(cause) + "\n")
      }),
    ),
    NodeRuntime.runMain({
      disableErrorReporting: true,
      teardown: (exit) =>
        defaultTeardown(exit, (code) => {
          // Commands report failures through process.exitCode.
          const status = code === 0 ? (process.exitCode ?? 0) : code === 130 && terminated ? 143 : code
          // process.exit drops output still queued for a pipe; ending the streams waits for it.
          void Promise.all(
            [process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => stream.end(() => resolve()))),
          ).then(() => process.exit(status))
        }),
    }),
  )
}
