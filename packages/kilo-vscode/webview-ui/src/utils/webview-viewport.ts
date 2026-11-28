const WIDTH = 300
const HEIGHT = 150
const DELAY = 150

type Target = Pick<
  Window,
  "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout"
>

type Doc = Pick<Document, "body" | "getElementById" | "hasFocus">

export function collapsed(win: Pick<Window, "innerWidth" | "innerHeight">): boolean {
  return (win.innerWidth === WIDTH && win.innerHeight === HEIGHT) || win.innerWidth === 0 || win.innerHeight === 0
}

/**
 * VS Code lays out hidden `retainContextWhenHidden` webviews with CSS anchor
 * positioning (`width: anchor-size(width); height: anchor-size(height)`).
 * When another tab hides the anchor element, the iframe falls back to HTML's
 * intrinsic 300x150 size. Switching back reveals the overlay before the webview
 * finishes resizing, flashing a stale 300x150 box in the top-left corner and
 * forcing a full double layout across the app.
 *
 * Locking `#root` to the last real viewport size prevents the collapsed
 * relayout, and masking `body` while collapsed keeps any intermediate 300x150
 * compositor frame transparent until the real size arrives.
 */
export function stabilize(win: Target = window, doc: Doc = document, delay = DELAY): () => void {
  const root = doc.getElementById("root")
  const body = doc.body
  if (!root || !body) return () => {}

  let size: { width: number; height: number } | undefined
  let hidden = false
  let timer: ReturnType<Target["setTimeout"]> | undefined

  const clear = () => {
    if (timer === undefined) return
    win.clearTimeout(timer)
    timer = undefined
  }

  const lock = (width: number, height: number) => {
    size = { width, height }
    root.style.width = `${width}px`
    root.style.height = `${height}px`
  }

  const hide = () => {
    if (hidden) return
    hidden = true
    body.style.opacity = "0"
    body.style.backgroundColor = "transparent"
  }

  const show = () => {
    clear()
    if (!hidden) return
    hidden = false
    body.style.opacity = ""
    body.style.backgroundColor = ""
  }

  // Fallback so a genuinely focused 300x150 pane can never remain masked.
  const arm = () => {
    if (timer !== undefined) return
    timer = win.setTimeout(() => {
      timer = undefined
      if (!hidden) return
      if (win.innerWidth > 0 && win.innerHeight > 0) lock(win.innerWidth, win.innerHeight)
      show()
    }, delay)
  }

  const resize = (event: Event) => {
    if (collapsed(win)) {
      event.stopImmediatePropagation()
      hide()
      if (doc.hasFocus()) arm()
      return
    }
    const restored = hidden && size !== undefined && size.width === win.innerWidth && size.height === win.innerHeight
    lock(win.innerWidth, win.innerHeight)
    show()
    if (restored) event.stopImmediatePropagation()
  }

  const focus = () => {
    if (!collapsed(win)) return
    hide()
    arm()
  }

  const blur = () => {
    clear()
  }

  const sync = () => {
    if (collapsed(win)) {
      hide()
      if (doc.hasFocus()) arm()
      return
    }
    lock(win.innerWidth, win.innerHeight)
  }

  sync()
  win.addEventListener("resize", resize, true)
  win.addEventListener("focus", focus)
  win.addEventListener("blur", blur)

  return () => {
    clear()
    win.removeEventListener("resize", resize, true)
    win.removeEventListener("focus", focus)
    win.removeEventListener("blur", blur)
    root.style.width = ""
    root.style.height = ""
    body.style.opacity = ""
    body.style.backgroundColor = ""
  }
}
