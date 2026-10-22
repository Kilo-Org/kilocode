import { Daemon } from "@/kilocode/daemon/daemon"
import type { resolveNetworkOptions } from "@/cli/network"

export function warnPort(port: number) {
  if (port === 0) return
  if (port < Daemon.PortRange.start || port > Daemon.PortRange.end) {
    console.warn(
      `\x1B[33mPort ${port} is outside the recommended daemon discovery range (${Daemon.PortRange.start}-${Daemon.PortRange.end}). ` +
        `The console will work, but auto-discovery may not find this server.\x1B[0m`,
    )
  }
}

// Shared resolve-and-warn used by the daemon and console commands so their
// network option handling cannot drift apart. Imported lazily by callers, so
// the AppRuntime chain is only loaded when one of those commands runs.
export async function warnedNetworkOptions(args: Parameters<typeof resolveNetworkOptions>[0]) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  const { resolveNetworkOptions } = await import("@/cli/network")
  const opts = await AppRuntime.runPromise(resolveNetworkOptions(args))
  warnPort(opts.port)
  return opts
}
