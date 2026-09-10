import { execFile } from "node:child_process"
import { access, lstat, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { Option, Schema } from "effect"
import { connectV2 } from "./connection"

const execute = promisify(execFile)
const Status = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ state: Schema.Literal("running"), file: Schema.String, url: Schema.String, pid: Schema.Int }),
    Schema.Struct({ state: Schema.Literal("stopped") }),
    Schema.Struct({ state: Schema.Literal("stale"), alive: Schema.Boolean }),
  ]),
)
const Registration = Schema.fromJsonString(
  Schema.Struct({
    url: Schema.String,
    password: Schema.String,
    pid: Schema.Int,
  }),
)

export async function startLocalServer(input: {
  extensionRoot: string
  cliPath?: string
  directory?: string
  signal?: AbortSignal
}) {
  const command = await localCommand(input.extensionRoot, input.cliPath)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  const options = {
    cwd: input.directory,
    signal: input.signal,
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env,
  }
  const current = Schema.decodeUnknownSync(Status)(
    (await execute(command[0], [...command.slice(1), "service", "status"], options)).stdout,
  )
  // Opening an editor must not replace an incompatible daemon used by another client.
  if (current.state === "stale" && current.alive)
    throw new Error(
      "A running Kilo server cannot be reused by this CLI version. Stop or update it explicitly, then reconnect.",
    )
  const status =
    current.state === "running"
      ? current
      : Schema.decodeUnknownSync(Status)(
          (await execute(command[0], [...command.slice(1), "service", "start"], options)).stdout,
        )
  if (status.state !== "running") throw new Error("Kilo server did not become ready; reconnect to try again")
  if (!path.isAbsolute(status.file)) throw new Error("Kilo returned a non-absolute daemon registration path")
  const stat = await lstat(status.file)
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("Kilo daemon registration must be a private file owned by the current user")
  const registration = Option.getOrUndefined(
    Schema.decodeUnknownOption(Registration)(await readFile(status.file, "utf8")),
  )
  if (!registration) throw new Error("Kilo daemon registration could not be decoded")
  if (registration.pid !== status.pid || registration.url !== status.url)
    throw new Error("Kilo daemon changed during startup; reconnect to try again")
  const verified = await connectV2({ url: registration.url, password: registration.password, signal: input.signal })
  if (verified.health.pid !== registration.pid) throw new Error("Kilo daemon identity did not match its registration")
  return { ...verified, url: registration.url, password: registration.password }
}

async function localCommand(extensionRoot: string, configured?: string): Promise<[string, ...string[]]> {
  if (configured?.trim()) return [configured.trim()]
  // Development runs the current checkout, using its already packaged Bun runtime.
  const cli = path.resolve(extensionRoot, "../kilo-cli")
  const runtime = path.join(cli, "dist/interactive/bun")
  const entry = path.join(cli, "src/tui-preview.ts")
  if ((await available(runtime)) && (await available(entry, constants.R_OK))) return [runtime, "--no-env-file", entry]
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue
    const executable = path.join(directory, process.platform === "win32" ? "kilo2.exe" : "kilo2")
    if (await available(executable)) return [executable]
  }
  throw new Error("Kilo CLI was not found. Install kilo2 or set Kilo v2 › CLI Path to its executable.")
}

async function available(file: string, mode = constants.X_OK) {
  return access(file, mode).then(
    () => true,
    () => false,
  )
}
