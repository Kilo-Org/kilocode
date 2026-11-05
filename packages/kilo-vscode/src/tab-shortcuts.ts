// Which surface owns the shared tab shortcuts. The sidebar focus is the precise signal: the Agent Manager
// panel can stay the selected editor tab while the user moves focus to the sidebar.
export type TabShortcutTarget = "sidebar" | "agentManager"

export function tabShortcutTarget(sidebarFocused: boolean, agentManagerActive: boolean): TabShortcutTarget | undefined {
  if (sidebarFocused) return "sidebar"
  if (agentManagerActive) return "agentManager"
  return undefined
}
