// Agent Manager root component
// Reuses the sidebar's provider chain and ChatView, adding a session list sidebar

import { Component, createSignal, createMemo, Show, For } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Toast } from "@kilocode/kilo-ui/toast"
import { VSCodeProvider } from "../src/context/vscode"
import { ServerProvider, useServer } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { SessionProvider, useSession } from "../src/context/session"
import { LanguageProvider } from "../src/context/language"
import { ChatView } from "../src/components/chat"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import "./agent-manager.css"

// Bridges server language info to LanguageProvider
const LanguageBridge: Component<{ children: any }> = (props) => {
  const server = useServer()
  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      {props.children}
    </LanguageProvider>
  )
}

// Bridge session store to DataProvider (same as sidebar's DataBridge)
const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()
  const data = createMemo(() => ({
    session: session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })),
    session_status: {} as Record<string, any>,
    session_diff: {} as Record<string, any[]>,
    message: {
      [session.currentSessionID() ?? ""]: session.messages() as unknown as SDKMessage[],
    },
    part: Object.fromEntries(
      session
        .messages()
        .map((msg) => [msg.id, session.getParts(msg.id) as unknown as SDKPart[]])
        .filter(([, parts]) => (parts as SDKPart[]).length > 0),
    ),
    permission: {
      [session.currentSessionID() ?? ""]: session.permissions() as unknown as any[],
    },
  }))

  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
    session.respondToPermission(input.permissionID, input.response)
  }

  return (
    <DataProvider data={data()} directory="" onPermissionRespond={respond}>
      {props.children}
    </DataProvider>
  )
}

// View state: "new" shows the new-agent form, "session" shows the chat
type View = "new" | "session"

const AgentManagerContent: Component = () => {
  const session = useSession()
  const [view, setView] = createSignal<View>("new")
  const [prompt, setPrompt] = createSignal("")

  const handleNewAgent = () => {
    setView("new")
    setPrompt("")
  }

  const handleStart = () => {
    const text = prompt().trim()
    if (!text) return
    // Clear current session so KiloProvider creates a fresh one
    session.clearCurrentSession()
    // Send message — KiloProvider auto-creates a new session when currentSession is null
    session.sendMessage(text)
    setPrompt("")
    setView("session")
  }

  const handleSelectSession = (id: string) => {
    session.selectSession(id)
    setView("session")
  }

  return (
    <div class="am-layout">
      <div class="am-sidebar">
        <div class="am-sidebar-header">AGENT MANAGER</div>
        <button class="am-new-btn" onClick={handleNewAgent}>
          <span class="am-new-icon">+</span> New Agent
        </button>
        <div class="am-sessions-header">
          <span>SESSIONS</span>
        </div>
        <div class="am-list">
          <For each={session.sessions()}>
            {(s) => (
              <div
                class={`am-item ${s.id === session.currentSessionID() && view() === "session" ? "am-selected" : ""}`}
                onClick={() => handleSelectSession(s.id)}
              >
                <span class="am-item-title">{s.title || "Untitled"}</span>
                <span class="am-item-time">{formatTime(s.createdAt)}</span>
              </div>
            )}
          </For>
        </div>
      </div>
      <div class="am-detail">
        <Show when={view() === "session" && session.currentSessionID()}>
          <ChatView onSelectSession={handleSelectSession} />
        </Show>
        <Show when={view() === "new" || !session.currentSessionID()}>
          <div class="am-new-form">
            <textarea
              class="am-new-textarea"
              placeholder="Type your task here..."
              value={prompt()}
              onInput={(e) => setPrompt(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleStart()
              }}
              autofocus
            />
            <div class="am-new-actions">
              <button class="am-start-btn" onClick={handleStart} disabled={!prompt().trim()}>
                Start
              </button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
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
