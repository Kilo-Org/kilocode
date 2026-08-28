import { onCleanup, onMount } from "solid-js"

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
