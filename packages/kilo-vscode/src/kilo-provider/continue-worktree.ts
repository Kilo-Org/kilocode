type Progress = (status: string, detail?: string, error?: string) => void

type Ctx = {
  sessionId?: string
  handler?: (sessionId: string, progress: Progress) => Promise<void>
  post: (message: { type: "continueInWorktreeProgress"; status: string; detail?: string; error?: string }) => void
}

export function handleContinueInWorktree(ctx: Ctx): void {
  if (ctx.sessionId && ctx.handler) {
    ctx
      .handler(ctx.sessionId, (status, detail, error) => {
        ctx.post({ type: "continueInWorktreeProgress", status, detail, error })
      })
      .catch((err: unknown) => {
        console.error("[Kilo New] continueInWorktree failed:", err)
        ctx.post({
          type: "continueInWorktreeProgress",
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return
  }

  if (!ctx.sessionId) return
  console.error("[Kilo New] continueInWorktree: no handler registered")
  ctx.post({
    type: "continueInWorktreeProgress",
    status: "error",
    error: "Continue in Worktree is not available",
  })
}
