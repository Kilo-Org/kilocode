import HomeFooter from "../feature-plugins/home/footer"
import HomeTips from "../feature-plugins/home/tips"
// kilocode_change start
import HomeNews from "@/kilocode/plugins/home-news"
import HomeOnboarding from "@/kilocode/plugins/home-onboarding"
import KiloAttention from "@/kilocode/plugins/attention"
import KiloCopySessionSummary from "@/kilocode/plugins/copy-session-summary"
import KiloHomeFooter from "@/kilocode/plugins/home-footer"
import KiloPermissions from "@/kilocode/plugins/permissions" // kilocode_change
import KiloSidebarFooter from "@/kilocode/plugins/sidebar-footer"
import KiloSidebarBackgroundProcesses from "@/kilocode/plugins/sidebar-background-processes"
import KiloSidebarIndexing from "@/kilocode/plugins/sidebar-indexing"
import KiloSidebarMemory from "@/kilocode/plugins/sidebar-memory" // kilocode_change
import KiloMemoryPalette from "@/kilocode/plugins/memory-palette" // kilocode_change
import KiloSidebarPr from "@/kilocode/plugins/sidebar-pr"
import KiloSidebarUsage from "@/kilocode/plugins/sidebar-usage"
import KiloSandbox from "@/kilocode/plugins/sandbox"
import KiloRemote from "@/kilocode/plugins/remote"
import KiloReload from "@/kilocode/plugins/reload"
// kilocode_change end
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import PluginManager from "../feature-plugins/system/plugins"
import Notifications from "../feature-plugins/system/notifications"
import SessionV2Debug from "../feature-plugins/system/session-v2"
import WhichKey from "../feature-plugins/system/which-key"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import SessionSwitcher from "../feature-plugins/session"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { TuiPlugin, TuiPluginModule } from "@kilocode/plugin/tui"
import type { RuntimeFlags } from "@/effect/runtime-flags"

export type InternalTuiPlugin = Omit<TuiPluginModule, "id"> & {
  id: string
  tui: TuiPlugin
  enabled?: boolean
}

export function internalTuiPlugins(flags: Pick<RuntimeFlags.Info, "experimentalEventSystem">): InternalTuiPlugin[] {
  return [
    HomeNews, // kilocode_change
    HomeOnboarding, // kilocode_change
    KiloAttention, // kilocode_change
    KiloCopySessionSummary, // kilocode_change
    KiloHomeFooter, // kilocode_change
    KiloPermissions, // kilocode_change
    KiloSidebarFooter, // kilocode_change
    KiloSidebarMemory, // kilocode_change
    KiloMemoryPalette, // kilocode_change
    KiloSidebarBackgroundProcesses, // kilocode_change
    KiloSidebarIndexing, // kilocode_change
    KiloSidebarPr, // kilocode_change
    KiloSidebarUsage, // kilocode_change
    KiloSandbox, // kilocode_change
    KiloRemote, // kilocode_change
    KiloReload, // kilocode_change
    HomeFooter,
    HomeTips,
    SidebarContext,
    SidebarMcp,
    SidebarLsp,
    SidebarTodo,
    SidebarFiles,
    SidebarFooter,
    Notifications,
    PluginManager,
    WhichKey,
    DiffViewer,
    ...(flags.experimentalEventSystem ? [SessionV2Debug] : []),
    ...(Flag.KILO_EXPERIMENTAL_SESSION_SWITCHER ? [SessionSwitcher] : []),
  ]
}
