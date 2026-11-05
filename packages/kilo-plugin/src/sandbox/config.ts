import path from "node:path"
import { normalizeDestinations, parseDestination } from "@kilocode/sandbox"
import type { Config } from "@opencode/schema/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"

export namespace SandboxConfig {
  export type Network = "allow" | "deny"

  export type Info = {
    enabled?: boolean
    network?: Network
    writable_paths?: string[]
    allowed_hosts?: string[]
  }

  function destination(value: string) {
    try {
      parseDestination(value)
      return true
    } catch {
      return false
    }
  }

  export function resolve(config: { sandbox?: Info }) {
    const hosts = normalizeDestinations((config.sandbox?.allowed_hosts ?? []).filter(destination))
    const restricted = config.sandbox?.network !== "allow"
    return {
      enabled: config.sandbox?.enabled ?? false,
      mode: restricted ? (hosts.length > 0 ? ("proxy" as const) : ("deny" as const)) : ("allow" as const),
      allowedHosts: restricted ? hosts : [],
      writablePaths: [...(config.sandbox?.writable_paths ?? [])],
    }
  }

  export function scope<T extends { sandbox?: Info }>(config: T, source: "global" | "local"): T {
    if (source === "global" || config.sandbox === undefined) return config
    const scoped = { ...config }
    const sandbox: Info = {
      ...(config.sandbox.enabled === true ? { enabled: true } : {}),
      ...(config.sandbox.network === "deny" ? { network: "deny" as const, allowed_hosts: [] } : {}),
    }
    if (Object.keys(sandbox).length > 0) scoped.sandbox = sandbox
    else delete scoped.sandbox
    return scoped
  }

  /**
   * The effective `sandbox` setting of the location's config entries, in precedence order. Only global documents (the
   * kilo2 config directory, or a document without a file such as inline config content) can widen the sandbox; a
   * project document can only enable it or restrict the network.
   */
  export function fromEntries(entries: readonly Config.Entry[], global: string): { sandbox?: Info } {
    return entries.reduce<{ sandbox?: Info }>((result, entry) => {
      if (entry.type !== "document" || !(entry.info instanceof KiloConfigPolicy.Info) || !entry.info.sandbox)
        return result
      const source = !entry.path || inside(global, entry.path) ? "global" : "local"
      const next = scope({ sandbox: copy(entry.info.sandbox) }, source).sandbox
      if (!next) return result
      // A later document replaces each field it sets, arrays included.
      return { sandbox: { ...result.sandbox, ...next } }
    }, {})
  }

  function copy(value: NonNullable<KiloConfigPolicy.Info["sandbox"]>): Info {
    return {
      ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
      ...(value.network !== undefined ? { network: value.network } : {}),
      ...(value.writable_paths !== undefined ? { writable_paths: [...value.writable_paths] } : {}),
      ...(value.allowed_hosts !== undefined ? { allowed_hosts: [...value.allowed_hosts] } : {}),
    }
  }

  function inside(root: string, file: string) {
    const relative = path.relative(root, file)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }
}
