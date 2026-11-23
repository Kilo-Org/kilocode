import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import { createSignal, lazy, Match, onCleanup, Show, Switch } from "solid-js"
import { render } from "solid-js/web"
import Settings from "../src/components/settings/Settings"
import { Base } from "../src/context/provider-base"
import { Session } from "../src/context/provider-session"
import { MemoryProvider } from "../src/context/memory"
import { useVSCode } from "../src/context/vscode"
import { useServer } from "../src/context/server"

const MigrationWizard = lazy(() => import("../src/components/migration/MigrationWizard"))
const ProfileView = lazy(() => import("../src/components/profile/ProfileView"))

const Content = () => {
  const vscode = useVSCode()
  const server = useServer()
  const host = window as typeof window & {
    KILO_SETTINGS?: { tab?: string; projectId?: string }
    KILO_AGENT_MANAGER_SETTINGS?: boolean
  }
  const [tab, setTab] = createSignal(host.KILO_SETTINGS?.tab)
  const [subtab, setSubtab] = createSignal<string>()
  const [focus, setFocus] = createSignal<{ token: number; value: string }>()
  const [project, setProject] = createSignal(host.KILO_SETTINGS?.projectId)
  const [migration, setMigration] = createSignal(false)
  const [profile, setProfile] = createSignal(false)
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "navigate") return
    if (message.view === "profile") {
      setProfile(true)
      setMigration(false)
      return
    }
    if (message.view !== "settings") return
    if (message.tab) {
      setTab(message.tab)
      vscode.postMessage({ type: "settingsTabChanged", tab: message.tab })
    }
    if (message.subtab) setSubtab(message.subtab)
    if (message.focus) setFocus((prev) => ({ token: (prev?.token ?? 0) + 1, value: message.focus! }))
    setProject(message.projectId)
    setMigration(false)
    setProfile(false)
  })
  onCleanup(unsubscribe)

  return (
    <div class="container">
      <Show
        when={migration()}
        fallback={
          <Switch>
            <Match when={profile()}>
              <ProfileView
                profileData={server.profileData()}
                providerUsage={server.providerUsage()}
                providerUsageLoading={server.providerUsageLoading()}
                providerUsageError={server.providerUsageError()}
                deviceAuth={server.deviceAuth()}
                onLogin={server.startLogin}
                onRequestProviderUsage={server.requestProviderUsage}
                onRefreshProviderUsage={server.refreshProviderUsage}
              />
            </Match>
            <Match when={!profile()}>
              <Settings
                tab={tab()}
                subtab={subtab()}
                focus={focus()}
                agentManagerProjectId={project()}
                agentManagerSettings={host.KILO_AGENT_MANAGER_SETTINGS === true}
                onTabChange={setTab}
                onAgentBehaviourNavigationConsumed={() => {
                  setSubtab(undefined)
                  setFocus(undefined)
                }}
                onMigrationClick={() => setMigration(true)}
              />
            </Match>
          </Switch>
        }
      >
        <MigrationWizard onBack={() => setMigration(false)} onComplete={() => setMigration(false)} />
      </Show>
    </div>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")

render(
  () => (
    <Base>
      <Session>
        <MemoryProvider>
          <Content />
        </MemoryProvider>
      </Session>
    </Base>
  ),
  root,
)
