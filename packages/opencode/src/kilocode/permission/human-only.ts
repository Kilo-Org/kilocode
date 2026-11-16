// kilocode_change - new file
import { SecurityAsk } from "@/kilocode/security-decision/ask"

/**
 * Asks that only a human may answer.
 *
 * The server refuses a machine reply to these and leaves the prompt pending; a client in auto mode
 * must therefore show them rather than answer them. The two sides used to spell the set out
 * separately and drifted: the client auto-answered a sandbox escalation, the server refused that
 * answer, and because the client had already taken its auto-reply branch it never displayed the
 * prompt — so the request waited for a human nobody had told, and the turn hung with no error.
 *
 * Kept dependency-free (no Effect, no node) so the TUI imports the same predicate the server uses.
 */
export namespace PermissionHumanOnly {
  export function requires(metadata: Record<string, unknown> | undefined): boolean {
    return metadata?.["skillShell"] === true || metadata?.["sandboxEscalation"] === true || SecurityAsk.is(metadata)
  }
}
