import { Effect } from "effect"
import { launch } from "../interactive-server"
import { guardedFixtureLayout } from "../../test/fixture"

const root = process.env.KILO_SANDBOX_ROOT
if (!root) throw new Error("KILO_SANDBOX_ROOT is required")
const input = guardedFixtureLayout()
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => Response.json({ data: [] }),
})

const controller = new AbortController()
const stop = () => controller.abort()
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(input, {
          models: false,
          content: process.env.KILO_SANDBOX_FIXTURE_CONFIG ?? "{}",
          lock: { staleMs: 250, timeoutMs: 5000 },
          sandbox: { enabled: true, root },
          gateway: { server: gateway.url.origin },
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
  gateway.stop(true)
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
}
