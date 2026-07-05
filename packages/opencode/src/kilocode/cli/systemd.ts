import { existsSync } from "fs"
import path from "path"

export namespace Systemd {
  const UNIT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.service$/

  export function isAvailable(platform: string = process.platform, marker: string = "/run/systemd/system"): boolean {
    if (platform !== "linux") return false
    return existsSync(marker)
  }

  export function userUnitPath(name: string): string {
    const xdg = process.env.XDG_CONFIG_HOME
    if (xdg) return path.join(xdg, "systemd", "user", name)
    const home = process.env.HOME
    if (!home) {
      throw new Error("XDG_CONFIG_HOME or HOME must be set to install a user systemd unit")
    }
    return path.join(home, ".config", "systemd", "user", name)
  }

  export function systemUnitPath(name: string): string {
    return path.join("/etc/systemd/system", name)
  }

  export function unitScope(args: { system?: boolean }): "user" | "system" {
    return args.system ? "system" : "user"
  }

  export function isValidUnitName(name: string): boolean {
    return UNIT_NAME_PATTERN.test(name)
  }

  export function isValidCorsOrigin(origin: string): boolean {
    try {
      const url = new URL(origin)
      return url.protocol === "http:" || url.protocol === "https:"
    } catch {
      return false
    }
  }

  // POSIX shell-friendly escaping using adjacent single-quoted sections with
  // the standard '\'' bridge. systemd.service(5) "Command lines" uses a
  // shell-like grammar; backslash between quoted sections is treated as a
  // literal single quote in unquoted context, matching the effect of sh.
  // Empty string is quoted as '' so systemd does not swallow an empty arg.
  export function quoteArg(value: string): string {
    if (value === "") return "''"
    if (/^[a-zA-Z0-9_\-./:=@]+$/.test(value)) return value
    return "'" + value.replace(/'/g, "'\\''") + "'"
  }

  export function renderUnit(opts: {
    description: string
    execStart: string[]
    user?: boolean
    wantedBy?: string
  }): string {
    const wantedBy =
      opts.wantedBy ?? (opts.user === false ? "multi-user.target" : "default.target")
    const exec = opts.execStart.map(quoteArg).join(" ")
    return [
      "[Unit]",
      `Description=${opts.description}`,
      "",
      "[Service]",
      "Type=simple",
      `ExecStart=${exec}`,
      "Restart=on-failure",
      "RestartSec=5",
      "Environment=NODE_ENV=production",
      "",
      "[Install]",
      `WantedBy=${wantedBy}`,
      "",
    ].join("\n")
  }
}
