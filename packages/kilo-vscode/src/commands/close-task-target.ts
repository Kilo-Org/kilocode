export interface CloseTaskSurfaces<T> {
  /** Sidebar provider, and the fallback when nothing else owns the command. */
  sidebar: T
  /** Kilo editor tab provider, present only while such a tab is the active editor. */
  tab?: T
  /** Agent Manager provider, present only while its panel is active. */
  agentManager?: T
}

/**
 * Pick the Kilo surface a task-close command belongs to.
 *
 * A focused sidebar always wins: `WebviewPanel.active` can still report an
 * editor panel as active while the user works in the sidebar, and on Agent
 * Manager these commands stop sessions, so a panel flag must never take
 * precedence over where the user actually is.
 *
 * Between the two editor surfaces, Agent Manager wins. `active` is tracked per
 * editor group, so opening Agent Manager beside a Kilo tab leaves both panels
 * reporting `active`, and Agent Manager is the surface the user just moved to.
 * This also matches how `showMemory` and `toggleMemory` already route.
 */
export function closeTaskTarget<T>(surfaces: CloseTaskSurfaces<T> & { sidebarFocused: boolean }): T {
  if (surfaces.sidebarFocused) return surfaces.sidebar
  return surfaces.agentManager ?? surfaces.tab ?? surfaces.sidebar
}
