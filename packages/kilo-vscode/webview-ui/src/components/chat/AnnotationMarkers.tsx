import { type Accessor, type Component, For, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { createAnnotationBridge } from "../../utils/annotation-bridge"
import type { Annotation } from "../../utils/annotations"
import { resolveAnnotationAnchor, type AnnotationSourceCache } from "../../utils/annotation-anchors"
import "../../styles/annotation-markers.css"

export const AnnotationSourceMarkers: Component<{
  transcript: Accessor<HTMLElement | undefined>
  sessionID: Accessor<string | undefined>
}> = (props) => {
  const vscode = useVSCode()
  const language = useLanguage()
  const [marks, setMarks] = createSignal<{ sessionID: string; revision: number; items: Annotation[] }>()
  const error = (error: Error) =>
    showToast({ variant: "error", title: language.t("annotations.storageFailed"), description: error.message })
  const bridge = createAnnotationBridge({
    ...vscode,
    changed: (message) => {
      if (message.sessionID !== props.sessionID()) return
      const previous = marks()
      if (previous && previous.sessionID === message.sessionID && previous.revision > message.revision) return
      setMarks(message)
    },
    error,
  })
  const refresh = () => {
    const id = props.sessionID()
    if (id) void bridge.load(id).catch(error)
  }
  createEffect(() => {
    setMarks(undefined)
    refresh()
  })
  onMount(() => {
    window.addEventListener("focus", refresh)
    onCleanup(() => window.removeEventListener("focus", refresh))
  })
  onCleanup(bridge.dispose)
  return (
    <AnnotationMarkers
      transcript={props.transcript}
      sessionID={props.sessionID}
      items={() => {
        const current = marks()
        const sessionID = props.sessionID()
        return current && sessionID && current.sessionID === sessionID ? current.items : []
      }}
      label={(number) => language.t("annotations.sourceLabel", { number })}
    />
  )
}

interface Marker {
  item: Annotation
  top: number
  left: number
}

interface Cluster {
  items: Annotation[]
  top: number
  left: number
  width: number
  height: number
}

function arrange(markers: Marker[], bounds: DOMRect): Cluster[] {
  const top = Math.max(0, bounds.top)
  const bottom = Math.min(window.innerHeight, bounds.bottom)
  const left = Math.max(0, bounds.left)
  const right = Math.min(window.innerWidth, bounds.right)
  if (bottom <= top || right <= left) return []
  const placed: Cluster[] = []
  for (const marker of markers) {
    const cluster: Cluster = { items: [marker.item], top: marker.top, left: marker.left, width: 0, height: 0 }
    // Merge colliding groups before placing them, including collisions introduced by edge clamping.
    while (true) {
      cluster.width = Math.min(
        right - left,
        Math.max(...cluster.items.map((item) => String(item.number).length * 8 + 28)),
      )
      cluster.height = Math.min(bottom - top, cluster.items.length * 22 - 2)
      cluster.top = Math.max(top, Math.min(cluster.top, bottom - cluster.height))
      cluster.left = Math.max(left, Math.min(cluster.left, right - cluster.width))
      const index = placed.findIndex(
        (other) =>
          cluster.left < other.left + other.width + 2 &&
          cluster.left + cluster.width + 2 > other.left &&
          cluster.top < other.top + other.height + 2 &&
          cluster.top + cluster.height + 2 > other.top,
      )
      if (index < 0) break
      const other = placed.splice(index, 1)[0]!
      cluster.items.push(...other.items)
      cluster.top = Math.min(cluster.top, other.top)
      cluster.left = Math.min(cluster.left, other.left)
    }
    cluster.items.sort((a, b) => a.number! - b.number!)
    placed.push(cluster)
  }
  return placed
}

export const AnnotationMarkers: Component<{
  transcript: Accessor<HTMLElement | undefined>
  sessionID: Accessor<string | undefined>
  items: Accessor<readonly Annotation[]>
  label: (number: number) => string
}> = (props) => {
  const [markers, setMarkers] = createSignal<Cluster[]>([])
  createEffect(() => {
    const root = props.transcript()
    const id = props.sessionID()
    const items = props.items().filter((item) => item.sessionID === id && item.number && item.anchor)
    setMarkers([])
    if (!root || !id || !items.length) return
    let stopped = false
    let generation = 0
    let frame = 0
    const cache: AnnotationSourceCache = new Map()
    const observed = new Set<Element>()
    const resize = new ResizeObserver(() => schedule())
    const update = async () => {
      frame = 0
      const token = ++generation
      if (!root.isConnected || root.dataset.session !== id) {
        setMarkers([])
        return
      }
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-row="assistant"]')).filter(
        (row) =>
          row.dataset.session === id &&
          !row.hasAttribute("data-live") &&
          row.closest("[data-transcript-root]") === root,
      )
      const targets = new Set<Element>([root, ...rows])
      for (const row of cache.keys()) if (!targets.has(row)) cache.delete(row)
      for (const target of observed)
        if (!targets.has(target)) {
          resize.unobserve(target)
          observed.delete(target)
        }
      for (const target of targets)
        if (!observed.has(target)) {
          resize.observe(target)
          observed.add(target)
        }
      const bounds = root.getBoundingClientRect()
      const next = (
        await Promise.all(
          items.map(async (item) => {
            const owned = rows.filter((row) => row.dataset.message === item.messageID)
            if (owned.length !== 1) return
            const range = await resolveAnnotationAnchor(owned[0]!, item.anchor!, cache)
            if (!range) return
            const rect = Array.from(range.getClientRects()).find(
              (rect) =>
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > Math.max(0, bounds.top) &&
                rect.top < Math.min(window.innerHeight, bounds.bottom) &&
                rect.right > bounds.left &&
                rect.left < bounds.right,
            )
            if (!rect) return
            return {
              item,
              top: Math.max(bounds.top, rect.top),
              left: Math.max(bounds.left, Math.min(rect.right - 8, bounds.right - 32)),
            }
          }),
        )
      ).filter((item): item is Marker => !!item)
      if (stopped || token !== generation || !root.isConnected || root.dataset.session !== id) return
      setMarkers(arrange(next, bounds))
    }
    const schedule = () => {
      if (!frame && !stopped)
        frame = requestAnimationFrame(
          () =>
            void update().catch((error) => {
              if (stopped) return
              setMarkers([])
              console.warn("[Kilo New] Annotation source markers unavailable:", error)
            }),
        )
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".annotation-markers")) return
      schedule()
    }
    const mutation = new MutationObserver(() => {
      generation++
      cache.clear()
      setMarkers([])
      schedule()
    })
    mutation.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-session", "data-message", "data-live", "hidden", "class"],
    })
    window.addEventListener("scroll", scroll, { capture: true, passive: true })
    window.addEventListener("resize", schedule)
    schedule()
    onCleanup(() => {
      stopped = true
      generation++
      if (frame) cancelAnimationFrame(frame)
      mutation.disconnect()
      resize.disconnect()
      cache.clear()
      window.removeEventListener("scroll", scroll, true)
      window.removeEventListener("resize", schedule)
    })
  })
  return (
    <Portal>
      <div class="annotation-markers" data-annotation-marker="" data-session={props.sessionID()}>
        <For each={markers()}>
          {(cluster) => (
            <div
              class="annotation-marker-cluster"
              role="group"
              aria-label={cluster.items.map((item) => props.label(item.number!)).join(", ")}
              style={{
                top: `${cluster.top}px`,
                left: `${cluster.left}px`,
                width: `${cluster.width}px`,
                "max-height": `${cluster.height}px`,
                "pointer-events": cluster.items.length * 22 - 2 > cluster.height ? "auto" : undefined,
              }}
            >
              <For each={cluster.items}>
                {(item) => (
                  <Tooltip
                    value={
                      <span class="annotation-marker-detail">
                        {item.selectedText}
                        {"\n\n"}
                        {item.comment}
                      </span>
                    }
                    placement="top"
                  >
                    <Button
                      variant="secondary"
                      size="small"
                      class="annotation-marker-badge"
                      data-annotation-marker=""
                      aria-label={props.label(item.number!)}
                      title={`${props.label(item.number!)}\n${item.selectedText}\n${item.comment}`}
                    >
                      #{item.number}
                    </Button>
                  </Tooltip>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Portal>
  )
}
