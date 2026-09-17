import { createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import type { MermaidLabels } from "./markdown-mermaid"
import { clampZoom, zoomBy, zoomLabel } from "./markdown-mermaid-zoom-state"

type Props = {
  // Sanitized SVG markup for the already-rendered diagram.
  svg: () => string
  labels: MermaidLabels
  onClose: () => void
}

function Icon(props: { children: JSX.Element }) {
  return (
    <span data-slot="markdown-mermaid-zoom-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        {props.children}
      </svg>
    </span>
  )
}

function ZoomOutIcon() {
  return (
    <Icon>
      <circle cx="7.25" cy="7.25" r="4.25" stroke="currentColor" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-linecap="round" />
      <path d="M5.25 7.25H9.25" stroke="currentColor" stroke-linecap="round" />
    </Icon>
  )
}

function ZoomInIcon() {
  return (
    <Icon>
      <circle cx="7.25" cy="7.25" r="4.25" stroke="currentColor" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-linecap="round" />
      <path d="M5.25 7.25H9.25M7.25 5.25V9.25" stroke="currentColor" stroke-linecap="round" />
    </Icon>
  )
}

function ResetIcon() {
  return (
    <Icon>
      <path d="M12.5 8A4.5 4.5 0 1 1 8 3.5" stroke="currentColor" stroke-linecap="round" />
      <path d="M11.75 1.75V4H9.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
    </Icon>
  )
}

function CloseIcon() {
  return (
    <Icon>
      <path d="M4.25 4.25L11.75 11.75M11.75 4.25L4.25 11.75" stroke="currentColor" stroke-linecap="round" />
    </Icon>
  )
}

export function MermaidZoom(props: Props) {
  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [dragging, setDragging] = createSignal(false)
  const drag = { x: 0, y: 0, panX: 0, panY: 0 }

  const zoomTo = (value: number) => setZoom(clampZoom(value))
  const reset = () => {
    zoomTo(1)
    setPan({ x: 0, y: 0 })
  }

  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    zoomTo(zoomBy(zoom(), event.deltaY))
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key === "Tab") {
      const items = Array.from(panel?.querySelectorAll<HTMLElement>("button") ?? [])
      const first = items.at(0)
      const last = items.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault()
      zoomTo(zoomBy(zoom(), -1))
      return
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault()
      zoomTo(zoomBy(zoom(), 1))
      return
    }
    if (event.key === "0") {
      event.preventDefault()
      reset()
    }
  }

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    setDragging(true)
    drag.x = event.clientX
    drag.y = event.clientY
    drag.panX = pan().x
    drag.panY = pan().y
    viewport?.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent) => {
    if (!dragging()) return
    if (event.buttons === 0) {
      setDragging(false)
      return
    }
    setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y })
  }

  const up = (event: PointerEvent) => {
    if (!dragging()) return
    setDragging(false)
    if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
  }

  let panel: HTMLDivElement | undefined
  let viewport: HTMLDivElement | undefined
  let canvas: HTMLDivElement | undefined
  let restore: Element | null = null
  onMount(() => {
    restore = document.activeElement
    // Listen on the document so Escape keeps working even if focus leaves the panel.
    document.addEventListener("keydown", keydown)
    // Insert the sanitized SVG once. Pan and zoom only update the transform, so
    // the diagram is never re-serialized or re-parsed on pointer or wheel frames.
    if (canvas) canvas.innerHTML = props.svg()
    panel?.focus()
  })
  onCleanup(() => {
    document.removeEventListener("keydown", keydown)
    if (restore instanceof HTMLElement) restore.focus()
  })

  return (
    <Portal>
      <div
        data-component="markdown-mermaid-zoom"
        role="dialog"
        aria-modal="true"
        aria-label={props.labels.zoom}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <div data-slot="markdown-mermaid-zoom-panel" tabIndex={-1} ref={panel}>
          <div data-slot="markdown-mermaid-zoom-header">
            <span data-slot="markdown-mermaid-zoom-title">{props.labels.zoom}</span>
            <button
              type="button"
              data-slot="markdown-mermaid-zoom-close"
              title={props.labels.close}
              aria-label={props.labels.close}
              onClick={props.onClose}
            >
              <CloseIcon />
            </button>
          </div>
          <div
            data-slot="markdown-mermaid-zoom-viewport"
            data-dragging={dragging() ? "" : undefined}
            ref={viewport}
            onWheel={wheel}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={() => setDragging(false)}
          >
            <div
              data-slot="markdown-mermaid-zoom-canvas"
              ref={canvas}
              style={{ transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})` }}
            />
          </div>
          <div data-slot="markdown-mermaid-zoom-footer">
            <button
              type="button"
              data-slot="markdown-mermaid-zoom-button"
              title={props.labels.zoomOut}
              aria-label={props.labels.zoomOut}
              onClick={() => zoomTo(zoomBy(zoom(), 1))}
            >
              <ZoomOutIcon />
            </button>
            <span data-slot="markdown-mermaid-zoom-percent">{zoomLabel(zoom())}</span>
            <button
              type="button"
              data-slot="markdown-mermaid-zoom-button"
              title={props.labels.zoomIn}
              aria-label={props.labels.zoomIn}
              onClick={() => zoomTo(zoomBy(zoom(), -1))}
            >
              <ZoomInIcon />
            </button>
            <button
              type="button"
              data-slot="markdown-mermaid-zoom-button"
              title={props.labels.zoomReset}
              aria-label={props.labels.zoomReset}
              onClick={reset}
            >
              <ResetIcon />
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
