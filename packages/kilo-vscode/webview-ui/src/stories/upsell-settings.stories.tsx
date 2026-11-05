import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import ExperimentalTab from "../components/settings/ExperimentalTab"
import { ImageModelsProvider } from "../context/image-models"
import { SessionContext } from "../context/session"
import { getVSCodeAPI } from "../context/vscode"
import { WorktreeModeProvider } from "../context/worktree-mode"
import { SidebarUpsell } from "../../../src/kilo-provider/upsell"
import { apply, type UpsellState } from "../../../src/shared/agent-manager-upsell"
import type { SessionContextValue } from "../context/session-types"

const meta: Meta = { title: "Upsell Settings", parameters: { layout: "fullscreen" } }
export default meta
type Story = StoryObj

function Preview(props: { surface?: "editor" | "manager" }) {
  const previous = document.documentElement.dataset.sidebar
  if (props.surface === "editor") delete document.documentElement.dataset.sidebar
  else document.documentElement.dataset.sidebar = "left"
  const [busy, setBusy] = createSignal(true)
  const [mounted, setMounted] = createSignal(true)
  const values = new Map<string, unknown>()
  const host = new SidebarUpsell(
    {
      read: async () => JSON.parse(localStorage.getItem("upsell.policy") ?? "{}") as UpsellState,
      update: async (action, now) => {
        const next = apply(JSON.parse(localStorage.getItem("upsell.policy") ?? "{}") as UpsellState, action, now)
        localStorage.setItem("upsell.policy", JSON.stringify(next))
        return next
      },
    },
    {
      get: <T,>(key: string, fallback: T) => (values.get(key) as T | undefined) ?? fallback,
      update: async (key, value) => void values.set(key, value),
    },
  )
  void host.started("one")
  void host.started("two")
  const api = getVSCodeAPI()
  const post = api.postMessage
  const settings = () =>
    window.postMessage(
      {
        type: "chatSettingsLoaded",
        settings: { agentManagerUpsell: localStorage.getItem("upsell.enabled") === "true" },
      },
      window.location.origin,
    )
  api.postMessage = (message) => {
    post(message)
    if (message.type === "requestChatSettings") settings()
    if (message.type === "updateSetting" && message.key === "experimental.agentManagerUpsell") {
      localStorage.setItem("upsell.enabled", String(message.value))
      settings()
    }
    if (message.type !== "agentManagerUpsell") return
    void host
      .handle(message.action, !props.surface)
      .then((result) =>
        window.postMessage(
          { type: "agentManagerUpsellLoaded", request: message.request, ...result },
          window.location.origin,
        ),
      )
  }
  onMount(() => window.postMessage({ type: "webviewActiveChanged", active: true }, window.location.origin))
  onCleanup(() => {
    api.postMessage = post
    if (previous == null) delete document.documentElement.dataset.sidebar
    else document.documentElement.dataset.sidebar = previous
  })
  const user = () => ({
    id: "turn",
    sessionID: "upsell-settings",
    role: "user" as const,
    content: "Update the sidebar",
    createdAt: "2026-11-05T00:00:00Z",
    summary: { diffs: busy() ? [] : [{ file: "sidebar.tsx" }] },
  })
  const session = {
    ...mockSessionValue({ id: "upsell-settings" }),
    status: () => (busy() ? "busy" : "idle"),
    closeReason: () => (busy() ? undefined : "completed"),
    userMessages: () => [user()],
    messages: () => [user()],
  } as unknown as SessionContextValue
  const chat = () => (
    <SessionContext.Provider value={session}>
      <div style={{ height: "800px", display: "flex", "flex-direction": "column" }}>
        <Show when={mounted()}>
          <ChatView />
        </Show>
      </div>
    </SessionContext.Provider>
  )
  return (
    <StoryProviders noPadding>
      <div style={{ "max-height": "240px", overflow: "auto" }}>
        <ImageModelsProvider>
          <ExperimentalTab />
        </ImageModelsProvider>
      </div>
      <button onClick={() => setBusy(!busy())}>Toggle turn</button>
      <button onClick={() => setMounted(!mounted())}>Toggle chat mount</button>
      <Show when={props.surface === "manager"} fallback={chat()}>
        <WorktreeModeProvider>{chat()}</WorktreeModeProvider>
      </Show>
    </StoryProviders>
  )
}

export const Sidebar: Story = { render: () => <Preview /> }
export const Editor: Story = { render: () => <Preview surface="editor" /> }
export const Manager: Story = { render: () => <Preview surface="manager" /> }
