import type { ProjectRouteService } from "../agent-manager/project/route"
import type { SettingsHandler } from "../agent-manager/project/settings"

export type AgentManagerSettingsHandler = SettingsHandler

export type KiloProviderOptions = {
  /** Context key updated from focus events reported by this provider's webview. */
  focusContext?: string
  /** Context keys updated by Agent Manager prompt and terminal focus events. */
  focusTargetContext?: {
    prompt: string
    mainTerminal: string
    sideTerminal: string
  }
  projectDirectory?: string | null
  platform?: string
  snapshotInitialization?: "wait"
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  worktreeDirectories?: () => string[]
  /**
   * Dynamic root directory override. When present, it replaces the
   * workspaceFolders[0] fallback so the provider's sessions, prompts, and
   * refreshes follow the host's active project (Agent Manager).
   */
  rootDirectory?: () => string | undefined
  /** Composite hosts (Agent Manager) own viewed/presence registration themselves. */
  disableViewedRegistration?: boolean
  disableStatsPolling?: boolean
  /**
   * Project route registry shared by all Agent Manager panels. When set, the
   * provider resolves project-qualified session refs to exact directories and
   * refuses to silently retarget an ambiguous raw session id to the active
   * root. Non-Agent-Manager providers leave this undefined and behave exactly
   * as before.
   */
  routeService?: ProjectRouteService
  /**
   * Resolve the active Agent Manager project for a raw session id, so a
   * project-qualified {@link SessionRef} can be built when the caller does not
   * already carry one. Returns undefined when no project is active or the id
   * is ambiguous.
   */
  projectQualifier?: () => { projectId: string } | undefined
  /**
   * Hides the in-webview sidebar top bar (New Task, History, Agent Manager,
   * etc.) for dedicated single-purpose panels — Settings, Profile, and the
   * Sub-Agent Viewer — where it doesn't apply and would let users navigate
   * away from the panel's one job. Sidebar and "Open in Tab" leave this unset.
   */
  hideTopBar?: boolean
  /** Reports "Open in Tab" as the top bar's telemetry surface instead of the sidebar default. */
  topBarSurface?: "tab"
  /** Project-aware settings used by the standalone Agent Manager settings tab. */
  agentManagerSettings?: AgentManagerSettingsHandler
}
