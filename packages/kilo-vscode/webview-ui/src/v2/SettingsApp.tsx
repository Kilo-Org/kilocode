// The Settings and Profile editor panels: the shared webview providers and the v2 data layer, without the chat
// transcript, its rich content, its notifications or its session list.
import { Match, Switch } from "solid-js"
import ProfileView from "../components/profile/ProfileView"
import { V2Provider } from "./client"
import { createProfile } from "./profile"
import { SettingsView } from "./settings"
import { ShellBase } from "./shell-base"

export default function SettingsApp(props: { directory: string; view: string }) {
  return (
    <ShellBase>
      <V2Provider directory={props.directory} chat={false}>
        <div class="container">
          <Switch fallback={<SettingsView />}>
            <Match when={props.view === "profile"}>
              <ProfilePanel />
            </Match>
          </Switch>
        </div>
      </V2Provider>
    </ShellBase>
  )
}

function ProfilePanel() {
  const profile = createProfile()
  return <ProfileView profile={profile} />
}
