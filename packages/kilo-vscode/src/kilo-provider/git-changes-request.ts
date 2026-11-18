import type { Mention, ToWebview } from "../protocol"
import { captureGitChangesContext } from "./git-changes-context"
import { resolveGitChangesTarget } from "./git-changes-target"

type Context = {
  /** The host's own directory, for a request that names none. */
  directory: string
  post: (message: ToWebview) => void
  error: (error: unknown) => string
}

/** Answers `@git-changes`: the diff of the session's directory, against its base when it has one. */
export async function handleGitChangesRequest(
  message: Extract<Mention, { type: "requestGitChangesContext" }>,
  ctx: Context,
): Promise<void> {
  const target = await resolveGitChangesTarget({ directory: message.directory ?? ctx.directory, base: message.base })
  await captureGitChangesContext({
    requestId: message.requestId,
    dir: target.directory,
    base: target.base,
    post: ctx.post,
    error: ctx.error,
  }).catch((e: unknown) => console.error("[Kilo] git changes error:", e))
}
