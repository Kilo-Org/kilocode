// The v2 Settings rail: one entry per tab, in the order the rail shows them. `title` is an i18n key and `icon` is a
// kilo-ui icon name. `ready` marks the tabs with a finished v2 contract; the Settings view renders only ready tabs.
// The `ready` line is on its own so a later change that flips one tab does not touch the neighbouring entries.
import { lazy, type Component } from "solid-js"
import type { SettingsData } from "../../v2/settings"

/** Props every tab component receives. A tab that needs neither is typed `Component` and ignores them. */
export interface SettingsTabProps {
  settings: SettingsData
  onLogin: () => void
}

export interface SettingsTabV2 {
  id: string
  icon: string
  title: string
  ready: boolean
  component: Component<SettingsTabProps>
}

export const SETTINGS_TABS_V2: SettingsTabV2[] = [
  {
    id: "models",
    icon: "models",
    title: "settings.models.title",
    ready: false,
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
    ready: false,
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
    ready: false,
    component: lazy(() => import("./CheckpointsTab")),
  },
  {
    id: "display",
    icon: "eye",
    title: "settings.display.title",
    ready: false,
    component: lazy(() => import("./DisplayTab")),
  },
  {
    id: "context",
    icon: "server",
    title: "settings.context.title",
    ready: false,
    component: lazy(() => import("./ContextTab")),
  },
  {
    id: "experimental",
    icon: "settings-gear",
    title: "settings.experimental.title",
    ready: true,
    component: lazy(() => import("./ExperimentalTab")),
  },
  {
    id: "language",
    icon: "speech-bubble",
    title: "settings.language.title",
    ready: false,
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
