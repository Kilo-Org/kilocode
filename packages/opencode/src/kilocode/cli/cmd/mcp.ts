import { Effect } from "effect"
import { ConfigParse } from "@/config/parse"
import type { MCP } from "@/mcp"

export namespace KilocodeMcpConfig {
  export function format(file: string, input: string) {
    if (file.endsWith(".jsonc")) return input
    return JSON.stringify(ConfigParse.jsonc(input, file), null, 2)
  }
}

export namespace KilocodeMcpAuth {
  export type Outcome = { ok: true } | { ok: false; message: string }

  type Spinner = { stop: (message: string, code?: number) => void }
  type Log = { log: { error: (message: string) => void } }

  /**
   * `MCP.authenticate` reports "connected" both after a completed OAuth flow and when the
   * server accepted the connection without ever issuing an OAuth challenge (e.g. HTTP 200 to
   * an unauthenticated request). Only stored credentials prove the flow ran.
   */
  export function outcome(name: string, stored: MCP.AuthStatus): Outcome {
    if (stored === "authenticated") return { ok: true }
    return {
      ok: false,
      message: `MCP server ${name} connected without requesting OAuth, so no credentials were stored. The server did not return a 401 or WWW-Authenticate challenge, so Kilo could not start the OAuth flow.`,
    }
  }

  /** Report a "connected" authenticate result, verifying that credentials were actually stored. */
  export const connected = Effect.fn("KilocodeMcpAuth.connected")(function* (input: {
    mcp: Pick<MCP.Interface, "getAuthStatus">
    serverName: string
    spinner: Spinner
    prompts: Log
  }) {
    const result = outcome(input.serverName, yield* input.mcp.getAuthStatus(input.serverName))
    if (result.ok) return input.spinner.stop("Authentication successful!")
    input.spinner.stop("Authentication not performed", 1)
    input.prompts.log.error(result.message)
  })
}
