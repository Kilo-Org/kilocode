import { createSignal, onCleanup } from "solid-js"
import { createHydratableSingletonRoot } from "@solid-primitives/rootless"

/**
 * The motion budget the client puts on the root element.
 *
 * "full" is the default. "reduced" lets looping animations play once, "paused"
 * freezes whatever is running, and "off" turns motion off. The client owns the
 * value because only it knows whether the window is focused and whether the
 * user asked for less motion.
 *
 * The stylesheet reads the same attribute, so the CSS and the script-driven
 * motion always agree on the budget.
 */
export type Motion = "full" | "reduced" | "paused" | "off"

function read(): Motion {
  if (typeof document === "undefined") return "full"
  const value = document.documentElement.dataset.animations
  if (value === "reduced" || value === "paused" || value === "off") return value
  return "full"
}

/** The current budget. Reactive: it follows the attribute the client writes. */
export const useMotion = createHydratableSingletonRoot(() => {
  const [mode, setMode] = createSignal<Motion>(read())
  if (typeof document !== "undefined") {
    const observer = new MutationObserver(() => setMode(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-animations"] })
    onCleanup(() => observer.disconnect())
  }
  return mode
})

/** True when the budget does not allow motion to start. */
export function useMotionOff() {
  const mode = useMotion()
  return () => mode() === "off" || mode() === "paused"
}
