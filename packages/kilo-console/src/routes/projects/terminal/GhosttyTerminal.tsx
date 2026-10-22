import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { CellFlags, FitAddon, init, Terminal, type GhosttyCell } from "ghostty-web"
import { ptyWsUrl, resizeProjectPty, type Query } from "../../../client"

let boot: Promise<void> | undefined

function ready() {
  boot ??= init()
  return boot
}

function css(el: Element, name: string, fallback: string) {
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

function px(el: Element, name: string, fallback: number) {
  const value = css(el, name, "")
  const size = Number.parseFloat(value)
  if (!Number.isFinite(size) || size <= 0) return fallback
  if (value.endsWith("rem") || value.endsWith("em")) {
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return Number.isFinite(root) ? size * root : fallback
  }
  return size
}

function theme(el: Element) {
  const background = css(el, "--project-terminal-background", "#0f1015")
  return {
    background,
    foreground: css(el, "--foreground", "#d4d4d8"),
    cursor: css(el, "--foreground", "#d4d4d8"),
    selectionBackground: css(el, "--accent", "#334155"),
    black: "#0f1015",
    red: "#f87171",
    green: "#34d399",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#e5e7eb",
    brightBlack: "#71717a",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde68a",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#fafafa",
  }
}

type View = {
  ctx: CanvasRenderingContext2D
  devicePixelRatio: number
  metrics: { width: number; height: number }
  theme: { selectionForeground: string }
  renderCellText: (cell: GhosttyCell, x: number, y: number, over?: string) => void
  rgbToCSS: (r: number, g: number, b: number) => string
  isInSelection: (x: number, y: number) => boolean
}

function rect(view: View, x: number, y: number, w: number, h: number) {
  const ratio = view.devicePixelRatio || window.devicePixelRatio || 1
  const left = Math.floor(x * ratio) / ratio
  const top = Math.floor(y * ratio) / ratio
  const right = Math.ceil((x + w) * ratio) / ratio
  const bottom = Math.ceil((y + h) * ratio) / ratio
  view.ctx.fillRect(left, top, right - left, bottom - top)
}

function sextant(view: View, mask: number, x: number, y: number, w: number, h: number) {
  const sw = w / 2
  const sh = h / 3

  for (const n of [1, 2, 3, 4, 5, 6]) {
    if (!(mask & (1 << (n - 1)))) continue
    const dx = n % 2 === 1 ? 0 : sw
    const dy = Math.floor((n - 1) / 2) * sh
    rect(view, x + dx, y + dy, sw, sh)
  }
}

function fill(view: View, cp: number, x: number, y: number, w: number, h: number) {
  const ew = w / 8
  const eh = h / 8
  const hw = w / 2
  const hh = h / 2

  if (cp === 0x1fb01) {
    sextant(view, 0b000010, x, y, w, h)
    return true
  }

  if (cp === 0x1fb0f) {
    sextant(view, 0b010000, x, y, w, h)
    return true
  }

  if (cp === 0x1fb2c) {
    sextant(view, 0b101111, x, y, w, h)
    return true
  }

  if (cp === 0x1fb3a) {
    sextant(view, 0b111101, x, y, w, h)
    return true
  }

  if (cp >= 0x2581 && cp <= 0x2587) {
    const n = cp - 0x2580
    rect(view, x, y + h - eh * n, w, eh * n)
    return true
  }

  if (cp >= 0x2589 && cp <= 0x258f) {
    const n = 8 - (cp - 0x2588)
    rect(view, x, y, ew * n, h)
    return true
  }

  if (cp === 0x2580) {
    rect(view, x, y, w, hh)
    return true
  }

  if (cp === 0x2588) {
    rect(view, x, y, w, h)
    return true
  }

  if (cp === 0x2590) {
    rect(view, x + hw, y, hw, h)
    return true
  }

  if (cp === 0x2594) {
    rect(view, x, y, w, eh)
    return true
  }

  if (cp === 0x2595) {
    rect(view, x + w - ew, y, ew, h)
    return true
  }

  if (cp === 0x2596) {
    rect(view, x, y + hh, hw, hh)
    return true
  }

  if (cp === 0x2597) {
    rect(view, x + hw, y + hh, hw, hh)
    return true
  }

  if (cp === 0x2598) {
    rect(view, x, y, hw, hh)
    return true
  }

  if (cp === 0x2599) {
    rect(view, x, y, hw, h)
    rect(view, x + hw, y + hh, hw, hh)
    return true
  }

  if (cp === 0x259a) {
    rect(view, x, y, hw, hh)
    rect(view, x + hw, y + hh, hw, hh)
    return true
  }

  if (cp === 0x259b) {
    rect(view, x, y, w, hh)
    rect(view, x, y + hh, hw, hh)
    return true
  }

  if (cp === 0x259c) {
    rect(view, x, y, w, hh)
    rect(view, x + hw, y + hh, hw, hh)
    return true
  }

  if (cp === 0x259d) {
    rect(view, x + hw, y, hw, hh)
    return true
  }

  if (cp === 0x259e) {
    rect(view, x + hw, y, hw, hh)
    rect(view, x, y + hh, hw, hh)
    return true
  }

  if (cp === 0x259f) {
    rect(view, x + hw, y, hw, h)
    rect(view, x, y + hh, hw, hh)
    return true
  }

  return false
}

function color(view: View, cell: GhosttyCell, x: number, y: number, over?: string) {
  if (over) return over
  if (view.isInSelection(x, y)) return view.theme.selectionForeground
  if (cell.flags & CellFlags.INVERSE) return view.rgbToCSS(cell.bg_r, cell.bg_g, cell.bg_b)
  return view.rgbToCSS(cell.fg_r, cell.fg_g, cell.fg_b)
}

function patch(renderer: Terminal["renderer"]) {
  if (!renderer) return
  const view = renderer as unknown as View
  const original = view.renderCellText.bind(renderer)

  view.renderCellText = (cell, x, y, over) => {
    if (
      !(cell.flags & CellFlags.INVISIBLE) &&
      ((cell.codepoint >= 0x2580 && cell.codepoint <= 0x259f) ||
        cell.codepoint === 0x1fb01 ||
        cell.codepoint === 0x1fb0f ||
        cell.codepoint === 0x1fb2c ||
        cell.codepoint === 0x1fb3a)
    ) {
      const w = view.metrics.width * cell.width
      const h = view.metrics.height
      view.ctx.fillStyle = color(view, cell, x, y, over)
      if (cell.flags & CellFlags.FAINT) view.ctx.globalAlpha = 0.5
      const drawn = fill(view, cell.codepoint, x * view.metrics.width, y * h, w, h)
      if (cell.flags & CellFlags.FAINT) view.ctx.globalAlpha = 1
      if (drawn) return
    }

    original(cell, x, y, over)
  }
}

export function GhosttyTerminal(props: { query: Query; pty: string; active?: boolean; onExit?: () => void }) {
  let host!: HTMLDivElement
  let term: Terminal | undefined
  let fit: FitAddon | undefined
  const [failure, setFailure] = createSignal<string | undefined>()
  const [shown, setShown] = createSignal(false)

  createEffect(() => {
    if (!props.active || !shown()) return
    requestAnimationFrame(() => {
      fit?.fit()
      term?.focus()
    })
  })

  onMount(() => {
    let disposed = false
    let ws: WebSocket | undefined
    let data: { dispose: () => void } | undefined
    let size: { dispose: () => void } | undefined
    let replay = false

    const done = (input: Uint8Array) => {
      if (input[0] !== 0) return false
      replay = true
      requestAnimationFrame(() => {
        if (!disposed) setShown(true)
      })
      return true
    }

    const run = async () => {
      host.replaceChildren()
      await ready()
      if (disposed) return

      term = new Terminal({
        cols: 100,
        rows: 30,
        cursorBlink: true,
        fontFamily:
          "'FiraCode Nerd Font', 'FiraCode Nerd Font Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
        fontSize: Math.max(14, px(host, "--font-size-base", 14)),
        scrollback: 5000,
        theme: theme(host),
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      host.replaceChildren()
      term.open(host)
      patch(term.renderer)
      term.reset()
      term.clear()
      data = term.onData((input) => {
        if (replay && ws?.readyState === WebSocket.OPEN) ws.send(input)
      })
      size = term.onResize((next) => {
        void resizeProjectPty(props.query, props.pty, next.cols, next.rows).catch((err) =>
          console.warn("Terminal resize failed", err),
        )
      })
      fit.fit()
      fit.observeResize()
      requestAnimationFrame(() => {
        fit?.fit()
        if (props.active) term?.focus()
      })

      ws = new WebSocket(ptyWsUrl(props.query, props.pty))
      ws.binaryType = "arraybuffer"
      ws.onmessage = (event) => {
        if (disposed || !term) return
        if (typeof event.data === "string") {
          term.write(event.data)
          return
        }
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          if (done(bytes)) return
          term.write(bytes)
          return
        }
        if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buffer) => {
            if (disposed || !term) return
            const bytes = new Uint8Array(buffer)
            if (done(bytes)) return
            term.write(bytes)
          })
        }
      }
      ws.onerror = () => setFailure("Terminal WebSocket connection failed")
      ws.onclose = () => {
        if (disposed) return
        setFailure("Terminal disconnected")
        props.onExit?.()
      }
    }

    void run().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      setFailure(msg)
    })

    onCleanup(() => {
      disposed = true
      data?.dispose()
      size?.dispose()
      fit?.dispose()
      ws?.close()
      term?.dispose()
      host.replaceChildren()
      fit = undefined
      term = undefined
    })
  })

  return (
    <div class="project-terminal" classList={{ shown: shown() }}>
      <div ref={host} class="project-terminal-host" />
      <Show when={failure()}>{(msg) => <div class="project-terminal-error">{msg()}</div>}</Show>
    </div>
  )
}
