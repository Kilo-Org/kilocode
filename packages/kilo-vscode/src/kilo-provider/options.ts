export type KiloProviderOptions = {
  /** Context key updated from focus events reported by this provider's webview. */
  focusContext?: string
  projectDirectory?: string | null
  platform?: string
  snapshotInitialization?: "wait"
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  worktreeDirectories?: () => string[]
  /** Composite hosts (Agent Manager) own viewed/presence registration themselves. */
  disableViewedRegistration?: boolean
}
