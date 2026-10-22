import { errorMessage } from "@/util/error"
import { Log } from "@opencode-ai/core/util/log"
import { UI } from "@/cli/ui"

const log = Log.create({ service: "kilocode.cloud-session" })

/**
 * Validate --cloud-fork flag combinations and return an error message if invalid.
 */
export function validateCloudFork(args: {
  cloudFork?: boolean
  fork?: boolean
  continue?: boolean
  session?: string
}): string | undefined {
  if (!args.cloudFork) return
  if (args.fork) return "--cloud-fork cannot be used with --fork"
  if (args.continue) return "--cloud-fork cannot be used with --continue"
  if (!args.session) return "--cloud-fork requires --session"
}

export function localSessionID(args: { cloudFork?: boolean; session?: string }) {
  return args.cloudFork ? undefined : args.session
}

/**
 * Import a cloud session to local storage and return the new local session ID.
 * Wraps the SDK's `.kilo.cloud.session.import()` which returns `unknown` due to
 * the OpenAPI spec not typing the response.
 *
 * Throws when the import fails: with the server's error message on an HTTP
 * error, or with "cloud session import returned no session id" when the
 * response was malformed.
 */
export async function importCloudSession(
  client: {
    kilo: {
      cloud: {
        session: {
          import: (params: { sessionId: string }) => Promise<{ data?: unknown; error?: unknown }>
        }
      }
    }
  },
  sessionId: string,
): Promise<string> {
  const result = await client.kilo.cloud.session.import({ sessionId })
  if (result.error) throw new Error(importErrorReason(result.error))
  const id = (result.data as Record<string, unknown>)?.id
  if (typeof id !== "string") throw new Error("cloud session import returned no session id")
  return id
}

/**
 * Extract a human-readable reason from a failed cloud-session import.
 * The gateway returns errors as `{ error: string }` (400/500), while other
 * SDK error shapes carry `.message`/`.data.message`. Prefer the `error`
 * field so the real server reason reaches the user instead of `[object Object]`.
 */
function importErrorReason(error: unknown): string {
  const err = error as { error?: unknown }
  if (typeof err.error === "string" && err.error) return err.error
  return errorMessage(error)
}

/**
 * Report a failed cloud-session import: log the cause at DEBUG and surface a
 * human-readable message via `UI.error`. Returns `void` on purpose — it does
 * not throw, so each caller keeps its own deterministic exit semantics
 * (`process.exit` / `exitCode` / `shutdownAndExit` / typed `return`). The
 * caller must still perform that exit after calling this.
 */
export function reportCloudImportError(err: unknown): void {
  log.debug("failed to import cloud session", { err })
  UI.error(`Failed to import session from cloud: ${errorMessage(err)}`)
}
