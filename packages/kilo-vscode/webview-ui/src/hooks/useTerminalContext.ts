import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { FileAttachment } from "../types/messages"
import { useVSCode } from "../context/vscode"
import { buildTerminalAttachment, hasTerminalMention } from "./terminal-context-utils"

const TERMINAL_CONTEXT_TIMEOUT_MS = 10_000

type Pending = {
  resolve: (content: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type EmbeddedResolver = (context?: string) => Promise<string | undefined>

export interface TerminalContext {
  pending: Accessor<boolean>
  resolveAttachment: (text: string, sessionID?: string, context?: string) => Promise<FileAttachment | undefined>
}

export function useTerminalContext(embedded?: EmbeddedResolver): TerminalContext {
  const vscode = useVSCode()
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

  const request = (sessionID?: string, context?: string) =>
    new Promise<string>((resolve, reject) => {
      counter++
      const requestId = `terminal-context-${counter}`
      const timer = setTimeout(() => {
        settle(requestId, (req) => req.reject(new Error("Timed out while reading terminal output")))
      }, TERMINAL_CONTEXT_TIMEOUT_MS)

      requests.set(requestId, { resolve, reject, timer })
      setPending(true)
      if (!embedded) {
        vscode.postMessage({ type: "requestTerminalContext", requestId, sessionID, agentManagerContext: context })
        return
      }
      void embedded(context).then(
        (content) => {
          if (content === undefined) {
            vscode.postMessage({ type: "requestTerminalContext", requestId, sessionID, agentManagerContext: context })
            return
          }
          settle(requestId, (req) => req.resolve(content))
        },
        (error: unknown) => {
          settle(requestId, (req) => req.reject(error instanceof Error ? error : new Error(String(error))))
        },
      )
    })

  const resolveAttachment = async (text: string, sessionID?: string, context?: string) => {
    if (!hasTerminalMention(text)) return undefined

    const content = await request(sessionID, context)
    if (!content.trim()) throw new Error("No terminal content available")
    return buildTerminalAttachment(text, content)
  }

  return { pending, resolveAttachment }
}
