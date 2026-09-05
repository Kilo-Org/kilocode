import { Effect } from "effect"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

// Cloud fixture host. Mirrors interactive-fixture.ts but additionally wires the
// cloud Gateway extension against the loopback cloud-agent and web-app stubs
// supplied through the explicit dev origin overrides. The gateway base comes
// from KILO_FIXTURE_GATEWAY. No real account or live cloud endpoint is used.
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
          cloud: process.env.CLOUD_AGENT_NEXT_BASE_URL
            ? {
                agentOrigin: process.env.CLOUD_AGENT_NEXT_BASE_URL,
                webAppOrigin: process.env.KILO_WEB_APP_URL ?? process.env.CLOUD_AGENT_NEXT_BASE_URL,
                allowHttpLoopback: true,
              }
            : undefined,
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
