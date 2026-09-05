import { Effect } from "effect"
import { launch } from "../interactive-server"
import { layout } from "../paths"

const root = process.env.KILO_SANDBOX_ROOT
if (!root) throw new Error("KILO_SANDBOX_ROOT is required")

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
          content: process.env.KILO_SANDBOX_FIXTURE_CONFIG ?? "{}",
          lock: { staleMs: 250, timeoutMs: 5000 },
          sandbox: { enabled: true, root },
        })
        console.log(`URL: ${endpoint.url}`)
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
