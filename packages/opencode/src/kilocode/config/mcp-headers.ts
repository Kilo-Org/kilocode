import { Config } from "@/config/config"
import { ConfigVariable } from "@/config/variable"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import { isRecord } from "@/util/record"

function isRemoteMcp(entry: unknown): entry is { type: "remote"; headers?: Record<string, string> } {
  return isRecord(entry) && entry.type === "remote"
}

async function expandHeaderValue(value: string, env: Record<string, string> | undefined, source: string) {
  return ConfigVariable.substitute({
    text: value,
    type: "virtual",
    source,
    dir: "",
    trusted: true,
    env,
  })
}

/** Expand `{env:…}` in project MCP headers after untrusted config load; drop only offending MCPs. */
export async function expandProjectMcpHeaders(
  config: Config.Info,
  env: Record<string, string> | undefined,
  source: string,
): Promise<{ config: Config.Info; warnings: Config.Warning[] }> {
  if (!config.mcp) return { config, warnings: [] }

  const warnings: Config.Warning[] = []
  const mcp = { ...config.mcp }

  for (const [name, entry] of Object.entries(mcp)) {
    if (!isRemoteMcp(entry) || !entry.headers) continue
    if (!Object.values(entry.headers).some((value) => /\{env:[^}]+\}/.test(value))) continue

    try {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(entry.headers)) {
        headers[key] = await expandHeaderValue(value, env, source)
      }
      mcp[name] = { ...entry, headers }
    } catch (err) {
      delete mcp[name]
      const message =
        err instanceof InvalidError
          ? err.data.message
          : err instanceof Error
            ? err.message
            : String(err)
      warnings.push({
        path: source,
        message: `Skipped MCP "${name}": ${message}`,
      })
    }
  }

  return { config: { ...config, mcp }, warnings }
}
