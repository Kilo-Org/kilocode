import { realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import type { ConfigVariableGuard } from "./variable"

export namespace ExternalMarkdown {
  type Origins = Record<string, Record<string, "global" | "local">>

  function expand(pattern: string) {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
    return pattern
  }

  function normalize(value: string) {
    const result = path.normalize(value)
    return process.platform === "win32" ? result.toLowerCase() : result
  }

  function bounded(pattern: string, root: string) {
    const value = expand(pattern).replaceAll("\\", "/")
    const index = value.search(/[?*]/)
    if (index === -1) return false
    const prefix = value.slice(0, index).replace(/\/+$/, "")
    if (!path.isAbsolute(prefix) || value.slice(prefix.length) !== "/*") return false
    try {
      return normalize(realpathSync.native(prefix)) === normalize(root)
    } catch {
      return false
    }
  }

  function allowed(root: string, permission: ConfigPermissionV1.Info | undefined, origins: Origins | undefined) {
    const rule = permission?.markdown_source
    if (!rule || typeof rule === "string") return false
    const winner = Object.entries(rule)
      .filter(([, action]) => action !== null)
      .findLast(([pattern]) => bounded(pattern, root))
    if (!winner || origins?.markdown_source?.[winner[0]] !== "global") return false
    return winner[1] === "allow"
  }

  export function scopes(input: {
    dir: string
    names: readonly string[]
    permission: ConfigPermissionV1.Info | undefined
    origins: Origins | undefined
  }): ConfigVariableGuard.FileScope[] {
    const result: ConfigVariableGuard.FileScope[] = []
    for (const name of input.names) {
      const source = path.join(input.dir, name)
      try {
        const root = realpathSync.native(source)
        if (normalize(root) === normalize(source)) continue
        if (!allowed(root, input.permission, input.origins)) continue
        result.push({ root, source })
      } catch {
        continue
      }
    }
    return result
  }
}
