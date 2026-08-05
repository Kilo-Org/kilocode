import type { Config } from "../../config/config"
import { InvalidError } from "@opencode-ai/core/v1/config/error"

export type McpHeaderWarning = {
  path: string
  message: string
}

/**
 * Untrusted project MCP headers must not resolve secrets.
 * Reject {env:} (no process.env / authEnv) and {file:} — same style for both.
 * Does not read process.env or the caller env map.
 */
function rejectSecretHeaderValue(value: string, source: string) {
  if (!value.includes("{env:") && !value.includes("{file:")) return value

  const envRef = value.match(/\{env:[^}]+\}/)
  if (envRef) {
    throw new InvalidError({
      path: source,
      message: `environment references are not expanded in untrusted MCP headers: "${envRef[0]}"`,
    })
  }

  const fileRef = value.match(/\{file:[^}]+\}/)
  if (fileRef) {
    throw new InvalidError({
      path: source,
      message: `file references are not expanded in MCP headers: "${fileRef[0]}"`,
    })
  }

  return value
}

/**
 * Post-parse: reject secret-bearing tokens in remote MCP headers for project (untrusted) config.
 * On failure for one MCP, drop that entry and warn — do not wipe sibling MCPs.
 *
 * The env parameter is accepted for call-site compatibility but is intentionally unused:
 * untrusted project headers must not read process.env or authEnv.
 */
export async function expandProjectMcpHeaders(
  data: Config.Info,
  _env: Record<string, string> | undefined,
  source: string,
): Promise<{ config: Config.Info; warnings: McpHeaderWarning[] }> {
  if (!data.mcp) return { config: data, warnings: [] }

  const warnings: McpHeaderWarning[] = []
  const next: NonNullable<Config.Info["mcp"]> = { ...data.mcp }

  for (const [name, mcp] of Object.entries(data.mcp)) {
    if (!mcp || typeof mcp !== "object") continue
    if (!("type" in mcp) || mcp.type !== "remote") continue
    if (!mcp.headers || typeof mcp.headers !== "object") continue

    const needsCheck = Object.values(mcp.headers).some(
      (v) => typeof v === "string" && (v.includes("{env:") || v.includes("{file:")),
    )
    if (!needsCheck) continue

    try {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(mcp.headers)) {
        headers[key] = typeof value === "string" ? rejectSecretHeaderValue(value, source) : value
      }
      next[name] = { ...mcp, headers }
    } catch (error) {
      delete next[name]
      const detail = InvalidError.isInstance(error)
        ? error.data.message
        : error instanceof Error
          ? error.message
          : String(error)
      warnings.push({
        path: source,
        message: `Skipped MCP "${name}": header env expansion failed (${detail})`,
      })
    }
  }

  return { config: { ...data, mcp: next }, warnings }
}
