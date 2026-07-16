import type { BuiltinTuiPlugin } from "@opencode-ai/tui/builtins"
import HomeNews from "@/kilocode/plugins/home-news"
import HomeOnboarding from "@/kilocode/plugins/home-onboarding"
import Attention from "@/kilocode/plugins/attention"
import HomeFooter from "@/kilocode/plugins/home-footer"
import Permissions from "@/kilocode/plugins/permissions"
import SidebarFooter from "@/kilocode/plugins/sidebar-footer"
import MemoryStatus from "@/kilocode/plugins/memory-status"
import MemoryPalette from "@/kilocode/plugins/memory-palette"
import SidebarProcesses from "@/kilocode/plugins/sidebar-background-processes"
import SidebarIndexing from "@/kilocode/plugins/sidebar-indexing"
import SidebarPr from "@/kilocode/plugins/sidebar-pr"
import SidebarUsage from "@/kilocode/plugins/sidebar-usage"
import Sandbox from "@/kilocode/plugins/sandbox"
import Remote from "@/kilocode/plugins/remote"
import Reload from "@/kilocode/plugins/reload"
import SessionSwitcher from "@/kilocode/plugins/session-switcher"
import SessionV2Debug from "@/kilocode/plugins/session-v2-debug"
import type { RuntimeFlags } from "@/effect/runtime-flags"

const plugins = [
  HomeNews,
  HomeOnboarding,
  Attention,
  HomeFooter,
  Permissions,
  SidebarFooter,
  MemoryStatus,
  MemoryPalette,
  SidebarProcesses,
  SidebarIndexing,
  SidebarPr,
  SidebarUsage,
  Sandbox,
  Remote,
  Reload,
] satisfies BuiltinTuiPlugin[]

export function withKiloTuiPlugins(
  builtins: BuiltinTuiPlugin[],
  flags: Pick<RuntimeFlags.Info, "experimentalEventSystem" | "experimentalSessionSwitcher">,
) {
  return [
    ...plugins,
    ...(flags.experimentalEventSystem ? [SessionV2Debug] : []),
    ...(flags.experimentalSessionSwitcher ? [SessionSwitcher] : []),
    ...builtins,
  ]
}
