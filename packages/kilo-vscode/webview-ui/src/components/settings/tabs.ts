// The v2 Settings rail: one entry per tab, in the order the rail shows them. `title` is an i18n key and `icon` is a
// kilo-ui icon name. `ready` marks the tabs with a finished v2 contract; the Settings view renders only ready tabs.
// The `ready` line is on its own so a later change that flips one tab does not touch the neighbouring entries.
import { lazy, type Component } from "solid-js"
import type { SettingsData } from "../../v2/settings"
import type { SettingsNavigationTarget } from "./settings-search"
import { sandboxControls } from "./sandboxing"

/** Props every tab component receives. */
export interface SettingsTabProps {
  settings: SettingsData
  onLogin: () => void
  subtab: string
  /** A row that a subtab renders itself, such as an MCP server name. */
  focus?: string
  /** Increments on each search navigation so a subtab can reset its editor without remounting. */
  navigation: number
  /** Agent Manager project a project-scoped tab opens for, as the project gear selected it. */
  projectId?: string
  onSubtabChange: (subtab: string) => void
  onNavigate: (target: SettingsNavigationTarget) => void
}

export interface SettingsTabV2 {
  id: string
  icon: string
  title: string
  ready: boolean
  /** Renders only when the platform supports it, such as the sandbox controls outside Windows. */
  visible?: () => boolean
  component: Component<SettingsTabProps>
}

export const SETTINGS_TABS_V2: SettingsTabV2[] = [
  {
    id: "models",
    icon: "models",
    title: "settings.models.title",
    ready: true,
    component: lazy(() => import("./ModelsTab")),
  },
  {
    id: "providers",
    icon: "providers",
    title: "settings.providers.title",
    ready: true,
    component: lazy(() => import("./ProvidersTab")),
  },
  {
    id: "agentBehaviour",
    icon: "brain",
    title: "settings.agentBehaviour.title",
    ready: true,
    component: lazy(() => import("./AgentBehaviourTab")),
  },
  {
    id: "autoApprove",
    icon: "checklist",
    title: "settings.autoApprove.title",
    ready: true,
    component: lazy(() => import("./AutoApproveTab")),
  },
  {
    id: "agentManager",
    icon: "settings-gear",
    title: "agentManager.settings.title",
    ready: true,
    component: lazy(() => import("./AgentManagerTab")),
  },
  {
    id: "browser",
    icon: "window-cursor",
    title: "settings.webTools.title",
    ready: true,
    component: lazy(() => import("./BrowserTab")),
  },
  {
    id: "checkpoints",
    icon: "branch",
    title: "settings.checkpoints.title",
    ready: true,
    component: lazy(() => import("./CheckpointsTab")),
  },
  {
    id: "display",
    icon: "eye",
    title: "settings.display.title",
    ready: true,
    component: lazy(() => import("./DisplayTab")),
  },
  {
    id: "autocomplete",
    icon: "code-lines",
    title: "settings.autocomplete.title",
    ready: true,
    component: lazy(() => import("./AutocompleteTab")),
  },
  {
    id: "notifications",
    icon: "circle-check",
    title: "settings.notifications.title",
    ready: true,
    component: lazy(() => import("./NotificationsTab")),
  },
  {
    id: "context",
    icon: "server",
    title: "settings.context.title",
    ready: true,
    component: lazy(() => import("./ContextTab")),
  },
  {
    id: "indexing",
    icon: "database",
    title: "settings.indexing.title",
    ready: true,
    component: lazy(() => import("./IndexingTab")),
  },
  {
    id: "commitMessage",
    icon: "edit",
    title: "settings.commitMessage.title",
    ready: true,
    component: lazy(() => import("./CommitMessageTab")),
  },
  {
    id: "experimental",
    icon: "settings-gear",
    title: "settings.experimental.title",
    ready: true,
    component: lazy(() => import("./ExperimentalTab")),
  },
  {
    id: "sandboxing",
    icon: "shield",
    title: "settings.sandboxing.title",
    ready: true,
    visible: sandboxControls,
    component: lazy(() => import("./SandboxingTab")),
  },
  {
    id: "language",
    icon: "speech-bubble",
    title: "settings.language.title",
    ready: true,
    component: lazy(() => import("./LanguageTab")),
  },
  {
    id: "aboutKiloCode",
    icon: "help",
    title: "settings.aboutKiloCode.title",
    ready: true,
    component: lazy(() => import("./AboutKiloCodeTab")),
  },
]
