import { Effect } from "effect"
import type { MCP } from "@/mcp"

export namespace KilocodeMcpAuth {
  export type Outcome = { ok: true } | { ok: false; level: "error" | "warn"; message: string }

  type Spinner = { stop: (message: string, code?: number) => void }
  type Log = { log: { error: (message: string) => void; warn: (message: string) => void } }

  /**
   * `MCP.authenticate` reports "connected" both after a completed OAuth flow and when the
   * server accepted the connection without ever issuing an OAuth challenge (e.g. HTTP 200 to
   * an unauthenticated request). Only stored credentials prove the flow ran.
   *
   * An `expired` status right after a "connected" result is not reported as success: stored
   * tokens that are already past expiry (clock skew, very short lifetimes, or stale tokens from
   * an earlier run) do not show that this run completed OAuth. It is a warning rather than an
   * error because credentials do exist.
   */
  export function outcome(name: string, stored: MCP.AuthStatus): Outcome {
    if (stored === "authenticated") return { ok: true }
    if (stored === "expired")
      return {
        ok: false,
        level: "warn",
        message: `MCP server ${name} connected, but its stored credentials are already expired, so authentication could not be confirmed. Run \`kilo mcp auth ${name}\` again, or remove them with \`kilo mcp logout ${name}\`.`,
      }
    return {
      ok: false,
      level: "error",
      message: `MCP server ${name} connected without requesting OAuth, so no credentials were stored. The server did not return a 401 or WWW-Authenticate challenge, so Kilo could not start the OAuth flow.`,
    }
  }

  /**
   * Report the result of `MCP.authenticate` for the "connected" status, verifying that
   * credentials were actually stored. Other statuses are left to the caller's own handlers.
   */
  export const report = Effect.fn("KilocodeMcpAuth.report")(function* (input: {
    status: Pick<MCP.Status, "status">
    mcp: Pick<MCP.Interface, "getAuthStatus">
    serverName: string
    spinner: Spinner
    prompts: Log
  }) {
    if (input.status.status !== "connected") return
    const result = outcome(input.serverName, yield* input.mcp.getAuthStatus(input.serverName))
    if (result.ok) return input.spinner.stop("Authentication successful!")
    input.spinner.stop("Authentication not confirmed", 1)
    input.prompts.log[result.level](result.message)
  })
}
