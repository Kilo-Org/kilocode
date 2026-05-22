import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, FileAttachment, WebviewMessage } from "../types/messages"
import { buildGitChangesAttachment, hasGitChangesMention } from "./git-changes-context-utils"

const GIT_CHANGES_TIMEOUT_MS = 15_000

type Pending = {
  resolve: (content: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface GitChangesContext {
  pending: Accessor<boolean>
  resolveAttachment: (text: string, sessionID?: string) => Promise<FileAttachment | undefined>
}

export function useGitChangesContext(
  vscode: VSCodeContext,
  context?: Accessor<string | undefined>,
  git?: Accessor<boolean>,
): GitChangesContext {
  const [pending, setPending] = createSignal(false)
  const requests = new Map<string, Pending>()
  let counter = 0

  const settle = (requestId: string, run: (req: Pending) => void) => {
    const req = requests.get(requestId)
    if (!req) return

    clearTimeout(req.timer)
    requests.delete(requestId)
    setPending(requests.size > 0)
    run(req)
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "gitChangesContextResult") {
      settle(message.requestId, (req) => req.resolve(message.content))
      return
    }

    if (message.type === "gitChangesContextError") {
      settle(message.requestId, (req) => req.reject(new Error(message.error)))
    }
  })

  onCleanup(() => {
    unsubscribe()
    for (const req of requests.values()) {
      clearTimeout(req.timer)
      req.reject(new Error("Git changes context request cancelled"))
    }
    requests.clear()
    setPending(false)
  })

  const request = (sessionID?: string) =>
    new Promise<string>((resolve, reject) => {
      counter++
      const requestId = `git-changes-context-${counter}`
      const timer = setTimeout(() => {
        settle(requestId, (req) => req.reject(new Error("Timed out while reading git changes")))
      }, GIT_CHANGES_TIMEOUT_MS)

      requests.set(requestId, { resolve, reject, timer })
      setPending(true)
      vscode.postMessage({ type: "requestGitChangesContext", requestId, sessionID, agentManagerContext: context?.() })
    })

  const resolveAttachment = async (text: string, sessionID?: string) => {
    if (!hasGitChangesMention(text)) return undefined
    if (git?.() === false) return undefined

    const content = await request(sessionID)
    return buildGitChangesAttachment(text, content)
  }

  return { pending, resolveAttachment }
}
