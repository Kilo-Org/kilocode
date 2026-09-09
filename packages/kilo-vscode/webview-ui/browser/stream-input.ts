import type { BrowserInteraction } from "../../src/shared/browser-stream"

type Bounds = Pick<DOMRect, "left" | "top" | "width" | "height">
type Point = Pick<MouseEvent, "clientX" | "clientY">
type Modifiers = Pick<MouseEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
type Key = Modifiers & Pick<KeyboardEvent, "key" | "code" | "keyCode" | "repeat" | "isComposing" | "getModifierState">

export function modifiers(event: Modifiers) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

export function point(event: Point, bounds: Bounds) {
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0)
    return
  const x = (event.clientX - bounds.left) / bounds.width
  const y = (event.clientY - bounds.top) / bounds.height
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
}

export function transition(event: Pick<PointerEvent, "button" | "buttons">): "down" | "up" | undefined {
  const mask = event.button === 0 ? 1 : event.button === 1 ? 4 : event.button === 2 ? 2 : 0
  if (!mask) return
  return event.buttons & mask ? "down" : "up"
}

export function pointer(
  event: Point & Modifiers & Pick<PointerEvent, "button" | "buttons">,
  bounds: Bounds,
  action: "down" | "up" | "move",
  clicks: number,
): Extract<BrowserInteraction, { kind: "pointer" }> | undefined {
  const position = point(event, bounds)
  if (!position || (action !== "move" && (event.button < 0 || event.button > 2))) return
  const button = event.button < 0 ? (event.buttons & 2 ? 2 : event.buttons & 4 ? 1 : 0) : event.button
  return {
    kind: "pointer",
    action,
    ...position,
    button: button === 1 ? "middle" : button === 2 ? "right" : "left",
    buttons: event.buttons & 7,
    clicks,
    modifiers: modifiers(event),
  }
}

export function wheel(
  event: Point & Modifiers & Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
  bounds: Bounds,
  line = 16,
): Extract<BrowserInteraction, { kind: "wheel" }> | undefined {
  const position = point(event, bounds)
  if (!position) return
  const x = event.deltaMode === 2 ? bounds.width : event.deltaMode === 1 ? line : 1
  const y = event.deltaMode === 2 ? bounds.height : event.deltaMode === 1 ? line : 1
  const dx = event.deltaX * x
  const dy = event.deltaY * y
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
  return {
    kind: "wheel",
    ...position,
    deltaX: Math.max(-10000, Math.min(10000, dx)),
    deltaY: Math.max(-10000, Math.min(10000, dy)),
    modifiers: modifiers(event),
  }
}

export function printable(event: Key) {
  const shortcut = (event.ctrlKey || event.metaKey) && !event.getModifierState("AltGraph")
  return Array.from(event.key).length === 1 && !shortcut
}

export function key(event: Key, action: "down" | "up"): Extract<BrowserInteraction, { kind: "key" }> | undefined {
  if (
    !event.key ||
    event.isComposing ||
    event.keyCode === 229 ||
    ["Dead", "Process", "Unidentified"].includes(event.key)
  )
    return
  return {
    kind: "key",
    action,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    repeat: event.repeat,
    modifiers: modifiers(event),
    text: action === "down" && printable(event) ? event.key : undefined,
  }
}

export function clipboard(event: Pick<Key, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "getModifierState">) {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.getModifierState("AltGraph")) return
  const name = event.key.toLowerCase()
  if (name === "c" || event.code === "KeyC") return "copy"
  if (name === "x" || event.code === "KeyX") return "cut"
  if (name === "v" || event.code === "KeyV") return "paste"
}

export function clicks() {
  let previous:
    | { x: number; y: number; time: number; button: number; count: number; released: boolean; moved: boolean }
    | undefined
  return {
    down(event: Point & Pick<PointerEvent, "timeStamp" | "button">) {
      const consecutive =
        previous &&
        previous.released &&
        !previous.moved &&
        previous.button === event.button &&
        event.timeStamp >= previous.time &&
        event.timeStamp - previous.time <= 500 &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 4
      const count = consecutive && previous ? Math.min(3, previous.count + 1) : 1
      previous = {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        button: event.button,
        count,
        released: false,
        moved: false,
      }
      return count
    },
    move(event: Point) {
      if (previous && !previous.released && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 4) {
        previous.moved = true
      }
    },
    up() {
      if (!previous) return 1
      previous.released = true
      return previous.count
    },
    reset() {
      previous = undefined
    },
  }
}

export function typing() {
  let composing = false
  let committed: string | undefined
  let draft = ""
  const composition = (text: string): BrowserInteraction => ({
    kind: "composition",
    text,
    start: text.length,
    end: text.length,
  })
  return {
    active: () => composing,
    prepare(event: Pick<Key, "isComposing" | "keyCode">) {
      if (!composing && !event.isComposing && event.keyCode !== 229) committed = undefined
    },
    start() {
      composing = true
      committed = undefined
      draft = ""
      return composition("")
    },
    update(text: string) {
      if (!composing || text === draft) return
      draft = text
      return composition(text)
    },
    end(text: string): BrowserInteraction | undefined {
      if (!composing) return
      composing = false
      committed = text || undefined
      draft = ""
      return text ? { kind: "text", text } : composition("")
    },
    input(
      event: Pick<InputEvent, "data" | "inputType" | "isComposing">,
      value: string,
    ): BrowserInteraction | undefined {
      if (composing || event.isComposing) return
      if (event.inputType === "insertFromComposition" || event.inputType === "insertCompositionText") {
        committed = undefined
        return
      }
      if (event.inputType !== "insertText" && event.inputType !== "insertReplacementText") return
      const text = event.data ?? value
      const duplicate = committed !== undefined && committed === text
      committed = undefined
      if (!text || duplicate) return
      return { kind: "text", text }
    },
    reset() {
      const event = composing ? composition("") : undefined
      composing = false
      committed = undefined
      draft = ""
      return event
    },
  }
}
