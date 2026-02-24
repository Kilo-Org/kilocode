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
import Settings from "./components/Settings"
import ProfileView from "./components/ProfileView"
import { VSCodeProvider, useVSCode } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider, useProvider } from "./context/provider"
import { ConfigProvider } from "./context/config"
import { SessionProvider, useSession } from "./context/session"
import { LanguageProvider } from "./context/language"
import { ChatView } from "./components/chat"
import { KiloNotifications } from "./components/chat/KiloNotifications"
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

  const data = createMemo(() => {
    const id = session.currentSessionID()
    const perms = id ? session.permissions().filter((p) => p.sessionID === id) : []
    const qs = id ? session.questions() : []
    return {
      session: session.sessions().map((s) => ({ ...s, id: s.id, role: "user" as const })) as unknown as any[],
      session_status: {} as Record<string, any>,
      session_diff: {} as Record<string, any[]>,
      message: id ? { [id]: session.messages() as unknown as SDKMessage[] } : {},
      part: id
        ? Object.fromEntries(
            session
              .messages()
              .map((msg) => [msg.id, session.getParts(msg.id) as unknown as SDKPart[]])
              .filter(([, parts]) => (parts as SDKPart[]).length > 0),
          )
        : {},
      permission: id ? { [id]: perms as unknown as any[] } : {},
      question: id ? { [id]: qs as unknown as any[] } : {},
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

  return (
    <DataProvider
      data={data()}
      directory=""
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
