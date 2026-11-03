import type { Accessor } from "solid-js"
import type { Example } from "./examples"
import { rowId } from "./fleet"

/**
 * Lookup for the shared sidebar's `marker` slot: the numbered badge for each
 * feature's row. Badges are decorative; the feature list and stepper carry the text.
 */
export function createMarkers(example: Example, hover: Accessor<number | undefined>, step: Accessor<number>) {
  const ids = example.features.map((feature) => rowId(example, feature.row))
  return (id: string) => {
    const index = ids.indexOf(id)
    if (index < 0) return
    return (
      <span
        class="am-splash-row-marker"
        classList={{
          "am-splash-row-marker-hover": hover() === index,
          "am-splash-row-marker-step": step() === index,
        }}
        aria-hidden="true"
      >
        {index + 1}
      </span>
    )
  }
}
