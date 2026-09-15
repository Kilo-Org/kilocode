// kilocode_change - new file
// Pure helpers for the permission prompt view, extracted so they are unit-testable
// (the JSX in permission.tsx is not). `permissionOptions` decides which buttons to offer; `mcpEnvelope`
// extracts the SAFE MCP display envelope (server + tool + argument KEY names only, never values).
import { requiresInteractiveApproval } from "@/kilocode/permission/interactive-approval"

type Meta = { readonly [k: string]: unknown } | undefined

/**
 * Buttons for a permission prompt. Requests that require an interactive human (skillShell /
 * sandboxEscalation / actionGateDegraded) and config-protection requests are ONE-SHOT: no "Allow always",
 * so the UI never promises a persistent rule the server will not save.
 */
export function permissionOptions(metadata: Meta, disableAlways: boolean): Record<string, string> {
  if (requiresInteractiveApproval(metadata) || disableAlways) return { once: "Allow once", reject: "Reject" }
  return { once: "Allow once", always: "Allow always", reject: "Reject" }
}

/** Safe MCP envelope for the prompt: server + tool + argument KEY names only — never argument values. */
export function mcpEnvelope(metadata: Meta): { server: string; tool: string; argKeys: string[] } | undefined {
  const server = typeof metadata?.["server"] === "string" ? (metadata["server"] as string) : ""
  const tool = typeof metadata?.["tool"] === "string" ? (metadata["tool"] as string) : ""
  const argKeys = Array.isArray(metadata?.["argKeys"]) ? (metadata["argKeys"] as unknown[]).map(String) : []
  return server || tool || argKeys.length ? { server, tool, argKeys } : undefined
}
