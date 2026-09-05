import { parseArgs } from "node:util"
import manifest from "../package.json"

const banner = "Kilo internal preview"
const help = `${banner} (${manifest.version})

Usage: kilo2 <command>

  init       Initialize the isolated preview store, then exit
  preview    Boot the isolated host until Ctrl-C
  serve      Serve the authenticated admission-only API (--port defaults to 0)
  paths      Show the preview's storage paths without opening them
  --version  Show the internal preview version
  --help     Show this help

Internal development only. This entrypoint is headless; no managed daemon or data import.
For chat, use packages/kilo-cli/dist/interactive/kilo2 from the checkout.
Stable Kilo and OpenCode data/config are never selected by this host.
Serve accepts text-only prompts with resume: false. Populated stores cannot reopen yet.
`

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0]))) {
    console.log(help)
    return
  }
  if (args.length === 1 && args[0] === "--version") {
    console.log(`${banner} ${manifest.version}`)
    return
  }
  const serving = args[0] === "serve"
  if (!serving && (args.length !== 1 || !["init", "preview", "paths"].includes(args[0]))) {
    throw new Error("Unknown command. Run kilo2 --help for supported commands.")
  }
  const options = serving
    ? parseArgs({ args: args.slice(1), options: { port: { type: "string", default: "0" } }, allowPositionals: false })
    : undefined
  const port = Number(options?.values.port ?? "0")
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be an integer from 0 to 65535")
  const { layout } = await import("./paths")
  const input = layout()
  if (args[0] === "paths") {
    console.log(JSON.stringify(input, null, 2))
    return
  }
  const { prepare } = await import("./storage")
  prepare(input)
  const { Effect } = await import("effect")
  const program = Effect.gen(function* () {
    if (serving) {
      const { serve } = yield* Effect.promise(() => import("./server"))
      yield* serve(input, port)
      return
    }
    const { open } = yield* Effect.promise(() => import("./host"))
    yield* open(input)
    console.log(`${banner}: ${args[0] === "init" ? "initialized" : "ready"}`)
    console.log(`Database: ${input.database}`)
    if (args[0] === "preview") yield* Effect.never
  })
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    await Effect.runPromise(Effect.scoped(program), { signal: controller.signal })
  } catch (error) {
    if (!controller.signal.aborted) throw error
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
