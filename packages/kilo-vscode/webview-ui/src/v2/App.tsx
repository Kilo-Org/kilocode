// The v2 sidebar: the shared webview providers with the v2 data layer. The Settings and Profile panels have their
// own entry (`webview-ui/settings`), so this bundle carries only the chat transcript and its content.
import { SpeechToTextStatusProvider } from "../components/speech-to-text/status"
import { NotificationsProvider } from "../context/notifications"
import { IndexingProvider } from "../context/indexing"
import { KiloEmbeddingModelsProvider } from "../context/kilo-embedding-models"
import { Chat } from "./chat"
import { V2Provider } from "./client"
import { WebviewShell } from "./shell"
import "../styles/chat.css"

export default function App(props: { directory: string; view: string }) {
  return (
    <WebviewShell>
      <V2Provider directory={props.directory}>
        <KiloEmbeddingModelsProvider>
          <IndexingProvider>
            <NotificationsProvider>
              <SpeechToTextStatusProvider>
                <div class="container">
                  <Chat />
                </div>
              </SpeechToTextStatusProvider>
            </NotificationsProvider>
          </IndexingProvider>
        </KiloEmbeddingModelsProvider>
      </V2Provider>
    </WebviewShell>
  )
}
