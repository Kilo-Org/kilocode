// Agent Manager root component

import { Component, For, createMemo, onMount, onCleanup } from "solid-js"
import type { ExtensionMessage } from "../src/types/messages"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Toast } from "@kilocode/kilo-ui/toast"
import { Button } from "@kilocode/kilo-ui/button"
import { VSCodeProvider } from "../src/context/vscode"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { SessionProvider, useSession } from "../src/context/session"
import { ChatView } from "../src/components/chat"
import { LanguageBridge, DataBridge } from "../src/App"
import { formatRelativeDate } from "../src/utils/date"
import "./agent-manager.css"

const AgentManagerContent: Component = () => {
  const session = useSession()
  const sorted = createMemo(() =>
    [...session.sessions()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  )

  const navigate = (direction: "up" | "down") => {
    const list = sorted()
    if (list.length === 0) return
    const current = session.currentSessionID()
    const idx = current ? list.findIndex((s) => s.id === current) : -1
    const next = direction === "up" ? idx - 1 : idx + 1
    if (next < 0 || next >= list.length) return
    session.selectSession(list[next]!.id)
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage
      if (msg?.type !== "action") return
      if (msg.action === "sessionPrevious") navigate("up")
      else if (msg.action === "sessionNext") navigate("down")
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  return (
    <div class="am-layout">
      <div class="am-sidebar">
        <div class="am-sidebar-header">AGENT MANAGER</div>
        <Button variant="primary" size="large" onClick={() => session.clearCurrentSession()}>
          + New Agent
        </Button>
        <div class="am-sessions-header">SESSIONS</div>
        <div class="am-list">
          <For each={sorted()}>
            {(s) => (
              <button
                class={`am-item ${s.id === session.currentSessionID() ? "am-item-active" : ""}`}
                onClick={() => session.selectSession(s.id)}
              >
                <span class="am-item-title">{s.title || "Untitled"}</span>
                <span class="am-item-time">{formatRelativeDate(s.updatedAt)}</span>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="am-detail">
        <ChatView onSelectSession={(id) => session.selectSession(id)} />
      </div>
    </div>
  )
}

export const AgentManagerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>
                    <ProviderProvider>
                      <ConfigProvider>
                        <SessionProvider>
                          <DataBridge>
                            <AgentManagerContent />
                          </DataBridge>
                        </SessionProvider>
                      </ConfigProvider>
                    </ProviderProvider>
                  </CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
