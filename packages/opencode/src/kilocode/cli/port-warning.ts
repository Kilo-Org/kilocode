import { Daemon } from "@/kilocode/daemon/daemon"

export function warnPort(port: number) {
  if (port === 0) return
  if (port < Daemon.PortRange.start || port > Daemon.PortRange.end) {
    console.warn(
      `\x1B[33mPort ${port} is outside the recommended daemon discovery range (${Daemon.PortRange.start}-${Daemon.PortRange.end}). ` +
        `The console will work, but auto-discovery may not find this server.\x1B[0m`,
    )
  }
}
