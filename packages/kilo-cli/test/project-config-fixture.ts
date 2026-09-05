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
        const input = layout("interactive")
        const endpoint = yield* launch(input, { models: false, projectConfig: process.argv[2] === "enabled" })
        console.log(`URL: ${endpoint.url}`)
        yield* Effect.never
      }),
    ),
    { signal: controller.signal },
  )
} catch (error) {
  if (!controller.signal.aborted) throw error
}
