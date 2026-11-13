// The v2 sidebar: the shared webview providers with the v2 data layer. The Settings and Profile panels have their
// own entry (`webview-ui/settings`), so this bundle carries only the chat transcript and its content. A subagent
// editor tab loads the same bundle with the `subagent` view.
import { Show } from "solid-js"
import { SpeechToTextStatusProvider } from "../components/speech-to-text/status"
import { NotificationsProvider } from "../context/notifications"
import { WorkStyleProvider } from "../context/work-style"
import { IndexingProvider } from "../context/indexing"
import { MemoryProvider } from "../context/memory"
import { KiloEmbeddingModelsProvider } from "../context/kilo-embedding-models"
import { Chat } from "./chat"
import { V2Provider } from "./client"
import { WebviewShell } from "./shell"
import { SubagentViewer } from "./subagent-viewer"
import "../styles/chat.css"

export default function App(props: { directory: string; view: string }) {
  return (
    <WebviewShell>
      <V2Provider directory={props.directory}>
        <KiloEmbeddingModelsProvider>
          <IndexingProvider>
            <MemoryProvider>
              <NotificationsProvider>
                <SpeechToTextStatusProvider>
                  <div class="container">
                    <WorkStyleProvider>
                      <Show when={props.view === "subagent"} fallback={<Chat />}>
                        <SubagentViewer />
                      </Show>
                    </WorkStyleProvider>
                  </div>
                </SpeechToTextStatusProvider>
              </NotificationsProvider>
            </MemoryProvider>
          </IndexingProvider>
        </KiloEmbeddingModelsProvider>
      </V2Provider>
    </WebviewShell>
  )
}
