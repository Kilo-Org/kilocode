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
  data: ArrayBuffer
}

export interface BrowserCursor extends BrowserViewIdentity {
  cursor: string
}

export interface BrowserStateFields {
  browserId: string
  projectId?: string
  sessionId: string
  navigation?: number
  status: "starting" | "ready" | "loading" | "error" | "closed"
  inspecting?: boolean
  url?: string
  title?: string
  errors: number
  logs?: string[]
  error?: string
  missing?: "chrome" | "chromium"
  frameError?: string
  back?: boolean
  forward?: boolean
  streamUrl?: string
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

export function sameWheel(current: WheelInteraction, next: WheelInteraction): boolean {
  return (
    current.x === next.x &&
    current.y === next.y &&
    current.modifiers === next.modifiers &&
    Math.sign(current.deltaX) === Math.sign(next.deltaX) &&
    Math.sign(current.deltaY) === Math.sign(next.deltaY)
  )
}

// Coordinates, modifiers, axis direction and the limit on a single delta are ordering barriers.
export function mergeWheel(current: WheelInteraction, next: WheelInteraction): boolean {
  if (!sameWheel(current, next)) return false
  if (Math.abs(current.deltaX + next.deltaX) > 10000 || Math.abs(current.deltaY + next.deltaY) > 10000) return false
  current.deltaX += next.deltaX
  current.deltaY += next.deltaY
  return true
}

export const STREAM_HEADER = 32
export const STREAM_INPUT_BYTES = 32
export const STREAM_FRAME_H264_KEY = 1
export const STREAM_FRAME_H264_DELTA = 2
export const STREAM_FRAME_JPEG = 3
export const STREAM_INPUT_WHEEL = 1
export const STREAM_INPUT_FALLBACK_JPEG = 2
export const STREAM_INPUT_KEYFRAME = 3

export const STREAM_CODECS = ["jpeg", "avc1.640033", "avc1.640028", "avc1.42e033"] as const

export interface StreamPacketMeta {
  kind: 1 | 2 | 3
  codec: number
  width: number
  height: number
  navigation: number
  revision: number
  sequence: number
  timestamp: number
}

export interface StreamPacket extends StreamPacketMeta {
  data: Uint8Array<ArrayBuffer>
}

export type StreamInputPacket =
  | {
      kind: 1
      navigation: number
      revision: number
      x: number
      y: number
      deltaX: number
      deltaY: number
      modifiers: number
    }
  | { kind: 2 | 3; navigation: number; revision: number }

export function encodeStreamFrame(meta: StreamPacketMeta, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(STREAM_HEADER + payload.byteLength)
  const view = new DataView(out.buffer)
  view.setUint8(0, meta.kind)
  view.setUint8(1, meta.codec)
  view.setUint16(2, meta.width)
  view.setUint16(4, meta.height)
  view.setUint32(8, meta.navigation)
  view.setUint32(12, meta.sequence)
  view.setFloat64(16, meta.revision)
  view.setFloat64(24, meta.timestamp)
  out.set(payload, STREAM_HEADER)
  return out
}

export function decodeStreamFrame(buffer: ArrayBuffer): StreamPacket | undefined {
  if (buffer.byteLength <= STREAM_HEADER || buffer.byteLength > STREAM_HEADER + 2 * 1024 * 1024) return
  const view = new DataView(buffer)
  const kind = view.getUint8(0)
  if (kind !== STREAM_FRAME_H264_KEY && kind !== STREAM_FRAME_H264_DELTA && kind !== STREAM_FRAME_JPEG) return
  const codec = view.getUint8(1)
  const width = view.getUint16(2)
  const height = view.getUint16(4)
  const navigation = view.getUint32(8)
  const sequence = view.getUint32(12)
  const revision = view.getFloat64(16)
  const timestamp = view.getFloat64(24)
  if (width <= 0 || height <= 0 || !Number.isSafeInteger(revision) || !Number.isFinite(timestamp)) return
  return { kind, codec, width, height, navigation, revision, sequence, timestamp, data: new Uint8Array(buffer, STREAM_HEADER) }
}

export function encodeStreamWheel(input: {
  navigation: number
  revision: number
  x: number
  y: number
  deltaX: number
  deltaY: number
  modifiers: number
}): ArrayBuffer {
  const buffer = new ArrayBuffer(STREAM_INPUT_BYTES)
  const view = new DataView(buffer)
  view.setUint8(0, STREAM_INPUT_WHEEL)
  view.setUint8(1, input.modifiers & 0xff)
  view.setUint32(4, input.navigation)
  view.setFloat64(8, input.revision)
  view.setFloat32(16, input.x)
  view.setFloat32(20, input.y)
  view.setFloat32(24, input.deltaX)
  view.setFloat32(28, input.deltaY)
  return buffer
}

export function encodeStreamControl(kind: 2 | 3, navigation: number, revision: number): ArrayBuffer {
  const buffer = new ArrayBuffer(STREAM_INPUT_BYTES)
  const view = new DataView(buffer)
  view.setUint8(0, kind)
  view.setUint32(4, navigation)
  view.setFloat64(8, revision)
  return buffer
}

export function decodeStreamInput(raw: Uint8Array): StreamInputPacket | undefined {
  if (raw.byteLength !== STREAM_INPUT_BYTES) return
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const kind = view.getUint8(0)
  const navigation = view.getUint32(4)
  const revision = view.getFloat64(8)
  if (!Number.isSafeInteger(revision) || revision < 0) return
  if (kind === STREAM_INPUT_FALLBACK_JPEG || kind === STREAM_INPUT_KEYFRAME) return { kind, navigation, revision }
  if (kind !== STREAM_INPUT_WHEEL) return
  const modifiers = view.getUint8(1)
  const x = view.getFloat32(16)
  const y = view.getFloat32(20)
  const deltaX = view.getFloat32(24)
  const deltaY = view.getFloat32(28)
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1 ||
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    Math.abs(deltaX) > 10000 ||
    Math.abs(deltaY) > 10000 ||
    modifiers > 15
  ) {
    return
  }
  return { kind: STREAM_INPUT_WHEEL, navigation, revision, x, y, deltaX, deltaY, modifiers }
}
