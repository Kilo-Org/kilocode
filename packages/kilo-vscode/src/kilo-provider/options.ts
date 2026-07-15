export type KiloProviderOptions = {
  projectDirectory?: string | null
  platform?: string
  snapshotInitialization?: "wait"
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  worktreeDirectories?: () => string[]
  /** Composite hosts (Agent Manager) own viewed/presence registration themselves. */
  disableViewedRegistration?: boolean
}
