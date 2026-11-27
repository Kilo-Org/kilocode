// The Settings, Profile and Marketplace editor panels: the shared webview providers and the v2 data layer, without the
// chat transcript, its rich content up front, its notifications or its session list. The Display tab adds the
// rich-content providers for its transcript preview when that tab opens.
import { Match, onCleanup, onMount, Switch } from "solid-js"
import type { ToHost } from "../../../src/protocol"
import { MarketplaceView } from "../components/marketplace"
import ProfileView from "../components/profile/ProfileView"
import { useVSCode } from "../context/vscode"
import { V2Provider } from "./client"
import { createProfile, type Profile } from "./profile"
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

export function ProfilePanel(props: { profile?: Profile }) {
  const profile = props.profile ?? createProfile()
  const vscode = useVSCode()
  // Tell the host once the listener is live so a pending signed-out sign-in request starts right away.
  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as { type?: string }
    if (message.type === "profileLogin") profile.login()
  })
  onCleanup(unsubscribe)
  onMount(() => vscode.postMessage({ type: "profileReady" } satisfies ToHost as never))
  return <ProfileView profile={profile} />
}
