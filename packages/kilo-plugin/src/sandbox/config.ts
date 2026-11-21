import path from "node:path"
import { credentialLocations, expandPath, normalizeDestinations, parseCredentials, parseDestination } from "@kilocode/sandbox"
import type { Config } from "@opencode/schema/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"

export namespace SandboxConfig {
  export type Network = "allow" | "deny"

  export type Info = {
    enabled?: boolean
    network?: Network
    writable_paths?: string[]
    allowed_hosts?: string[]
    read_paths?: string[]
    read_exceptions?: string[]
    /** Raw entries: the sandbox plugin validates each one, so one bad entry cannot discard the others. */
    credentials?: readonly unknown[]
  }

  function destination(value: string) {
    try {
      parseDestination(value)
      return true
    } catch {
      return false
    }
  }

  const reported = new Set<string>()

  function report(message: string) {
    if (reported.has(message)) return
    reported.add(message)
    process.stderr.write(`kilo-sandbox: ${message}\n`)
  }

  /** Expands configured paths once, at the config boundary, and drops an entry that stays relative. */
  function grants(values: readonly string[] | undefined) {
    return (values ?? []).flatMap((value) => {
      const expanded = expandPath(value)
      if (expanded !== undefined) return [expanded]
      report(`ignored relative sandbox path ${JSON.stringify(value)}`)
      return []
    })
  }

  /**
   * Only the built-in credential locations are lifted from nono's deny list by exact match, so any other exception
   * would be persisted and then do nothing. Keep the supported ones and report the rest.
   */
  function exceptions(values: readonly string[] | undefined) {
    const locations = new Set(credentialLocations.flatMap((entry) => {
      const expanded = expandPath(entry)
      return expanded === undefined ? [] : [expanded]
    }))
    return (values ?? []).flatMap((value) => {
      const expanded = expandPath(value)
      if (expanded === undefined) {
        report(`ignored relative sandbox path ${JSON.stringify(value)}`)
        return []
      }
      if (!locations.has(expanded)) {
        report(`ignored unsupported sandbox read exception ${JSON.stringify(value)}`)
        return []
      }
      return [expanded]
    })
  }

  /** The environment variable a raw entry would read, so a dropped entry can still have its real value masked. */
  function sourceEnv(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const source = (value as Record<string, unknown>).source
    if (typeof source !== "string") return undefined
    return /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/.exec(source)?.[1]
  }

  /**
   * Validates each entry on its own so one malformed credential cannot discard the rest, then applies the
   * uniqueness rules over the survivors. `parseCredentials` checks those rules for a whole file and throws, so a
   * duplicate would otherwise pass here while only the last definition reached the profile. The returned
   * `masked` names a dropped entry's variable so the caller can deny it, but never a surviving route's
   * variable: nono already masks the active routes, and denying one would starve the kept credential.
   */
  function routes(values: readonly unknown[]) {
    const masked = new Set<string>()
    const parsed = values.flatMap((value, index) => {
      try {
        return parseCredentials({ credentials: [value] })
      } catch {
        // The parser embeds the offending value in its message, so report only the position: a token pasted into
        // `source` or a credential-bearing URL must not reach the process log.
        const env = sourceEnv(value)
        if (env !== undefined) masked.add(env)
        report(`ignored invalid sandbox credential at index ${index}`)
        return []
      }
    })
    const names = new Set<string>()
    const variables = new Set<string>()
    const credentials = parsed.filter((credential) => {
      if (names.has(credential.name)) {
        masked.add(credential.envVar)
        report(`ignored sandbox credential with duplicate name ${credential.name}`)
        return false
      }
      if (variables.has(credential.envVar)) {
        masked.add(credential.envVar)
        report(`ignored sandbox credential reading ${credential.envVar} twice`)
        return false
      }
      names.add(credential.name)
      variables.add(credential.envVar)
      return true
    })
    const kept = new Set(credentials.map((credential) => credential.envVar))
    return { credentials, masked: [...masked].filter((envVar) => !kept.has(envVar)) }
  }

  export function resolve(config: { sandbox?: Info }) {
    const hosts = normalizeDestinations((config.sandbox?.allowed_hosts ?? []).filter(destination))
    const restricted = config.sandbox?.network !== "allow"
    const entries = routes(config.sandbox?.credentials ?? [])
    return {
      enabled: config.sandbox?.enabled ?? false,
      mode: restricted ? (hosts.length > 0 ? ("proxy" as const) : ("deny" as const)) : ("allow" as const),
      allowedHosts: restricted ? hosts : [],
      writablePaths: [...(config.sandbox?.writable_paths ?? [])],
      readPaths: grants(config.sandbox?.read_paths),
      readExceptions: exceptions(config.sandbox?.read_exceptions),
      credentials: entries.credentials,
      maskedEnv: entries.masked,
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
      ...(value.read_paths !== undefined ? { read_paths: [...value.read_paths] } : {}),
      ...(value.read_exceptions !== undefined ? { read_exceptions: [...value.read_exceptions] } : {}),
      ...(value.credentials !== undefined ? { credentials: [...value.credentials] } : {}),
    }
  }

  function inside(root: string, file: string) {
    const relative = path.relative(root, file)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }
}
