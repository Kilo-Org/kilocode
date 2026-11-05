import { commands } from "vscode"
import type { PromptAttachment, ToWebview } from "../../protocol"

type ChatView = {
  post(message: ToWebview): Promise<boolean> | unknown
}

type AgentPanel = {
  isActive(): boolean
  focusPanel(): void
  waitForReady(): Promise<boolean>
  postMessage(message: unknown): void
}

export type ChatTarget = {
  attach(items: PromptAttachment[]): Promise<void>
  prompt(text: string, items?: PromptAttachment[]): Promise<void>
  focus(): Promise<void>
}

type Surface = "sidebar" | "agentManager"

// The chat the user focused last. Selecting code moves focus to the editor, so context added from there goes back to
// that chat instead of whichever panel is active now. A surface is forgotten only when it closes.
let lastFocused: Surface | undefined

export const chatFocus = {
  gained(surface: Surface) {
    lastFocused = surface
  },
  closed(surface: Surface) {
    if (lastFocused === surface) lastFocused = undefined
  },
}

export function createChatTarget(input: { view: ChatView; agentManager: AgentPanel }): ChatTarget {
  const showChat = () => commands.executeCommand("kilo-code.v2.chat.focus")
  const preferAgentManager = () => {
    if (lastFocused === "agentManager") return true
    if (lastFocused === "sidebar") return false
    return input.agentManager.isActive()
  }

  const attach = async (items: PromptAttachment[]) => {
    if (preferAgentManager()) {
      input.agentManager.focusPanel()
      if (!(await input.agentManager.waitForReady())) return
      input.agentManager.postMessage({ type: "appendContext", items })
      return
    }
    await showChat()
    await input.view.post({ type: "appendContext", items })
  }

  const prompt = async (text: string, items?: PromptAttachment[]) => {
    const message: ToWebview = items ? { type: "startPrompt", text, items } : { type: "startPrompt", text }
    if (preferAgentManager()) {
      input.agentManager.focusPanel()
      if (!(await input.agentManager.waitForReady())) return
      input.agentManager.postMessage(message)
      return
    }
    await showChat()
    await input.view.post(message)
  }

  const focus = async () => {
    if (preferAgentManager()) {
      input.agentManager.focusPanel()
      input.agentManager.postMessage({ type: "action", action: "focusInput" })
      return
    }
    await showChat()
    await input.view.post({ type: "command", name: "focusPrompt" })
  }

  return { attach, prompt, focus }
}
