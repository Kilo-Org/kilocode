import { Component, createSignal, Switch, Match, onMount, onCleanup } from "solid-js"
import Settings from "./components/Settings"
import ProfileView from "./components/ProfileView"
import { VSCodeProvider } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider } from "./context/provider"
import { SessionProvider, useSession } from "./context/session"
import { ChatView } from "./components/chat"
import SessionList from "./components/history/SessionList"
import "./styles/chat.css"

type ViewType = "newTask" | "marketplace" | "history" | "profile" | "settings"

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

// Inner app component that uses the contexts
const AppContent: Component = () => {
  const [currentView, setCurrentView] = createSignal<ViewType>("newTask")
  const session = useSession()
  const server = useServer()

  // Handle action messages from extension for view switching
  // This is handled at the VSCode context level, but we need to expose it here
  // for the action messages that switch views
  const handleViewAction = (action: string) => {
    switch (action) {
      case "plusButtonClicked":
        if (session.messages().length > 0 || !session.currentSessionID()) {
          session.createSession()
        }
        setCurrentView("newTask")
        break
      case "marketplaceButtonClicked":
        setCurrentView("marketplace")
        break
      case "historyButtonClicked":
        setCurrentView("history")
        break
      case "profileButtonClicked":
        setCurrentView("profile")
        break
      case "settingsButtonClicked":
        setCurrentView("settings")
        break
    }
  }

  // Listen for action messages at the window level
  // (These are separate from the typed messages handled by contexts)
  onMount(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message?.type === "action" && message.action) {
        console.log("[Kilo New] App: 🎬 action:", message.action)
        handleViewAction(message.action)
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
          <ChatView />
        </Match>
        <Match when={currentView() === "marketplace"}>
          <DummyView title="Marketplace" />
        </Match>
        <Match when={currentView() === "history"}>
          <SessionList onSelectSession={handleSelectSession} />
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
    <VSCodeProvider>
      <ServerProvider>
        <ProviderProvider>
          <SessionProvider>
            <AppContent />
          </SessionProvider>
        </ProviderProvider>
      </ServerProvider>
    </VSCodeProvider>
  )
}

export default App
