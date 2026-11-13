// Which surface owns the shared tab shortcuts. The sidebar and chat editor focus are the precise signals: the Agent
// Manager panel can stay the selected editor tab while the user moves focus to the sidebar or a chat tab.
export type TabShortcutTarget = "sidebar" | "chatPanel" | "agentManager"

export function tabShortcutTarget(
  sidebarFocused: boolean,
  agentManagerActive: boolean,
  chatPanelFocused = false,
): TabShortcutTarget | undefined {
  if (sidebarFocused) return "sidebar"
  if (chatPanelFocused) return "chatPanel"
  if (agentManagerActive) return "agentManager"
  return undefined
}
