import HomeFooter from "../feature-plugins/home/footer"
import HomeTips from "../feature-plugins/home/tips"
// kilocode_change start
import HomeNews from "@/kilocode/plugins/home-news"
import HomeOnboarding from "@/kilocode/plugins/home-onboarding"
import KiloHomeFooter from "@/kilocode/plugins/home-footer"
import KiloSidebarFooter from "@/kilocode/plugins/sidebar-footer"
import KiloSidebarPr from "@/kilocode/plugins/sidebar-pr"
import KiloSidebarUsage from "@/kilocode/plugins/sidebar-usage"
// kilocode_change end
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import PluginManager from "../feature-plugins/system/plugins"
import type { TuiPlugin, TuiPluginModule } from "@kilocode/plugin/tui"

export type InternalTuiPlugin = TuiPluginModule & {
  id: string
  tui: TuiPlugin
}

export const INTERNAL_TUI_PLUGINS: InternalTuiPlugin[] = [
  HomeNews, // kilocode_change
  HomeOnboarding, // kilocode_change
  KiloHomeFooter, // kilocode_change
  KiloSidebarFooter, // kilocode_change
  KiloSidebarPr, // kilocode_change
  KiloSidebarUsage, // kilocode_change
  HomeFooter,
  HomeTips,
  SidebarContext,
  SidebarMcp,
  SidebarLsp,
  SidebarTodo,
  SidebarFiles,
  SidebarFooter,
  PluginManager,
]
