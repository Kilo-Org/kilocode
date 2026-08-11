import { Runner } from "../core/browser/runner"
import { dispatch } from "./dispatch"
import { DaemonServer, setDispatch, setShutdown } from "./server"

export async function start(): Promise<void> {
  const sessionArg = process.argv.find((arg) => arg.startsWith("--session="))
  const idleArg = process.argv.find((arg) => arg.startsWith("--idle="))
  const session = sessionArg?.slice("--session=".length) ?? "default"
  if (!session) throw new Error("--session=<id> is required")
  const env = process.env["KILO_WORLD_DAEMON_IDLE_MS"]
  const raw = idleArg?.slice("--idle=".length) ?? env
  const idle = raw === undefined ? undefined : Number(raw)
  if (idle !== undefined && !Number.isFinite(idle)) throw new Error("idle timeout must be a finite number")
  setDispatch(dispatch)
  setShutdown(() => Runner.shutdown())
  await DaemonServer.start({
    sessionID: session,
    silent: process.env["KILO_WORLD_DAEMON_SILENT"] === "1",
    ...(Number.isFinite(idle) ? { idleTimeoutMs: idle } : {}),
  })
  await new Promise(() => {})
}
