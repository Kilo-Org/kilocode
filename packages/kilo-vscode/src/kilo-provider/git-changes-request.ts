import { captureGitChangesContext } from "./git-changes-context"
import { resolveGitChangesTarget } from "./git-changes-target"

type Interceptor = (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>

type Context = {
  workspaceDir: (sessionID: string | undefined) => string
  post: (message: unknown) => void
  error: (error: unknown) => string
  before?: Interceptor | null
}

export async function interceptMessage(
  msg: Record<string, unknown>,
  ctx: Context,
): Promise<Record<string, unknown> | null> {
  const next = ctx.before
    ? await ctx.before(msg).catch((e) => (console.error("[Kilo New] interceptor error:", e), null))
    : msg
  if (next === null || next.type !== "requestGitChangesContext") return next
  const sid = typeof next.sessionID === "string" ? next.sessionID : undefined
  const dir = ctx.workspaceDir(sid)
  const resolved = await resolveGitChangesTarget(next, dir)
  await captureGitChangesContext({
    requestId: typeof resolved.requestId === "string" ? resolved.requestId : "",
    dir: typeof resolved.contextDirectory === "string" ? resolved.contextDirectory : dir,
    base: typeof resolved.gitChangesBase === "string" ? resolved.gitChangesBase : undefined,
    post: ctx.post,
    error: ctx.error,
  }).catch((e) => console.error("[Kilo New] git changes error:", e))
  return null
}
