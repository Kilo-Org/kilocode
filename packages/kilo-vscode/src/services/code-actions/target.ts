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

/** A chat editor tab: the shared code and terminal actions post to it like the sidebar. */
export type ChatPanelTarget = {
  post(message: ToWebview): void
  /** Reveals the tab and focuses its composer. */
  focus(): void
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

type Preferred =
  | { surface: "sidebar" }
  | { surface: "agentManager" }
  | { surface: "chatPanel"; panel: ChatPanelTarget }

export function createChatTarget(input: {
  view: ChatView
  agentManager: AgentPanel
  /** The chat editor tab the user worked in last, if one is open. */
  chatPanel?: () => ChatPanelTarget | undefined
}): ChatTarget {
  const showChat = () => commands.executeCommand("kilo-code.v2.chat.focus")
  // The sidebar and Agent Manager are remembered by `chatFocus`. A chat tab also needs the specific tab: selecting
  // code moves DOM focus to the editor, so the tab no longer reports itself as focused when the action runs.
  const preferred = (): Preferred => {
    if (lastFocused === "sidebar") return { surface: "sidebar" }
    if (lastFocused === "agentManager") return { surface: "agentManager" }
    const panel = lastFocused === "chatPanel" ? input.chatPanel?.() : undefined
    if (panel) return { surface: "chatPanel", panel }
    if (input.agentManager.isActive()) return { surface: "agentManager" }
    return { surface: "sidebar" }
  }

  const attach = async (items: PromptAttachment[]) => {
    const target = preferred()
    if (target.surface === "agentManager") {
      input.agentManager.focusPanel()
      if (!(await input.agentManager.waitForReady())) return
      input.agentManager.postMessage({ type: "appendContext", items })
      return
    }
    if (target.surface === "chatPanel") {
      target.panel.focus()
      target.panel.post({ type: "appendContext", items })
      return
    }
    await showChat()
    await input.view.post({ type: "appendContext", items })
  }

  const prompt = async (text: string, items?: PromptAttachment[], injectedTitle?: string) => {
    const message: ToWebview = { type: "startPrompt", text, items, injectedTitle }
    const target = preferred()
    if (target.surface === "agentManager") {
      input.agentManager.focusPanel()
      if (!(await input.agentManager.waitForReady())) return
      input.agentManager.postMessage(message)
      return
    }
    if (target.surface === "chatPanel") {
      target.panel.focus()
      target.panel.post(message)
      return
    }
    await showChat()
    await input.view.post(message)
  }

  const focus = async () => {
    const target = preferred()
    if (target.surface === "agentManager") {
      input.agentManager.focusPanel()
      input.agentManager.postMessage({ type: "action", action: "focusInput" })
      return
    }
    if (target.surface === "chatPanel") {
      target.panel.focus()
      return
    }
    await showChat()
    await input.view.post({ type: "command", name: "focusPrompt" })
  }

  const search = async () => {
    const target = preferred()
    if (target.surface === "agentManager") {
      input.agentManager.focusPanel()
      if (!(await input.agentManager.waitForReady())) return
      input.agentManager.postMessage({ type: "action", action: "focusSearch" })
      return
    }
    if (target.surface === "chatPanel") {
      target.panel.focus()
      target.panel.post({ type: "command", name: "focusSearch" })
      return
    }
    await showChat()
    await input.view.post({ type: "command", name: "focusSearch" })
  }

  return { attach, prompt, focus, search }
}
