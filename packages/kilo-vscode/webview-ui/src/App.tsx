import { Component, createSignal, onMount, onCleanup, Switch, Match } from "solid-js";
import Settings, { type ConnectionState } from "./components/Settings";
import { TransportProvider } from "./transport/TransportProvider";
import { ChatView } from "./views/ChatView";

// Import OpenCode UI Tailwind styles
import "@opencode-ai/ui/styles/tailwind";
// Keep the chat-view.css for any fallback/override styles
import "./views/chat-view.css";

type ViewType = 
  | "chat"
  | "newTask"
  | "marketplace"
  | "history"
  | "profile"
  | "settings";

interface ActionMessage {
  type: "action";
  action: string;
}

interface ReadyMessage {
  type: "ready";
  serverInfo?: {
    port: number;
  };
}

interface ConnectionStateMessage {
  type: "connectionState";
  state: ConnectionState;
}

type WebviewMessage = ActionMessage | ReadyMessage | ConnectionStateMessage;

const DummyView: Component<{ title: string }> = (props) => {
  return (
    <div style={{
      display: "flex",
      "justify-content": "center",
      "align-items": "center",
      height: "100%",
      "min-height": "200px",
      "font-size": "24px",
      color: "var(--vscode-foreground)"
    }}>
      <h1>{props.title}</h1>
    </div>
  );
};

const App: Component = () => {
  // Default to chat view now
  const [currentView, setCurrentView] = createSignal<ViewType>("chat");
  const [serverPort, setServerPort] = createSignal<number | null>(null);
  const [connectionState, setConnectionState] = createSignal<ConnectionState>("disconnected");

  const handleMessage = (event: MessageEvent) => {
    // Debug: log *all* messages received from the extension host.
    console.log("[Kilo New] App: 📨 window.message received:", {
      data: event.data,
      origin: (event as MessageEvent).origin,
    });

    const message = event.data as WebviewMessage;
    console.log("[Kilo New] App: 🔎 Parsed message.type:", (message as WebviewMessage)?.type);
    
    switch (message.type) {
      case "action":
        console.log("[Kilo New] App: 🎬 action:", message.action);
        switch (message.action) {
          case "plusButtonClicked":
            setCurrentView("chat"); // Changed from newTask to chat
            break;
          case "marketplaceButtonClicked":
            setCurrentView("marketplace");
            break;
          case "historyButtonClicked":
            setCurrentView("history");
            break;
          case "profileButtonClicked":
            setCurrentView("profile");
            break;
          case "settingsButtonClicked":
            setCurrentView("settings");
            break;
        }
        break;
      case "ready":
        console.log("[Kilo New] App: ✅ ready:", message.serverInfo);
        if (message.serverInfo?.port) {
          setServerPort(message.serverInfo.port);
        }
        break;
      case "connectionState":
        console.log("[Kilo New] App: 🔄 connectionState:", message.state);
        setConnectionState(message.state);
        break;
      default:
        // If the extension sends a new message type, we want to see it immediately.
        // Note: Chat protocol messages are handled by TransportProvider, not here
        break;
    }
  };

  onMount(() => {
    console.log("[Kilo New] App: 🧩 Mount: adding window.message listener");
    window.addEventListener("message", handleMessage);
  });

  onCleanup(() => {
    console.log("[Kilo New] App: 🧹 Cleanup: removing window.message listener");
    window.removeEventListener("message", handleMessage);
  });

  return (
    <div class="container" style={{ height: "100vh", overflow: "hidden" }}>
      <Switch fallback={<DummyView title="Unknown View" />}>
        <Match when={currentView() === "chat"}>
          <TransportProvider autoInit={true}>
            <ChatView />
          </TransportProvider>
        </Match>
        <Match when={currentView() === "newTask"}>
          <TransportProvider autoInit={true}>
            <ChatView />
          </TransportProvider>
        </Match>
        <Match when={currentView() === "marketplace"}>
          <DummyView title="Marketplace" />
        </Match>
        <Match when={currentView() === "history"}>
          <DummyView title="History" />
        </Match>
        <Match when={currentView() === "profile"}>
          <DummyView title="Profile" />
        </Match>
        <Match when={currentView() === "settings"}>
          <Settings port={serverPort()} connectionState={connectionState()} />
        </Match>
      </Switch>
    </div>
  );
};

export default App;
