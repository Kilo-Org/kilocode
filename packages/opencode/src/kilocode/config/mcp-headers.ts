import type { Config } from "../../config/config"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import { ConfigVariableGuard } from "./variable"

export type McpHeaderWarning = {
  path: string
  message: string
}

/**
 * Expand {env:VAR} in remote MCP header values after untrusted project config parse.
 * Does not resolve {file:} — residual file tokens reject the MCP entry so a decoy
 * in-repo file cannot smuggle out-of-scope paths via trusted substitute.
 */
async function expandHeaderValue(value: string, env: Record<string, string> | undefined, source: string) {
  if (!value.includes("{env:") && !value.includes("{file:")) return value

  const expanded = value.replace(/\{env:([^}]+)\}/g, (match, varName: string) => {
    if (!ConfigVariableGuard.env(varName)) {
      throw new InvalidError({ path: source, message: `blocked environment reference: "{env:${varName}}"` })
    }
    return (env?.[varName] ?? process.env[varName]) || ""
  })

  const residualFile = expanded.match(/\{file:[^}]+\}/)
  if (residualFile) {
    throw new InvalidError({
      path: source,
      message: `file references are not expanded in MCP headers: "${residualFile[0]}"`,
    })
  }

  return expanded
}

/**
 * Post-parse: expand {env:} only in remote MCP headers for project (untrusted) config.
 * On failure for one MCP, drop that entry and warn — do not wipe sibling MCPs.
 */
export async function expandProjectMcpHeaders(
  data: Config.Info,
  env: Record<string, string> | undefined,
  source: string,
): Promise<{ config: Config.Info; warnings: McpHeaderWarning[] }> {
  if (!data.mcp) return { config: data, warnings: [] }

  const warnings: McpHeaderWarning[] = []
  const next: NonNullable<Config.Info["mcp"]> = { ...data.mcp }

  for (const [name, mcp] of Object.entries(data.mcp)) {
    if (!mcp || typeof mcp !== "object") continue
    if (!("type" in mcp) || mcp.type !== "remote") continue
    if (!mcp.headers || typeof mcp.headers !== "object") continue

    const needsExpand = Object.values(mcp.headers).some(
      (v) => typeof v === "string" && (v.includes("{env:") || v.includes("{file:")),
    )
    if (!needsExpand) continue

    try {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(mcp.headers)) {
        headers[key] = typeof value === "string" ? await expandHeaderValue(value, env, source) : value
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
