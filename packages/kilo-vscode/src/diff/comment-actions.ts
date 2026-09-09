import type { PRStatus } from "../agent-manager/types"
import { replyComment, resolveComment, unresolveComment } from "../agent-manager/pr/PRActions"
import { mutateComment } from "../agent-manager/pr/mutate-comment"
import { execWithShellEnv } from "../agent-manager/shell-env"

interface Context {
  token: string
  directory: string
  branch: string
  pr: PRStatus
}

interface Options {
  context: () => Context | undefined
  post: (message: Record<string, unknown>) => void
  refresh: () => void
  log: (...args: unknown[]) => void
  branch?: (directory: string) => Promise<string>
  actions?: {
    reply: typeof replyComment
    resolve: typeof resolveComment
    unresolve: typeof unresolveComment
    mutate: typeof mutateComment
  }
}

const types = new Set([
  "agentManager.replyComment",
  "agentManager.resolveComment",
  "agentManager.unresolveComment",
  "agentManager.mutateComment",
])

/** Route only live cached PR comments in the current Changes panel. */
export function createDiffCommentActions(opts: Options) {
  const actions = opts.actions ?? {
    reply: replyComment,
    resolve: resolveComment,
    unresolve: unresolveComment,
    mutate: mutateComment,
  }
  const branch =
    opts.branch ??
    (async (directory: string) => {
      const result = await execWithShellEnv("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: directory,
        timeout: 5_000,
      })
      return result.stdout.trim()
    })
  const current = (ctx: Context) => {
    const next = opts.context()
    return (
      next?.token === ctx.token &&
      next.directory === ctx.directory &&
      next.branch === ctx.branch &&
      next.pr.number === ctx.pr.number &&
      next.pr.url === ctx.pr.url
    )
  }
  const validate = (msg: Record<string, unknown>, ctx: Context) => {
    if (msg.projectId !== ctx.token || msg.worktreeId !== "diff" || !current(ctx))
      throw new Error("Diff context changed. Reopen the comment.")
    if (
      (msg.prNumber !== undefined && msg.prNumber !== ctx.pr.number) ||
      (msg.prUrl !== undefined && msg.prUrl !== ctx.pr.url)
    )
      throw new Error("Pull request changed. Refresh and try again.")
    const comments = ctx.pr.comments?.comments ?? []
    if (msg.type === "agentManager.mutateComment") {
      if (msg.action !== "edit" && msg.action !== "delete") throw new Error("Unsupported diff comment action.")
      const comment = comments
        .flatMap((item) => [item, ...(item.replies ?? [])])
        .find((item) => item.id && item.id === msg.commentId)
      if (!comment || !comment[msg.action === "edit" ? "canEdit" : "canDelete"])
        throw new Error("Comment not found or you do not have permission to change it.")
      return
    }
    if (!comments.some((item) => item.threadId === msg.threadId))
      throw new Error("Review thread not found in this diff.")
    if (msg.type === "agentManager.replyComment" && (typeof msg.body !== "string" || !msg.body.trim()))
      throw new Error("Reply cannot be blank.")
  }
  const run = async (msg: Record<string, unknown>) => {
    const ctx = opts.context()
    const result = (success: boolean, error?: string) => {
      // Settle the original scoped request even when its editor is no longer active.
      opts.post({
        type: `${msg.type}Result`,
        projectId: msg.projectId,
        worktreeId: msg.worktreeId,
        threadId: msg.threadId,
        requestId: msg.requestId,
        success,
        ...(error ? { error } : {}),
      })
    }
    try {
      if (!ctx) throw new Error("Pull request metadata is unavailable. Refresh and try again.")
      validate(msg, ctx)
      const name = await branch(ctx.directory)
      if (!name || name === "HEAD" || name !== ctx.branch || !current(ctx))
        throw new Error("Diff branch changed. Refresh and try again.")
      const latest = opts.context()!
      validate(msg, latest)
      if (msg.type === "agentManager.mutateComment") await actions.mutate(msg, latest.pr, ctx.directory)
      else if (msg.type === "agentManager.replyComment")
        await actions.reply(msg.threadId as string, msg.body as string, ctx.directory)
      else if (msg.type === "agentManager.resolveComment") await actions.resolve(msg.threadId as string, ctx.directory)
      else await actions.unresolve(msg.threadId as string, ctx.directory)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      opts.log("Diff comment action failed:", error)
      result(false, error)
      return
    }
    result(true)
    if (ctx && current(ctx)) opts.refresh()
  }
  return {
    handle(msg: Record<string, unknown>) {
      if (typeof msg.type !== "string" || !types.has(msg.type)) return false
      void run(msg)
      return true
    },
  }
}
