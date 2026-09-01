import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { useGitChangesContext } from "../../webview-ui/src/hooks/useGitChangesContext"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

test("Git context keeps scope routing, guards, synchronous replies, and cleanup", async () => {
  const sent: WebviewMessage[] = []
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const [scope, setScope] = createSignal("first")
  const [git, setGit] = createSignal(false)
  const root = createRoot((dispose) => ({
    dispose,
    context: useGitChangesContext(
      {
        postMessage: (message) => {
          sent.push(message)
          if (message.type !== "requestGitChangesContext" || message.sessionID === "waiting") return
          for (const handler of handlers) {
            handler({ type: "gitChangesContextResult", requestId: message.requestId, content: "diff" })
          }
        },
        onMessage: (handler) => {
          handlers.add(handler)
          return () => handlers.delete(handler)
        },
      },
      scope,
      git,
    ),
  }))
  expect(await root.context.resolveAttachment("@git-changes")).toBeUndefined()
  setGit(true)
  expect(await root.context.resolveAttachment("plain text")).toBeUndefined()
  expect(sent).toHaveLength(0)
  expect(await root.context.resolveAttachment("@git-changes", "session")).toBeDefined()
  expect(root.context.pending()).toBe(false)
  setScope("second")
  await root.context.resolveAttachment("@git-changes", "session")
  await root.context.resolveAttachment("@git-changes", "session", "explicit")
  expect(sent).toEqual(
    ["first", "second", "explicit"].map((agentManagerContext, index) => ({
      type: "requestGitChangesContext",
      requestId: `git-changes-context-${index + 1}`,
      sessionID: "session",
      agentManagerContext,
    })),
  )
  const waiting = root.context.resolveAttachment("@git-changes", "waiting")
  const rejected = waiting.catch((err: unknown) => err)
  expect(root.context.pending()).toBe(true)
  root.dispose()
  expect(await rejected).toEqual(new Error("Git changes context request cancelled"))
  expect(root.context.pending()).toBe(false)
  expect(handlers.size).toBe(0)
})
