export interface ShortcutEntry {
  label: string
  binding: string
}

export interface ShortcutCategory {
  title: string
  shortcuts: ShortcutEntry[]
}

export function buildShortcutCategories(
  bindings: Record<string, string>,
  t: (key: string, params?: Record<string, string | number>) => string,
): ShortcutCategory[] {
  return [
    {
      title: t("agentManager.shortcuts.category.quickSwitch"),
      shortcuts: [
        {
          label: t("agentManager.shortcuts.jumpToItem"),
          binding: (() => {
            const first = bindings.jumpTo1 ?? ""
            const prefix = first.replace(/\d+$/, "")
            return prefix ? `${prefix}1-9` : ""
          })(),
        },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.sidebar"),
      shortcuts: [
        { label: t("agentManager.shortcuts.previousItem"), binding: bindings.previousSession ?? "" },
        { label: t("agentManager.shortcuts.nextItem"), binding: bindings.nextSession ?? "" },
        { label: t("agentManager.shortcuts.newWorktree"), binding: bindings.newWorktree ?? "" },
        { label: t("agentManager.shortcuts.advancedWorktree"), binding: bindings.advancedWorktree ?? "" },
        { label: t("agentManager.shortcuts.deleteWorktree"), binding: bindings.closeWorktree ?? "" },
        { label: t("agentManager.shortcuts.openWorktree"), binding: bindings.openWorktree ?? "" },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.tabs"),
      shortcuts: [
        { label: t("agentManager.shortcuts.previousTab"), binding: bindings.previousTab ?? "" },
        { label: t("agentManager.shortcuts.nextTab"), binding: bindings.nextTab ?? "" },
        { label: t("agentManager.shortcuts.newTab"), binding: bindings.newTab ?? "" },
        { label: t("agentManager.shortcuts.closeTab"), binding: bindings.closeTab ?? "" },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.terminal"),
      shortcuts: [
        { label: t("agentManager.shortcuts.toggleTerminal"), binding: bindings.showTerminal ?? "" },
        { label: t("agentManager.shortcuts.runScript"), binding: bindings.runScript ?? "" },
        { label: t("agentManager.shortcuts.toggleDiff"), binding: bindings.toggleDiff ?? "" },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.global"),
      shortcuts: [
        { label: t("agentManager.shortcuts.openAgentManager"), binding: bindings.agentManagerOpen ?? "" },
        { label: t("agentManager.shortcuts.cycleAgentMode"), binding: bindings.cycleAgentMode ?? "" },
        { label: t("agentManager.shortcuts.cyclePreviousAgentMode"), binding: bindings.cyclePreviousAgentMode ?? "" },
        { label: t("agentManager.shortcuts.showShortcuts"), binding: bindings.showShortcuts ?? "" },
      ].filter((s) => s.binding),
    },
  ].filter((c) => c.shortcuts.length > 0)
}
