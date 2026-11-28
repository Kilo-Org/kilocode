import { isHydrated } from "@solid-primitives/lifecycle"
import { createMediaQuery } from "@solid-primitives/media"
import { createHydratableSingletonRoot } from "@solid-primitives/rootless"
import { useMotionOff } from "./use-motion"

const query = "(prefers-reduced-motion: reduce)"

export const useReducedMotion = createHydratableSingletonRoot(() => {
  const value = createMediaQuery(query)
  const off = useMotionOff()
  // The OS setting is one reason not to move things. The motion budget is the
  // other: the client knows the window is in the background, and it is the only
  // place that knows the user asked for less motion.
  return () => !isHydrated() || value() || off()
})
