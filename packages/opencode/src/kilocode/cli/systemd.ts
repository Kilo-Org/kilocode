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

  // Escape an argument for systemd's ExecStart= command-line parser
  // (systemd.syntax(7) "Quoting" + systemd.service(5) "Command Lines").
  //
  // The parser splits on whitespace and recognizes three contexts:
  //   * QUOTE_NONE: backslash followed by any char takes the next char
  //     literally (the EXTRACT_CUNESCAPE flag in exec_command_append
  //     enables this for ExecStart= values).
  //   * QUOTE_SINGLE ('...'): no escaping — everything is literal until
  //     the next single quote.
  //   * QUOTE_DOUBLE ("..."): backslash followed by any char takes the
  //     next char literally.
  //
  // To embed a literal ' inside a single-quoted section, we close the
  // section, emit \' in unquoted context (which the parser reads as a
  // literal '), then reopen a new single-quoted section. This matches
  // the POSIX-shell '\'' bridge and works because the backslash is
  // always between sections, never inside one. Empty string is quoted
  // as '' so systemd does not swallow an empty arg.
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
