import { errorMessage } from "@/util/error"

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
  if (result.error) throw new Error(errorMessage(result.error))
  const id = (result.data as Record<string, unknown>)?.id
  if (typeof id !== "string") throw new Error("cloud session import returned no session id")
  return id
}
