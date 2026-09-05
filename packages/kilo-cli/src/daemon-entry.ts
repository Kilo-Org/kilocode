import { requireRuntime } from "./runtime"

requireRuntime()

const { Effect } = await import("effect")
const { serve } = await import("./daemon")
const { layout } = await import("./paths")

const controller = new AbortController()
const abort = () => controller.abort()
process.once("SIGINT", abort)
process.once("SIGTERM", abort)
try {
  if (process.argv.length > 2) throw new Error("The managed Kilo daemon entry takes no arguments")
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const daemon = yield* serve(layout("interactive"), {
          gateway: { server: process.env.KILO_API_URL },
          persistedTelemetry: true,
        })
        // The supervising client discovers the endpoint through the registration file; a detached
        // daemon has no stdout of its own, so this only annotates the spawner's captured stderr.
        console.error(`Kilo interactive daemon ${daemon.info.pid} listening on ${daemon.endpoint.url}`)
        yield* Effect.never
      }),
    ),
    { signal: controller.signal },
  )
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
} finally {
  process.removeListener("SIGINT", abort)
  process.removeListener("SIGTERM", abort)
}
