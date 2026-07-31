import type { ProjectRouteService } from "../agent-manager/project/route"

export type KiloProviderOptions = {
  /** Context key updated from focus events reported by this provider's webview. */
  focusContext?: string
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
}
