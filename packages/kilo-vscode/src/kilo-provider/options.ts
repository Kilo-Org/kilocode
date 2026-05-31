export type KiloProviderOptions = {
  projectDirectory?: string | null
  platform?: string
  snapshotInitialization?: "wait"
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  onSidebarVisibilityChange?: (visible: boolean) => void
  worktreeDirectories?: () => string[]
}
