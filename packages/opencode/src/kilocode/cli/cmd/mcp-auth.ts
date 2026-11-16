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
   * Report the result of `MCP.authenticate`. For "connected" it verifies that credentials were
   * actually stored; every other status keeps the messages and exit codes of the upstream handler.
   */
  export const report = Effect.fn("KilocodeMcpAuth.report")(function* (input: {
    status: MCP.Status
    mcp: Pick<MCP.Interface, "getAuthStatus">
    serverName: string
    serverUrl: string
    spinner: Spinner
    prompts: Log
  }) {
    const { status, spinner, prompts, serverName } = input
    if (status.status === "connected") {
      const result = outcome(serverName, yield* input.mcp.getAuthStatus(serverName))
      if (result.ok) return spinner.stop("Authentication successful!")
      spinner.stop("Authentication not confirmed", 1)
      return prompts.log[result.level](result.message)
    }
    if (status.status === "needs_client_registration") {
      spinner.stop("Authentication failed", 1)
      prompts.log.error(status.error)
      prompts.log.info("Add clientId to your MCP server config:")
      return prompts.log.info(`
  "mcp": {
    "${serverName}": {
      "type": "remote",
      "url": "${input.serverUrl}",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`)
    }
    if (status.status === "failed") {
      spinner.stop("Authentication failed", 1)
      return prompts.log.error(status.error)
    }
    spinner.stop("Unexpected status: " + status.status, 1)
  })
}
