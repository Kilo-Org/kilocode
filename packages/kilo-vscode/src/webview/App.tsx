import { ServerProvider } from "./context/server"
import { SessionProvider } from "./context/session"
import { ProviderProvider } from "./context/provider"
import { StatusIndicator } from "./components/StatusIndicator"
import { MessageList } from "./components/MessageList"
import { PromptInput } from "./components/PromptInput"

export default function App() {
  return (
    <ServerProvider>
      <ProviderProvider>
        <SessionProvider>
          <div class="app">
            <header class="app-header">
              <StatusIndicator />
            </header>
            <main class="app-main">
              <MessageList />
            </main>
            <footer class="app-footer">
              <PromptInput />
            </footer>
          </div>
        </SessionProvider>
      </ProviderProvider>
    </ServerProvider>
  )
}
