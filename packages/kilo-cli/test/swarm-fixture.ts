import { Effect } from "effect"
import { launch } from "../src/interactive-server"
import { layout } from "../src/paths"

const controller = new AbortController()
process.once("SIGTERM", () => controller.abort())
process.once("SIGINT", () => controller.abort())
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(layout("interactive"), {
          models: false,
          recover: false,
          content: process.env.KILO_FIXTURE_CONFIG,
          swarm: process.env.KILO_FIXTURE_SWARM === "1",
        })
        console.log(`URL: ${endpoint.url}`)
        yield* Effect.never
      }),
    ),
    { signal: controller.signal },
  )
} catch (error) {
  if (!controller.signal.aborted) throw error
}
