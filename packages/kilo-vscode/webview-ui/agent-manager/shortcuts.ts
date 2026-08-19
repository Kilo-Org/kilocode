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
  const bind = (key: string) => bindings[key] ?? ""
  return [
    {
      title: t("agentManager.shortcuts.category.quickSwitch"),
      shortcuts: [
        { label: t("agentManager.sidebarSearch.label"), binding: bind("search") },
        {
          label: t("agentManager.shortcuts.jumpToItem"),
          binding: (() => {
            const first = bind("jumpTo1")
            const prefix = first.replace(/\d+$/, "")
            return prefix ? `${prefix}1-9` : ""
          })(),
        },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.sidebar"),
      shortcuts: [
        { label: t("agentManager.shortcuts.previousItem"), binding: bind("previousSession") },
        { label: t("agentManager.shortcuts.nextItem"), binding: bind("nextSession") },
        { label: t("agentManager.shortcuts.advancedWorktree"), binding: bindings.newWorktree ?? "" },
        { label: t("agentManager.shortcuts.newWorktree"), binding: bindings.quickWorktree ?? "" },
        { label: t("agentManager.shortcuts.deleteWorktree"), binding: bind("closeWorktree") },
        { label: t("agentManager.shortcuts.openWorktree"), binding: bind("openWorktree") },
        { label: t("agentManager.shortcuts.openPR"), binding: bind("openPR") },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.tabs"),
      shortcuts: [
        { label: t("agentManager.shortcuts.previousTab"), binding: bind("previousTab") },
        { label: t("agentManager.shortcuts.nextTab"), binding: bind("nextTab") },
        { label: t("agentManager.shortcuts.newTab"), binding: bind("newTab") },
        { label: t("agentManager.shortcuts.closeTab"), binding: bind("closeTab") },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.terminal"),
      shortcuts: [
        { label: t("agentManager.shortcuts.toggleTerminal"), binding: bind("showTerminal") },
        { label: t("agentManager.terminal.addCentral"), binding: bind("newTerminalCenter") },
        { label: t("agentManager.terminal.addTerminal"), binding: bind("newTerminalTerminal") },
        {
          label: `${t("agentManager.shortcuts.previousTab")} (${t("agentManager.tab.terminal")})`,
          binding: bind("previousTerminal"),
        },
        {
          label: `${t("agentManager.shortcuts.nextTab")} (${t("agentManager.tab.terminal")})`,
          binding: bind("nextTerminal"),
        },
        { label: t("agentManager.shortcuts.runScript"), binding: bind("runScript") },
        { label: t("agentManager.shortcuts.toggleDiff"), binding: bind("toggleDiff") },
      ],
    },
    {
      title: t("agentManager.shortcuts.category.global"),
      shortcuts: [
        { label: t("agentManager.shortcuts.openAgentManager"), binding: bind("agentManagerOpen") },
        { label: t("agentManager.shortcuts.cycleAgentMode"), binding: bind("cycleAgentMode") },
        { label: t("agentManager.shortcuts.cyclePreviousAgentMode"), binding: bind("cyclePreviousAgentMode") },
        { label: t("agentManager.shortcuts.showShortcuts"), binding: bind("showShortcuts") },
      ].filter((s) => s.binding),
    },
  ].filter((c) => c.shortcuts.length > 0)
}
