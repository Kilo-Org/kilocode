import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, FileAttachment, WebviewMessage } from "../types/messages"
import { buildTerminalAttachment, hasTerminalMention } from "./terminal-context-utils"

const TERMINAL_CONTEXT_TIMEOUT_MS = 10_000

type Pending = {
  resolve: (content: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface TerminalContext {
  pending: Accessor<boolean>
  resolveAttachment: (text: string, sessionID?: string) => Promise<FileAttachment | undefined>
}

export function useTerminalContext(vscode: VSCodeContext): TerminalContext {
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
    if (message.type === "terminalContextResult") {
      settle(message.requestId, (req) => req.resolve(message.content))
      return
    }

    if (message.type === "terminalContextError") {
      settle(message.requestId, (req) => req.reject(new Error(message.error)))
    }
  })

  onCleanup(() => {
    unsubscribe()
    for (const req of requests.values()) {
      clearTimeout(req.timer)
      req.reject(new Error("Terminal context request cancelled"))
    }
    requests.clear()
  })

  const request = (sessionID?: string) =>
    new Promise<string>((resolve, reject) => {
      counter++
      const requestId = `terminal-context-${counter}`
      const timer = setTimeout(() => {
        settle(requestId, (req) => req.reject(new Error("Timed out while reading terminal output")))
      }, TERMINAL_CONTEXT_TIMEOUT_MS)

      requests.set(requestId, { resolve, reject, timer })
      setPending(true)
      vscode.postMessage({ type: "requestTerminalContext", requestId, sessionID })
    })

  const resolveAttachment = async (text: string, sessionID?: string) => {
    if (!hasTerminalMention(text)) return undefined

    const content = await request(sessionID)
    if (!content.trim()) throw new Error("No terminal content available")
    return buildTerminalAttachment(text, content)
  }

  return { pending, resolveAttachment }
}
