// Fast-path entry for `serve --stdio` (used by the VS Code and JetBrains extensions).
// Skips importing all 40 CLI command specs, `effect/cli`, `KiloUpdater`, `KiloCliConfig`,
// and the redundant CLI-level layer compilation so the stdio server binds and answers faster.
import { ensurePluginRuntime } from "./index"
import { configureLocalNoProxy, runCliProcess } from "./process-main"

export type StdioServeArgs = {
  readonly port?: number
  readonly hostname?: string
  readonly cors?: readonly string[]
}

/**
 * Parse `serve --stdio` flags strictly. Returns `undefined` for any unrecognized flag, `--help`,
 * `--service`, or non-stdio invocation so callers fall through to the full `effect/cli` parser.
 */
export function parseStdioServeArgs(argv: readonly string[]): StdioServeArgs | undefined {
  if (argv[0] !== "serve") return undefined
  let stdio = false
  let port: number | undefined
  let hostname: string | undefined
  const cors: string[] = []
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--stdio") {
      stdio = true
      continue
    }
    if (arg === "--port" || arg.startsWith("--port=")) {
      const raw = arg === "--port" ? argv[++i] : arg.slice("--port=".length)
      if (raw === undefined || !/^\d+$/.test(raw)) return undefined
      port = Number(raw)
      continue
    }
    if (arg === "--hostname" || arg.startsWith("--hostname=")) {
      const raw = arg === "--hostname" ? argv[++i] : arg.slice("--hostname=".length)
      if (!raw) return undefined
      hostname = raw
      continue
    }
    if (arg === "--cors" || arg.startsWith("--cors=")) {
      const raw = arg === "--cors" ? argv[++i] : arg.slice("--cors=".length)
      if (!raw) return undefined
      cors.push(raw)
      continue
    }
    return undefined
  }
  if (!stdio) return undefined
  return { port, hostname, cors: cors.length > 0 ? cors : undefined }
}

export async function runStdioServe(parsed: StdioServeArgs): Promise<void> {
  configureLocalNoProxy()
  ensurePluginRuntime()

  // Load KiloHost, ServerProcess, and @opencode/server/process concurrently.
  const [{ KiloHost }, { ServerProcess }] = await Promise.all([
    import("./host"),
    import("./server-process"),
    import("@opencode/server/process"),
  ])

  runCliProcess(
    ServerProcess.run({
      mode: "stdio",
      hostname: parsed.hostname,
      port: parsed.port,
      cors: parsed.cors,
      overrides: KiloHost.overrides,
    }),
  )
}
