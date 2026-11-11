import { onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import { useVSCode } from "../context/vscode"
import type { MentionFile } from "./context-mention-utils"
import { buildTerminalAttachment, hasTerminalMention } from "./terminal-context-utils"
import { createContextRequests } from "./context-requests"

type EmbeddedResolver = (context?: string) => Promise<string | undefined>

export interface TerminalContext {
  pending: Accessor<boolean>
  resolveAttachment: (text: string, sessionID?: string, context?: string) => Promise<MentionFile | undefined>
}

/**
 * Reads the terminal an `@terminal` mention attaches. The Agent Manager passes `embedded`, which reads its own
 * terminal tabs; anything else asks the host, which copies the active VS Code terminal.
 */
export function useTerminalContext(embedded?: EmbeddedResolver): TerminalContext {
  const vscode = useVSCode()
  const requests = createContextRequests("terminal-context", 10_000, "Timed out while reading terminal output")

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "terminalContextResult") {
      requests.settle(message.requestId, (req) => req.resolve(message.content))
      return
    }

    if (message.type === "terminalContextError") {
      requests.settle(message.requestId, (req) => req.reject(new Error(message.error)))
    }
  })

  onCleanup(() => {
    unsubscribe()
    requests.dispose("Terminal context request cancelled")
  })

  const resolveAttachment = async (text: string, sessionID?: string, context?: string) => {
    if (!hasTerminalMention(text)) return undefined

    const content = await requests.request((requestId) => {
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
          requests.settle(requestId, (req) => req.resolve(content))
        },
        (error: unknown) => {
          requests.settle(requestId, (req) => req.reject(error instanceof Error ? error : new Error(String(error))))
        },
      )
    })
    if (!content.trim()) throw new Error("No terminal content available")
    return buildTerminalAttachment(text, content)
  }

  return { pending: requests.pending, resolveAttachment }
}
