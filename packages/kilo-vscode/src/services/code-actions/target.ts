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
  /** Sends a prompt Kilo composed. `injectedTitle` labels it in the transcript. */
  prompt(text: string, items?: PromptAttachment[], injectedTitle?: string): Promise<void>
  focus(): Promise<void>
  /** Toggles the transcript search of the chat the user focused last. */
  search(): Promise<void>
}

type Surface = "sidebar" | "agentManager" | "chatPanel"

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
  /** The chat surface that last had DOM focus, for host paths that act on it such as browser references. */
  surface: () => lastFocused,
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

  const prompt = async (text: string, items?: PromptAttachment[], injectedTitle?: string) => {
    const message: ToWebview = { type: "startPrompt", text, items, injectedTitle }
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

  const search = async () => {
    if (preferAgentManager()) {
      input.agentManager.focusPanel()
      if (!(await input.agentManager.waitForReady())) return
      input.agentManager.postMessage({ type: "action", action: "focusSearch" })
      return
    }
    await showChat()
    await input.view.post({ type: "command", name: "focusSearch" })
  }

  return { attach, prompt, focus, search }
}
