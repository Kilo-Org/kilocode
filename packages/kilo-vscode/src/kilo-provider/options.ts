export type KiloProviderOptions = {
  /** Context key updated from focus events reported by this provider's webview. */
  focusContext?: string
  /**
   * This provider's webview gained focus. Only gains are reported: transient UI
   * such as the Command Palette blurs the webview, so a `false` report says
   * nothing about which surface the user considers current.
   */
  onFocused?: () => void
  /** The sidebar view holding this provider was hidden. */
  onHidden?: () => void
  /** Context keys updated by prompt and terminal focus events. */
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
  tabLabel?: string
  worktreeDirectories?: () => string[]
  /**
   * Dynamic root directory override. When present, it replaces the
   * workspaceFolders[0] fallback so the provider's sessions, prompts, and
   * refreshes follow the host's active project.
   */
  rootDirectory?: () => string | undefined
  /** Composite hosts own viewed/presence registration themselves. */
  disableViewedRegistration?: boolean
  disableStatsPolling?: boolean
  /**
   * Resolve the active project for a raw session id, so a project-qualified
   * session ref can be built when the caller does not already carry one.
   */
  projectQualifier?: () => { projectId: string } | undefined
  /**
   * Hides the in-webview sidebar top bar (New Task, History, etc.) for
   * dedicated single-purpose panels. Sidebar and "Open in Tab" leave this unset.
   */
  hideTopBar?: boolean
  /** Reports "Open in Tab" as the top bar's surface instead of the sidebar default. */
  topBarSurface?: "tab"
}
