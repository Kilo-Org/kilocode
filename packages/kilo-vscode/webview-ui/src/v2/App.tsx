// The v2 sidebar and the Settings panel: the shared webview providers with the v2 data layer.
import { Show } from "solid-js"
import { SpeechToTextStatusProvider } from "../components/speech-to-text/status"
import { NotificationsProvider } from "../context/notifications"
import { Chat } from "./chat"
import { V2Provider } from "./client"
import { SettingsView } from "./settings"
import { WebviewShell } from "./shell"
import "../styles/chat.css"

export default function App(props: { directory: string; view: string }) {
  return (
    <WebviewShell>
      <V2Provider directory={props.directory}>
        <NotificationsProvider>
          <SpeechToTextStatusProvider>
            <div class="container">
              <Show when={props.view === "settings"} fallback={<Chat />}>
                <SettingsView />
              </Show>
            </div>
          </SpeechToTextStatusProvider>
        </NotificationsProvider>
      </V2Provider>
    </WebviewShell>
  )
}
