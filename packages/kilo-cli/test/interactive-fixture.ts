import { Effect } from "effect"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

const controller = new AbortController()
const stop = () => controller.abort()
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(layout("interactive"), {
          models: false,
          content: process.env.KILO_FIXTURE_CONFIG ?? "{}",
          lock: { staleMs: 250, timeoutMs: 5000 },
          gateway: process.env.KILO_FIXTURE_GATEWAY
            ? { server: process.env.KILO_FIXTURE_GATEWAY, pollIntervalMs: 10 }
            : undefined,
        })
        console.log(`URL: ${endpoint.url}`)
        console.log(`Password file: ${layout("interactive").password}`)
        yield* Effect.never
      }),
    ),
    { signal: controller.signal },
  )
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error)
    process.exitCode = 1
  }
} finally {
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
}
