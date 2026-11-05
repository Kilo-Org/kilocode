// The v2 sidebar, the Settings panel and the Profile panel: the shared webview providers with the v2 data layer.
import { Match, Switch } from "solid-js"
import { SpeechToTextStatusProvider } from "../components/speech-to-text/status"
import ProfileView from "../components/profile/ProfileView"
import { Chat } from "./chat"
import { V2Provider } from "./client"
import { createProfile } from "./profile"
import { SettingsView } from "./settings"
import { WebviewShell } from "./shell"
import "../styles/chat.css"

export default function App(props: { directory: string; view: string }) {
  return (
    <WebviewShell>
      <V2Provider directory={props.directory}>
        <SpeechToTextStatusProvider>
          <div class="container">
            <Switch fallback={<Chat />}>
              <Match when={props.view === "settings"}>
                <SettingsView />
              </Match>
              <Match when={props.view === "profile"}>
                <ProfilePanel />
              </Match>
            </Switch>
          </div>
        </SpeechToTextStatusProvider>
      </V2Provider>
    </WebviewShell>
  )
}

function ProfilePanel() {
  const profile = createProfile()
  return <ProfileView profile={profile} />
}
