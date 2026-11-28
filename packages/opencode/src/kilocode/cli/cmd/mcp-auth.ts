import { Effect } from "effect"
import type { MCP } from "@/mcp"

export namespace KilocodeMcpAuth {
  export type Outcome = { ok: true } | { ok: false; level: "error" | "warn"; message: string }

  type Spinner = { stop: (message: string, code?: number) => void }
  type Log = {
    log: { error: (message: string) => void; warn: (message: string) => void; info: (message: string) => void }
  }

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
        message: `MCP server ${name} connected, but its stored credentials are already expired, so authentication could not be confirmed. Run \`kilo mcp logout ${name}\` to remove them. Running \`kilo mcp auth ${name}\` again only helps if the server issues an OAuth challenge.`,
      }
    return {
      ok: false,
      level: "error",
      message: `MCP server ${name} connected without requesting OAuth, so no credentials were stored. The server did not return a 401 or WWW-Authenticate challenge, so Kilo could not start the OAuth flow.`,
    }
  }

  /**
   * Report a "connected" result from `MCP.authenticate` after verifying that credentials were
   * actually stored. Other statuses are handled by the upstream command.
   */
  export const connected = Effect.fn("KilocodeMcpAuth.connected")(function* (input: {
    mcp: Pick<MCP.Interface, "getAuthStatus">
    serverName: string
    spinner: Spinner
    prompts: Log
  }) {
    const { spinner, prompts } = input
    const result = outcome(input.serverName, yield* input.mcp.getAuthStatus(input.serverName))
    if (result.ok) return spinner.stop("Authentication successful!")
    spinner.stop("Authentication not confirmed", 1)
    prompts.log[result.level](result.message)
  })
}
