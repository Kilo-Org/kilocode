export const SCROLL_WORLD = "kilo-scroll"

// Installed in an isolated world on the page so scrolling runs at full 60 Hz without CDP's 2-frame synthetic
// mouseWheel phaseEnded stall or macOS elastic overscroll bounce. Preserves wheel listeners, preventDefault(),
// nested scrollers, Shadow DOM, and same-origin iframes with parent scroll-chaining; returns false for Ctrl+wheel
// zoom or cross-origin iframes so the worker falls back to native CDP Input.dispatchMouseEvent.
export const SCROLL_HELPER = `(() => {
  if (window !== window.top) return
  const canScroll = (el, axis) => {
    const ov = axis === "y" ? getComputedStyle(el).overflowY : getComputedStyle(el).overflowX
    if (ov !== "auto" && ov !== "scroll" && ov !== "overlay") return false
    return axis === "y" ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1
  }
  const deepElement = (doc, x, y) => {
    let el = doc.elementFromPoint(x, y)
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === el) break
      el = inner
    }
    return el
  }
  const rootAllowed = (doc, root, axis) => {
    const ov = axis === "y" ? getComputedStyle(root).overflowY : getComputedStyle(root).overflowX
    if (ov === "hidden" || ov === "clip") return false
    if (doc.body && doc.body !== root) {
      const bov = axis === "y" ? getComputedStyle(doc.body).overflowY : getComputedStyle(doc.body).overflowX
      if (bov === "hidden" && ov === "visible") return false
    }
    return true
  }
  const scrollDoc = (doc, start, rx, ry) => {
    const root = doc.scrollingElement || doc.documentElement
    let node = start
    while (node && (rx !== 0 || ry !== 0)) {
      if (node === root || node === doc.documentElement) break
      if (node instanceof Element) {
        const st = getComputedStyle(node)
        const yScroll = ry !== 0 && canScroll(node, "y")
        const xScroll = rx !== 0 && canScroll(node, "x")
        let sx = 0
        let sy = 0
        if (yScroll) {
          const max = node.scrollHeight - node.clientHeight
          sy = Math.max(0, Math.min(max, node.scrollTop + ry)) - node.scrollTop
        }
        if (xScroll) {
          const max = node.scrollWidth - node.clientWidth
          sx = Math.max(0, Math.min(max, node.scrollLeft + rx)) - node.scrollLeft
        }
        if (sx !== 0 || sy !== 0) {
          node.scrollBy({ left: sx, top: sy, behavior: "instant" })
          rx -= sx
          ry -= sy
        }
        if (yScroll && (st.overscrollBehaviorY === "contain" || st.overscrollBehaviorY === "none")) ry = 0
        if (xScroll && (st.overscrollBehaviorX === "contain" || st.overscrollBehaviorX === "none")) rx = 0
      }
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null
    }
    if ((rx !== 0 || ry !== 0) && root) {
      const st = getComputedStyle(root)
      let sx = 0
      let sy = 0
      if (ry !== 0 && rootAllowed(doc, root, "y")) {
        const max = Math.max(0, root.scrollHeight - root.clientHeight)
        sy = Math.max(0, Math.min(max, root.scrollTop + ry)) - root.scrollTop
      }
      if (rx !== 0 && rootAllowed(doc, root, "x")) {
        const max = Math.max(0, root.scrollWidth - root.clientWidth)
        sx = Math.max(0, Math.min(max, root.scrollLeft + rx)) - root.scrollLeft
      }
      if (sx !== 0 || sy !== 0) {
        const win = doc.defaultView
        if (win) win.scrollBy({ left: sx, top: sy, behavior: "instant" })
        else root.scrollBy({ left: sx, top: sy, behavior: "instant" })
        rx -= sx
        ry -= sy
      }
      if (st.overscrollBehaviorY === "contain" || st.overscrollBehaviorY === "none") ry = 0
      if (st.overscrollBehaviorX === "contain" || st.overscrollBehaviorX === "none") rx = 0
    }
    return [rx, ry]
  }
  globalThis.__kiloScroll = (x, y, dx, dy, mods) => {
    if (mods & 2) return false
    const chain = []
    let doc = document
    let lx = x
    let ly = y
    let target = deepElement(doc, lx, ly)
    while (target && target.tagName === "IFRAME") {
      let innerDoc
      try {
        innerDoc = target.contentDocument
      } catch {
        return false
      }
      if (!innerDoc) return false
      chain.push({ doc, start: target.parentElement })
      const r = target.getBoundingClientRect()
      lx -= r.left
      ly -= r.top
      doc = innerDoc
      target = deepElement(doc, lx, ly)
    }
    chain.push({ doc, start: target })
    const receiver = target || doc.scrollingElement || doc.documentElement
    if (!receiver) return false
    const ev = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: lx,
      clientY: ly,
      deltaX: dx,
      deltaY: dy,
      deltaMode: 0,
      altKey: !!(mods & 1),
      ctrlKey: !!(mods & 2),
      metaKey: !!(mods & 4),
      shiftKey: !!(mods & 8),
    })
    if (!receiver.dispatchEvent(ev)) return true
    let rx = dx
    let ry = dy
    for (let i = chain.length - 1; i >= 0 && (rx !== 0 || ry !== 0); i--) {
      ;[rx, ry] = scrollDoc(chain[i].doc, chain[i].start, rx, ry)
    }
    return true
  }
})()`
