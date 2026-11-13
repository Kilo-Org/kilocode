// The Settings, Profile and Marketplace editor panels: the shared webview providers and the v2 data layer, without the
// chat transcript, its rich content up front, its notifications or its session list. The Display tab adds the
// rich-content providers for its transcript preview when that tab opens.
import { Match, Switch } from "solid-js"
import { MarketplaceView } from "../components/marketplace"
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
            <Match when={props.view === "marketplace"}>
              <MarketplaceView />
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
