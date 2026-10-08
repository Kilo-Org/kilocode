import { onCleanup, onMount } from "solid-js"

// 5x5 grid without corners, the same cell geometry as the agent avatar. The
// inner 3x3 pulses bright and the outer ring pulses dim. Cells that share a
// timing are drawn as one path, so the spinner keeps 12 animated elements
// (like the old 4x4 grid) while it shows 21 cells. Cells in a group do not
// touch, so the pulses still look independent.
const groups = [[12], [7, 17], [6, 13, 16], [8, 11, 18], [1, 19], [3, 22], [14, 15], [5, 23], [2], [9], [10], [21]]

// A 3x3 square with 1px rounded corners, at a 4-unit pitch.
function cell(index: number) {
  const x = (index % 5) * 4
  const y = Math.floor(index / 5) * 4
  return `M${x + 1} ${y}h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1z`
}

export const squares = groups.map((group, index) => ({
  id: index,
  d: group.map(cell).join(""),
  delay: Math.random() * 1.5,
  duration: 1 + Math.random() * 1,
  outer: index >= 4,
}))

const roots = new Map<Element, boolean>()
let observer: IntersectionObserver | undefined

function update(root: Element, visible: boolean) {
  root.toggleAttribute("data-paused", !visible || document.visibilityState === "hidden")
}

function refresh() {
  for (const [root, visible] of roots) update(root, visible)
}

export function observe(root: SVGSVGElement) {
  onMount(() => {
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!roots.has(entry.target)) continue
          const visible = entry.isIntersecting && entry.intersectionRatio > 0
          roots.set(entry.target, visible)
          update(entry.target, visible)
        }
      })
      document.addEventListener("visibilitychange", refresh)
    }
    roots.set(root, false)
    update(root, false)
    observer.observe(root)
    onCleanup(() => {
      observer?.unobserve(root)
      roots.delete(root)
      root.removeAttribute("data-paused")
      if (roots.size > 0) return
      observer?.disconnect()
      observer = undefined
      document.removeEventListener("visibilitychange", refresh)
    })
  })
}
