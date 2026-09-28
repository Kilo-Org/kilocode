import { getLinkId, MouseButton, TextAttributes, type MouseEvent, type OptimizedBuffer } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import open from "open"
import { useToast } from "../ui/toast"

const clickDelay = 250

export type LinkRenderer = {
  root: {
    onMouse: ((event: MouseEvent) => void) | undefined
  }
  getLinkIdAt: (x: number, y: number) => number
  getLinkAt: (x: number, y: number) => string | null
  setMousePointer: (style: "default" | "pointer") => void
  requestRender: () => void
  addPostProcessFn: (fn: (buffer: OptimizedBuffer, deltaTime: number) => void) => void
  removePostProcessFn: (fn: (buffer: OptimizedBuffer, deltaTime: number) => void) => void
  getSelection: () => { getSelectedText: () => string } | null
  clearSelection: () => void
}

export type LinkNotice = (message: string, variant: "warning" | "error") => void
export type LinkOpener = (url: string) => Promise<unknown>

export function isOpenableLink(url: string | null): url is string {
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false

  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function installLinkInteractions(
  renderer: LinkRenderer,
  notice: LinkNotice,
  opener: LinkOpener = open,
  delay = clickDelay,
) {
  let hovered = 0
  let press: { x: number; y: number; id: number; moved: boolean; suppress: boolean } | undefined
  let pending: { x: number; y: number; id: number; timer: ReturnType<typeof setTimeout> } | undefined

  function clearPending() {
    if (!pending) return
    clearTimeout(pending.timer)
    pending = undefined
  }

  function setHovered(id: number) {
    if (id === hovered) return
    hovered = id
    renderer.setMousePointer(id ? "pointer" : "default")
    renderer.requestRender()
  }

  function highlight(buffer: OptimizedBuffer) {
    if (!hovered) return

    const attributes = buffer.buffers.attributes
    for (let index = 0; index < attributes.length; index++) {
      const value = attributes[index]
      if (value !== undefined && getLinkId(value) === hovered) attributes[index] = value | TextAttributes.UNDERLINE
    }
  }

  function openLink(x: number, y: number, id: number) {
    pending = undefined
    if (renderer.getLinkIdAt(x, y) !== id) return

    const url = renderer.getLinkAt(x, y)
    if (!isOpenableLink(url)) {
      renderer.clearSelection()
      notice("Only HTTP(S) links can be opened from the CLI", "warning")
      return
    }

    if (renderer.getSelection()?.getSelectedText()) return
    renderer.clearSelection()
    void opener(url).catch(() => notice("Could not open the link in the default browser", "error"))
  }

  function mouse(event: MouseEvent) {
    if (event.type === "move" || event.type === "over" || event.type === "out" || event.type === "drag") {
      setHovered(renderer.getLinkIdAt(event.x, event.y))
    }

    if (event.type === "scroll") {
      setHovered(0)
      press = undefined
      clearPending()
      return
    }

    if (event.type === "down") {
      if (event.button !== MouseButton.LEFT) return

      const id = renderer.getLinkIdAt(event.x, event.y)
      const double = pending?.id === id && pending.x === event.x && pending.y === event.y
      clearPending()
      press = id
        ? {
            x: event.x,
            y: event.y,
            id,
            moved: false,
            suppress: double,
          }
        : undefined
      return
    }

    if (event.type === "drag") {
      if (press && (event.x !== press.x || event.y !== press.y)) press.moved = true
      return
    }

    if (event.type !== "up" || event.button !== MouseButton.LEFT) return

    const current = press
    press = undefined
    if (!current || current.suppress || current.moved) return
    if (event.x !== current.x || event.y !== current.y) return
    if (event.defaultPrevented) return

    const timer = setTimeout(() => openLink(current.x, current.y, current.id), delay)
    pending = { x: current.x, y: current.y, id: current.id, timer }
    event.preventDefault()
    event.stopPropagation()
  }

  renderer.root.onMouse = mouse
  renderer.addPostProcessFn(highlight)

  return () => {
    clearPending()
    press = undefined
    hovered = 0
    renderer.root.onMouse = undefined
    renderer.removePostProcessFn(highlight)
    renderer.setMousePointer("default")
  }
}

export function useLinkInteractions() {
  const renderer = useRenderer()
  const toast = useToast()
  const dispose = installLinkInteractions(renderer, (message, variant) => toast.show({ message, variant }))
  onCleanup(dispose)
}
