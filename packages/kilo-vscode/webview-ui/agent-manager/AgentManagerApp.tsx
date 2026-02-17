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
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { SessionProvider, useSession } from "../src/context/session"
import { LanguageProvider } from "../src/context/language"
import { useServer } from "../src/context/server"
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

// The inner content that uses SessionProvider context
const AgentManagerContent: Component = () => {
  const session = useSession()
  const [prompt, setPrompt] = createSignal("")

  const handleCreate = () => {
    const text = prompt().trim()
    if (!text) return
    session.sendMessage(text)
    setPrompt("")
  }

  return (
    <div class="am-layout">
      <div class="am-sessions">
        <div class="am-header">Agent Sessions</div>
        <div class="am-list">
          <For each={session.sessions()}>
            {(s) => (
              <div
                class={`am-item ${s.id === session.currentSessionID() ? "am-selected" : ""}`}
                onClick={() => session.selectSession(s.id)}
              >
                <span
                  class={`am-dot ${session.status() === "busy" && s.id === session.currentSessionID() ? "busy" : "idle"}`}
                />
                <span class="am-label">{s.title || "Untitled"}</span>
              </div>
            )}
          </For>
          <Show when={session.sessions().length === 0}>
            <div class="am-empty">No sessions yet</div>
          </Show>
        </div>
        <div class="am-form">
          <textarea
            placeholder="Describe the task..."
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate()
            }}
          />
          <button onClick={handleCreate}>Start Agent</button>
        </div>
      </div>
      <div class="am-detail">
        <Show
          when={session.currentSessionID()}
          fallback={<div class="am-empty-detail">Select or create a session</div>}
        >
          <ChatView />
        </Show>
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
