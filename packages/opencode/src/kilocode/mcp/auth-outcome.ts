import type { AuthStatus } from "@/mcp"

export type AuthOutcome = { ok: true } | { ok: false; message: string }

/**
 * `MCP.authenticate` reports "connected" both after a completed OAuth flow and when the
 * server accepted the connection without ever issuing an OAuth challenge (e.g. HTTP 200 to
 * an unauthenticated request). Only stored credentials prove the flow ran.
 */
export function connectedOutcome(name: string, stored: AuthStatus): AuthOutcome {
  if (stored === "authenticated") return { ok: true }
  return {
    ok: false,
    message: `MCP server ${name} connected without requesting OAuth, so no credentials were stored. The server did not return a 401 or WWW-Authenticate challenge, so Kilo could not start the OAuth flow.`,
  }
}
