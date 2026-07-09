import { Schema } from "effect"

export namespace SandboxConfig {
  export const Network = Schema.Literals(["allow", "deny"])
  export type Network = Schema.Schema.Type<typeof Network>

  export const Info = Schema.Struct({
    enabled: Schema.optional(
      Schema.Boolean.annotate({ description: "Enable sandbox confinement for new sessions (default: false)" }),
    ),
    network: Schema.optional(
      Network.annotate({ description: "Control outbound network access from sandboxed tools (default: deny)" }),
    ),
    writable_paths: Schema.optional(
      Schema.mutable(Schema.Array(Schema.String)).annotate({
        description: "Additional filesystem paths that sandboxed tools may write to",
      }),
    ),
  }).annotate({ description: "Sandbox configuration for agent tools" })
  export type Info = Schema.Schema.Type<typeof Info>

  export function resolve(config: { sandbox?: Info }) {
    return {
      enabled: config.sandbox?.enabled ?? false,
      mode: config.sandbox?.network ?? "deny",
    }
  }

  export function scope<T extends { sandbox?: Info }>(config: T, source: "global" | "local"): T {
    if (source === "global" || config.sandbox === undefined) return config
    const scoped = { ...config }
    const sandbox: Info = {
      ...(config.sandbox.enabled === true ? { enabled: true } : {}),
      ...(config.sandbox.network === "deny" ? { network: "deny" as const } : {}),
    }
    if (Object.keys(sandbox).length > 0) scoped.sandbox = sandbox
    else delete scoped.sandbox
    return scoped
  }
}
