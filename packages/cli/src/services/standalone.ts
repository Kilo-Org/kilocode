import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect } from "effect" // kilocode_change(startup)
import { privateLease } from "../kilocode/private-lease" // kilocode_change(startup)
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { randomBytes } from "node:crypto"
import { selfCommand } from "../util/process"

type Options = {
  readonly command?: ReadonlyArray<string>
  readonly earlyLease?: boolean // kilocode_change(startup) - only a TUI that gates API reads opts in
}

const startupDirectory = process.cwd()

function command(password: string, options: Options) {
  const [executable, ...args] = options.command ?? [...selfCommand(), "serve"]
  if (!executable) throw new Error("Failed to resolve standalone server command")
  return ChildProcess.make(executable, [...args, "--stdio", "--port", "0"], {
    cwd: startupDirectory,
    // Explicit entry wins over anything inherited, so a user-exported
    // OPENCODE_PASSWORD cannot shadow the child's lease credential.
    env: { OPENCODE_PASSWORD: password, OPENCODE_PRIVATE_TUI_LEASE: options.earlyLease ? "1" : "0" }, // kilocode_change(startup)
    extendEnv: true,
    // The server treats EOF on this pipe as the end of its ownership lease.
    // The OS closes it even when the TUI is killed before Effect finalizers run.
    stdin: "pipe",
    stderr: process.env.OPENCODE_PRINT_LOGS === "1" ? "inherit" : "ignore",
    killSignal: "SIGTERM",
    forceKillAfter: "3 seconds",
  })
}

const makeEndpoint = Effect.fn("cli.standalone.endpoint")(
  function* (options: Options) {
    const password = randomBytes(32).toString("base64url")
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const proc = yield* spawner.spawn(command(password, options))
    const lease = yield* privateLease(proc.stdout, options.earlyLease) // kilocode_change(startup) - drain stdout and separate bound from ready
    return {
      ...lease, // kilocode_change(startup)
      auth: { type: "basic" as const, username: "opencode", password },
      pid: proc.pid,
      exited: proc.exitCode,
    }
  },
  Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
)

export function start(options: Options = {}) {
  return makeEndpoint(options)
}

export * as Standalone from "./standalone"
