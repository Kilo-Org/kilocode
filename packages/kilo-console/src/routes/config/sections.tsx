import { lazy, type Component } from "solid-js"
import type { IconProps } from "@kilocode/kilo-web-ui/icon"

const AgentBuilderRoute = lazy(() => import("./AgentsRoute").then((mod) => ({ default: mod.AgentBuilderRoute })))
const AgentsRoute = lazy(() => import("./AgentsRoute").then((mod) => ({ default: mod.AgentsRoute })))
const CliNotificationsRoute = lazy(() =>
  import("./CliNotificationsRoute").then((mod) => ({ default: mod.CliNotificationsRoute })),
)
const CliUiRoute = lazy(() => import("./CliUiRoute").then((mod) => ({ default: mod.CliUiRoute })))
const ConsoleUiRoute = lazy(() => import("./ConsoleUiRoute").then((mod) => ({ default: mod.ConsoleUiRoute })))
const FormattersRoute = lazy(() => import("./FormattersRoute").then((mod) => ({ default: mod.FormattersRoute })))
const LspRoute = lazy(() => import("./FormattersRoute").then((mod) => ({ default: mod.LspRoute })))
const IndexingRoute = lazy(() => import("./IndexingRoute").then((mod) => ({ default: mod.IndexingRoute })))
const KeybindsRoute = lazy(() => import("./KeybindsRoute").then((mod) => ({ default: mod.KeybindsRoute })))
const McpRoute = lazy(() => import("./McpRoute").then((mod) => ({ default: mod.McpRoute })))
const ModelsAvailableRoute = lazy(() => import("./ModelsRoute").then((mod) => ({ default: mod.ModelsAvailableRoute })))
const ModelsDefaultRoute = lazy(() => import("./ModelsRoute").then((mod) => ({ default: mod.ModelsDefaultRoute })))
const ModelsRoute = lazy(() => import("./ModelsRoute").then((mod) => ({ default: mod.ModelsRoute })))
const OverviewRoute = lazy(() => import("./OverviewRoute").then((mod) => ({ default: mod.OverviewRoute })))
const PermissionsRoute = lazy(() => import("./PermissionsRoute").then((mod) => ({ default: mod.PermissionsRoute })))
const ProvidersRoute = lazy(() => import("./ProvidersRoute").then((mod) => ({ default: mod.ProvidersRoute })))
const ServersRoute = lazy(() => import("./ServersRoute").then((mod) => ({ default: mod.ServersRoute })))
const SourcesRoute = lazy(() => import("./SourcesRoute").then((mod) => ({ default: mod.SourcesRoute })))
const ToolsRoute = lazy(() => import("./ToolsRoute").then((mod) => ({ default: mod.ToolsRoute })))

export type ConfigSection = {
  path: string
  href: string
  icon: IconProps["name"]
  label: string
  component: Component
}

export type ConfigGroup = {
  id: string
  label: string
  globalOnly?: boolean
  items: ConfigSection[]
}

export type ConfigNode = ConfigSection | ConfigGroup

const providers = {
  path: "/providers",
  href: "/settings/providers",
  icon: "providers",
  label: "Providers",
  component: ProvidersRoute,
}
const agents = { path: "/agents", href: "/settings/agents", icon: "task", label: "Agents", component: AgentsRoute }
const tools = { path: "/tools", href: "/settings/tools", icon: "code", label: "Tools", component: ToolsRoute }
const mcp = { path: "/mcp", href: "/settings/mcp", icon: "mcp", label: "MCP", component: McpRoute }
const permissions = {
  path: "/permissions",
  href: "/settings/permissions",
  icon: "key",
  label: "Permissions",
  component: PermissionsRoute,
}
const formatters = {
  path: "/formatters",
  href: "/settings/formatters",
  icon: "sliders",
  label: "Formatters",
  component: FormattersRoute,
}
const lsp = {
  path: "/lsp",
  href: "/settings/lsp",
  icon: "server",
  label: "LSP Servers",
  component: LspRoute,
}

export const configNav: ConfigNode[] = [
  {
    id: "general",
    label: "General",
    items: [{ path: "/", href: "/settings", icon: "home", label: "Overview", component: OverviewRoute }],
  },
  providers,
  {
    id: "models",
    label: "Models",
    items: [
      {
        path: "/models/default",
        href: "/settings/models/default",
        icon: "models",
        label: "Defaults",
        component: ModelsDefaultRoute,
      },
      {
        path: "/models/explore",
        href: "/settings/models/explore",
        icon: "models",
        label: "Explore",
        component: ModelsAvailableRoute,
      },
    ],
  },
  {
    id: "behaviour",
    label: "Behaviour",
    items: [
      agents,
      tools,
      permissions,
      mcp,
      formatters,
      lsp,
      {
        path: "/indexing",
        href: "/settings/indexing",
        icon: "circuit-board",
        label: "Code Indexing",
        component: IndexingRoute,
      },
    ],
  },
  {
    id: "cli",
    label: "CLI",
    items: [
      { path: "/cli/ui", href: "/settings/cli/ui", icon: "sliders", label: "UI", component: CliUiRoute },
      {
        path: "/cli/notifications",
        href: "/settings/cli/notifications",
        icon: "bubble-5",
        label: "Notifications",
        component: CliNotificationsRoute,
      },
      {
        path: "/cli/keybinds",
        href: "/settings/cli/keybinds",
        icon: "keyboard",
        label: "Keybinds",
        component: KeybindsRoute,
      },
    ],
  },
  {
    id: "console",
    label: "Console",
    globalOnly: true,
    items: [
      { path: "/console/ui", href: "/settings/console/ui", icon: "sliders", label: "UI", component: ConsoleUiRoute },
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    items: [
      { path: "/servers", href: "/settings/servers", icon: "server", label: "Servers", component: ServersRoute },
      { path: "/sources", href: "/settings/sources", icon: "archive", label: "Sources", component: SourcesRoute },
    ],
  },
]

function sections(item: ConfigNode) {
  if ("items" in item) return item.items
  return [item]
}

export const configSections = [
  ...configNav.flatMap(sections),
  { path: "/agents/new", href: "/settings/agents/new", icon: "task", label: "New Agent", component: AgentBuilderRoute },
  {
    path: "/agents/:agentID",
    href: "/settings/agents",
    icon: "task",
    label: "Edit Agent",
    component: AgentBuilderRoute,
  },
  { path: "/models", href: "/settings/models/default", icon: "models", label: "Models", component: ModelsRoute },
]
