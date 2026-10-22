import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createContextRequests } from "../../webview-ui/src/hooks/context-requests"
import { type CapturedGitChangesScope, useGitChangesContext } from "../../webview-ui/src/hooks/useGitChangesContext"

test("context requests settle by ID, time out, and preserve cleanup semantics", async () => {
  const ctx = createContextRequests("context", 5, "Timed out")
  const first = ctx.request(() => {}).catch((err: Error) => err.message)
  const second = ctx.request((id) => ctx.settle(id, (req) => req.resolve("second")))
  await expect(second).resolves.toBe("second")
  ctx.settle("context-2", () => {
    throw new Error("Late settlement")
  })
  expect(ctx.pending()).toBe(true)
  await expect(first).resolves.toBe("Timed out")
  expect(ctx.pending()).toBe(false)

  for (const reset of [false, true]) {
    const result = ctx.request(() => {}).catch((err: Error) => err.message)
    ctx.dispose("Cancelled", reset)
    await expect(result).resolves.toBe("Cancelled")
    expect(ctx.pending()).toBe(!reset)
  }
})

test("Git attachment requests preserve captured absent and concrete worktree scopes", async () => {
  const posted: Array<Record<string, unknown>> = []
  const handlers: Array<(message: unknown) => void> = []
  const vscode = {
    postMessage: (message: unknown) => posted.push(message as Record<string, unknown>),
    onMessage: (handler: (message: unknown) => void) => {
      handlers.push(handler)
      return () => handlers.splice(handlers.indexOf(handler), 1)
    },
  }
  let dispose = () => {}
  let live!: () => string | undefined
  let setLive!: (value: string | undefined) => void
  const git = createRoot((cleanup) => {
    dispose = cleanup
    const [context, update] = createSignal<string>()
    live = context
    setLive = update
    return useGitChangesContext(vscode as never, context, () => true)
  })
  const settle = (index: number) => {
    const requestId = posted[index]?.requestId
    for (const handler of handlers) handler({ type: "gitChangesContextResult", requestId, content: "git diff" })
  }

  const absent: CapturedGitChangesScope = { captured: true, available: true }
  setLive("worktree-b")
  const absentRequest = git.resolveAttachment("Review @git-changes", "session", absent)
  setLive("worktree-c")
  await Promise.resolve()
  expect(posted[0]).not.toHaveProperty("agentManagerContext")
  settle(0)
  await expect(absentRequest).resolves.toBeDefined()

  setLive("worktree-a")
  const concrete: CapturedGitChangesScope = {
    captured: true,
    agentManagerContext: live(),
    available: true,
  }
  setLive("worktree-b")
  const concreteRequest = git.resolveAttachment("Review @git-changes", "session", concrete)
  setLive("worktree-c")
  await Promise.resolve()
  expect(posted[1]).toHaveProperty("agentManagerContext", "worktree-a")
  settle(1)
  await expect(concreteRequest).resolves.toBeDefined()
  dispose()
})
