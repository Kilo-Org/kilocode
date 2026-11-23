export type TaskSurface = "sidebar" | "tab" | "agentManager"

/**
 * Remembers which Kilo surface the user last worked in.
 *
 * Focus cannot be sampled when a command runs. Opening the Command Palette
 * moves focus out of the webview, which reports `focused: false`, so by the
 * time a palette command executes every surface looks unfocused. Only focus
 * gains are recorded, and a surface is forgotten only when it goes away.
 */
export class SurfaceFocus {
  private surface: TaskSurface | undefined

  /** The surface's webview reported that it gained focus. */
  gained(surface: TaskSurface): void {
    this.surface = surface
  }

  /** The surface was hidden or closed, so it can no longer be the user's. */
  lost(surface: TaskSurface): void {
    if (this.surface === surface) this.surface = undefined
  }

  current(): TaskSurface | undefined {
    return this.surface
  }
}

export interface CloseTaskSurfaces<T> {
  /** Surface the user last worked in, if one is known. */
  focused: TaskSurface | undefined
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
 * The last focused surface wins, because these commands stop work and must act
 * where the user actually is. `WebviewPanel.active` cannot answer that on its
 * own: it stays true while the user works in the sidebar, and it is tracked per
 * editor group, so opening Agent Manager beside a Kilo tab leaves both panels
 * reporting `active`.
 *
 * Without a known surface, an active editor panel is preferred over the
 * sidebar, with Agent Manager first to match how `showMemory` already routes.
 */
export function closeTaskTarget<T>(surfaces: CloseTaskSurfaces<T>): T {
  if (surfaces.focused === "sidebar") return surfaces.sidebar
  if (surfaces.focused === "agentManager" && surfaces.agentManager) return surfaces.agentManager
  if (surfaces.focused === "tab" && surfaces.tab) return surfaces.tab
  return surfaces.agentManager ?? surfaces.tab ?? surfaces.sidebar
}
