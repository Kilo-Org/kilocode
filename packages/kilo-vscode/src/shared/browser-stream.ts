export function source(data: string): string | undefined {
  if (!data.startsWith("data:")) return `data:image/jpeg;base64,${data}`
  return /^data:image\/(?:jpeg|png|webp);base64,/.test(data) ? data : undefined
}

export interface BrowserViewIdentity {
  browserId: string
  navigation: number
  revision: number
}

export interface BrowserViewport {
  width: number
  height: number
  scale?: number
  revision: number
  active: boolean
}

export interface BrowserFrame extends BrowserViewIdentity {
  sequence: number
  width: number
  height: number
  data: string
}

export interface BrowserCursor extends BrowserViewIdentity {
  cursor: string
}

// Only CSS keywords can cross the browser boundary, never page-provided cursor images or URLs.
export const CURSORS = new Set([
  "default",
  "none",
  "context-menu",
  "help",
  "pointer",
  "progress",
  "wait",
  "cell",
  "crosshair",
  "text",
  "vertical-text",
  "alias",
  "copy",
  "move",
  "no-drop",
  "not-allowed",
  "grab",
  "grabbing",
  "all-scroll",
  "col-resize",
  "row-resize",
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
  "ne-resize",
  "nw-resize",
  "se-resize",
  "sw-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "zoom-in",
  "zoom-out",
])

export type BrowserInteraction =
  | {
      kind: "pointer"
      action: "move" | "down" | "up"
      x: number
      y: number
      button: "left" | "middle" | "right"
      buttons: number
      clicks: number
      modifiers: number
    }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | {
      kind: "key"
      action: "down" | "up"
      key: string
      code: string
      keyCode: number
      modifiers: number
      repeat: boolean
      text?: string
    }
  | { kind: "text"; text: string }
  | { kind: "composition"; text: string; start: number; end: number }
  | { kind: "clipboard"; action: "copy" | "cut" | "paste" }
  | { kind: "release" }

export type WheelInteraction = Extract<BrowserInteraction, { kind: "wheel" }>

// The host clamps the streamed page to these bounds. The viewport the webview publishes must use the same bounds, so
// the frame and the canvas size stay equal and the preview is never scaled back up.
export const VIEWPORT_LIMIT = { width: 4096, height: 2160 } as const

// Coalesces compatible wheel input in place. Coordinates, modifiers, axis direction, and the 10000 cap are
// ordering barriers, so callers can keep batching while preserving scroll distance and reversals.
export function mergeWheel(current: WheelInteraction, next: WheelInteraction): boolean {
  if (current.x !== next.x || current.y !== next.y || current.modifiers !== next.modifiers) return false
  for (const axis of ["deltaX", "deltaY"] as const) {
    if (Math.sign(current[axis]) !== Math.sign(next[axis])) return false
    if (Math.abs(current[axis] + next[axis]) > 10000) return false
  }
  current.deltaX += next.deltaX
  current.deltaY += next.deltaY
  return true
}
