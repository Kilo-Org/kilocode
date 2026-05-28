export type KiloProviderOptions = {
  projectDirectory?: string | null
  platform?: string
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  onSidebarVisibilityChange?: (visible: boolean) => void
  worktreeDirectories?: () => string[]
}
