import { Component, createSignal, createMemo, Switch, Match, Show, onMount, onCleanup } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { Toast } from "@kilocode/kilo-ui/toast"
import Settings from "./components/settings/Settings"
import ProfileView from "./components/profile/ProfileView"
import { VSCodeProvider, useVSCode } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider, useProvider } from "./context/provider"
import { ConfigProvider } from "./context/config"
import { SessionProvider, useSession } from "./context/session"
import { LanguageProvider } from "./context/language"
import { ChatView } from "./components/chat"
import { KiloNotifications } from "./components/chat/KiloNotifications"
import { registerExpandedTaskTool } from "./components/chat/TaskToolExpanded"
import { registerVscodeToolOverrides } from "./components/chat/VscodeToolOverrides"

// Override the upstream "task" tool renderer with the fully-expanded version
// that shows child session parts inline in the VS Code sidebar.
registerExpandedTaskTool()
// Apply VS Code sidebar preferences to other tools (e.g. bash expanded by default).
registerVscodeToolOverrides()
import SessionList from "./components/history/SessionList"
import CloudSessionList from "./components/history/CloudSessionList"
import { NotificationsProvider } from "./context/notifications"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import "./styles/chat.css"

type ViewType = "newTask" | "marketplace" | "history" | "cloudHistory" | "profile" | "settings"
const VALID_VIEWS = new Set<string>(["newTask", "marketplace", "history", "cloudHistory", "profile", "settings"])

const DummyView: Component<{ title: string }> = (props) => {
  return (
    <div
      style={{
        display: "flex",
        "justify-content": "center",
        "align-items": "center",
        height: "100%",
        "min-height": "200px",
        "font-size": "24px",
        color: "var(--vscode-foreground)",
      }}
    >
      <h1>{props.title}</h1>
    </div>
  )
}

/**
 * Bridge our session store to the DataProvider's expected Data shape.
 */
export const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const prov = useProvider()
  const server = useServer()

  const data = createMemo(() => {
    const id = session.currentSessionID()
    const allParts = session.allParts()
    // Expose ALL session messages (including child sessions from sub-agents),
    // not just the current session. This lets VscodeSessionTurn and
    // TaskToolExpanded read child session data from the DataProvider store.
    const allMessages = Object.fromEntries(
      Object.entries(session.allMessages() as Record<string, SDKMessage[]>)
        .filter(([, msgs]) => (msgs as SDKMessage[]).length > 0)
        .map(([sid, msgs]) => [sid, msgs as SDKMessage[]]),
    )
    return {
      session: session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })) as unknown as any[],
      session_status: session.allStatusMap() as unknown as Record<string, any>,
      session_diff: {} as Record<string, any[]>,
      message: allMessages,
      part: Object.fromEntries(
        Object.entries(allParts)
          .filter(([, parts]) => (parts as SDKPart[]).length > 0)
          .map(([msgId, parts]) => [msgId, parts as unknown as SDKPart[]]),
      ),
      permission: (() => {
        const grouped: Record<string, any[]> = {}
        for (const p of session.permissions()) {
          const sid = p.sessionID
          if (!sid) continue
          ;(grouped[sid] ??= []).push(p)
        }
        return grouped
      })(),
      // Questions are handled directly by QuestionDock via session.questions(),
      // not through DataProvider. The DataProvider's question field is unused here.
      question: {},
      provider: {
        all: Object.values(prov.providers()) as unknown as any[],
        connected: prov.connected(),
        default: prov.defaults(),
      } as unknown as any,
    }
  })

  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
    session.respondToPermission(input.permissionID, input.response)
  }

  const reply = (input: { requestID: string; answers: string[][] }) => {
    session.replyToQuestion(input.requestID, input.answers)
  }

  const reject = (input: { requestID: string }) => {
    session.rejectQuestion(input.requestID)
  }

  const open = (filePath: string, line?: number, column?: number) => {
    vscode.postMessage({ type: "openFile", filePath, line, column })
  }

  const directory = () => {
    const dir = server.workspaceDirectory()
    if (!dir) return ""
    return dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + "/"
  }

  return (
    <DataProvider
      data={data()}
      directory={directory()}
      onPermissionRespond={respond}
      onQuestionReply={reply}
      onQuestionReject={reject}
      onOpenFile={open}
    >
      {props.children}
    </DataProvider>
  )
}

/**
 * Wraps children in LanguageProvider, passing server-side language info.
 * Must be below ServerProvider in the hierarchy.
 */
export const LanguageBridge: Component<{ children: any }> = (props) => {
  const server = useServer()
  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      {props.children}
    </LanguageProvider>
  )
}

// Inner app component that uses the contexts
const AppContent: Component = () => {
  const [currentView, setCurrentView] = createSignal<ViewType>("newTask")
  const session = useSession()
  const server = useServer()

  const handleViewAction = (action: string) => {
    switch (action) {
      case "plusButtonClicked":
        session.clearCurrentSession()
        setCurrentView("newTask")
        break
      case "marketplaceButtonClicked":
        setCurrentView("marketplace")
        break
      case "historyButtonClicked":
        setCurrentView("history")
        break
      case "cloudHistoryButtonClicked":
        setCurrentView("cloudHistory")
        break
      case "profileButtonClicked":
        setCurrentView("profile")
        break
      case "settingsButtonClicked":
        setCurrentView("settings")
        break
    }
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message?.type === "action" && message.action) {
        console.log("[Kilo New] App: 🎬 action:", message.action)
        handleViewAction(message.action)
      }
      if (message?.type === "navigate" && message.view && VALID_VIEWS.has(message.view)) {
        console.log("[Kilo New] App: 🧭 navigate:", message.view)
        setCurrentView(message.view as ViewType)
      }
      if (message?.type === "openCloudSession" && message.sessionId) {
        console.log("[Kilo New] App: ☁️ openCloudSession:", message.sessionId)
        session.selectCloudSession(message.sessionId)
        setCurrentView("newTask")
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleSelectSession = (id: string) => {
    session.selectSession(id)
    setCurrentView("newTask")
  }

  return (
    <div class="container">
      <Switch fallback={<ChatView />}>
        <Match when={currentView() === "newTask"}>
          <Show when={!session.currentSessionID()}>
            <KiloNotifications />
          </Show>
          <ChatView onSelectSession={handleSelectSession} />
        </Match>
        <Match when={currentView() === "marketplace"}>
          <DummyView title="Marketplace" />
        </Match>
        <Match when={currentView() === "history"}>
          <SessionList onSelectSession={handleSelectSession} />
        </Match>
        <Match when={currentView() === "cloudHistory"}>
          <CloudSessionList
            onSelectSession={(cloudSessionId) => {
              session.selectCloudSession(cloudSessionId)
              setCurrentView("newTask")
            }}
          />
        </Match>
        <Match when={currentView() === "profile"}>
          <ProfileView
            profileData={server.profileData()}
            deviceAuth={server.deviceAuth()}
            onLogin={server.startLogin}
            onBack={() => setCurrentView("newTask")}
          />
        </Match>
        <Match when={currentView() === "settings"}>
          <Settings onBack={() => setCurrentView("newTask")} />
        </Match>
      </Switch>
    </div>
  )
}

// Main App component with context providers
const App: Component = () => {
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
                        <NotificationsProvider>
                          <SessionProvider>
                            <DataBridge>
                              <AppContent />
                            </DataBridge>
                          </SessionProvider>
                        </NotificationsProvider>
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

export default App
