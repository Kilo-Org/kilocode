import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

export namespace McpAuthMode {
  export function header(config: ConfigMCPV1.Remote) {
    return Object.keys(config.headers ?? {}).some((name) => name.toLowerCase() === "authorization")
  }

  export function oauth(config: ConfigMCPV1.Remote) {
    if (config.oauth === false) return false
    if (config.oauth) return true
    return !header(config)
  }

  export function failure(name: string) {
    return `Server "${name}" rejected the configured Authorization header. Check its value and any referenced environment variables.`
  }
}
