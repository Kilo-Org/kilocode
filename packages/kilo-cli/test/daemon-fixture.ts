import { Effect } from "effect"
import { serve, start, status, stop } from "../src/daemon"
import { layout } from "../src/paths"

// Every daemon operation runs in a subprocess so it observes only the isolated fixture XDG paths.
const command = process.argv[2]
const input = layout("interactive")
const controller = new AbortController()
const abort = () => controller.abort()
process.once("SIGINT", abort)
process.once("SIGTERM", abort)
try {
  if (command === "serve") {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const daemon = yield* serve(input, {
            models: false,
            content: process.env.KILO_FIXTURE_CONFIG ?? "{}",
            lock: { staleMs: 250, timeoutMs: 3000 },
          })
          console.error(`Serving ${daemon.endpoint.url}`)
          yield* Effect.never
        }),
      ),
      { signal: controller.signal },
    )
  } else if (command === "start") {
    console.log(
      JSON.stringify(
        await start(input, {
          command: [process.execPath, "--no-env-file", import.meta.path, "serve"],
        }),
      ),
    )
  } else if (command === "status") {
    console.log(JSON.stringify(await status(input)))
  } else if (command === "stop") {
    console.log(JSON.stringify(await stop(input)))
  } else throw new Error(`Unknown daemon fixture command: ${command}`)
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
} finally {
  process.removeListener("SIGINT", abort)
  process.removeListener("SIGTERM", abort)
}
