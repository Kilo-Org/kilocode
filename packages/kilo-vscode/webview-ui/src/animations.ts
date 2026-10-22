/**
 * Motion budget for the chat webview.
 *
 * The chat animates the status shimmer, the spinner, and the agent avatars
 * while a session works. Those animations tick on the main thread, so a
 * window that is in the background keeps a renderer busy at the display
 * refresh rate. The budget is the smaller of what the user asked for and
 * what the window can afford: a chat nobody is looking at only needs its
 * motion paused.
 */

/** Mirrors the `kilo-code.new.uiAnimations` extension setting. */
export type Animations = "full" | "reduced" | "off"

/** The setting, plus the paused state the client derives from the window. */
export type Motion = Animations | "paused"

export function resolveAnimations(user: Animations, focused: boolean, hidden: boolean): Motion {
  if (user === "off") return "off"
  if (!focused || hidden) return "paused"
  return user
}

/**
 * Whether the chat should stop moving.
 *
 * The webview already carries a reduce-motion escape hatch that both the
 * stylesheet and the script-driven motion read, so the budget reaches the
 * Web Animations API calls the stylesheet cannot touch.
 */
export function reduceMotion(mode: Motion): boolean {
  return mode === "off" || mode === "paused"
}

export function applyAnimations(user: Animations, focused: boolean) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  const mode = resolveAnimations(user, focused, document.visibilityState === "hidden")
  if (mode === "full") delete root.dataset.animations
  else root.dataset.animations = mode
  document.body?.classList.toggle("vscode-reduce-motion", reduceMotion(mode))
}
