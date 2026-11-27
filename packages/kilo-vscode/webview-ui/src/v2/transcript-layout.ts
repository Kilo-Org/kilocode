// Tracks transcript scroller height and layout fingerprint while pausing reads for inactive cached views.
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { layoutFingerprint } from "./transcript-cache"

export function createTranscriptLayout(opts: {
  scrollEl: Accessor<HTMLDivElement | undefined>
  viewActive: Accessor<boolean>
}) {
  const [layout, setLayout] = createSignal("")
  const [height, setHeight] = createSignal(0)
  let resize: ResizeObserver | undefined
  let stale = false
  let pendingFrame: number | undefined

  const refresh = () => {
    if (!opts.viewActive()) {
      stale = true
      return
    }
    const el = opts.scrollEl()
    if (!el) return
    stale = false
    const style = getComputedStyle(el)
    setHeight(el.clientHeight)
    setLayout(
      layoutFingerprint({
        width: Math.round(el.clientWidth),
        ratio: window.devicePixelRatio,
        font: style.fontFamily,
        size: style.fontSize,
        line: style.lineHeight,
      }),
    )
  }

  createEffect(
    on(
      opts.viewActive,
      (active) => {
        if (!active || !stale) return
        if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame)
        pendingFrame = requestAnimationFrame(() => {
          pendingFrame = undefined
          refresh()
        })
      },
      { defer: true },
    ),
  )

  window.addEventListener("resize", refresh)
  document.fonts?.addEventListener("loadingdone", refresh)
  onCleanup(() => {
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame)
    resize?.disconnect()
    window.removeEventListener("resize", refresh)
    document.fonts?.removeEventListener("loadingdone", refresh)
  })

  const observe = (el: HTMLDivElement | undefined) => {
    resize?.disconnect()
    if (!el) return
    refresh()
    resize = new ResizeObserver(refresh)
    resize.observe(el)
  }

  return { layout, height, observe }
}
