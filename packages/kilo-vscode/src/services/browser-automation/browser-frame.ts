import type { BrowserFrame, BrowserViewport } from "../../shared/browser-stream"

export type Pixels = Pick<BrowserFrame, "width" | "height" | "data">
export type Cast = {
  sessionId: number
  data: string
  metadata: { deviceWidth: number; deviceHeight: number; monotonicTimestamp?: number }
}
export type Capture =
  | { port: number; target: string; view: BrowserViewport; direct?: false }
  | { port: number; target: string; direct: true; navigation: number; committed?: number }

export type WorkerCommand =
  | "credit"
  | {
      type: "start"
      view: BrowserViewport
      navigation: number
      committed?: number
      epoch: number
      offscreen?: string
      codec?: number
    }
  | { type: "gate"; navigation: number; committed?: number; epoch: number }
  | { type: "stop"; epoch: number }
  | { type: "close" }

export type CaptureMessage =
  | "ready"
  | Pixels
  | { type: "ready"; url: string }
  | { type: "bound"; epoch: number }
  | { type: "started"; epoch: number }
  | { type: "client"; connected: boolean }
  | { type: "keyframe" }
  | { type: "fallback-jpeg" }

const PAYLOAD = 2 * 1024 * 1024

export function screencast(view: BrowserViewport) {
  return {
    format: "jpeg" as const,
    quality: 90,
    maxWidth: Math.round(view.width * (view.scale ?? 1)),
    maxHeight: Math.round(view.height * (view.scale ?? 1)),
    everyNthFrame: 1,
  }
}

// Chrome encodes JPEGs concurrently. Completion order isn't necessarily presentation order.
// Older browsers without a monotonic capture clock keep arrival order.
export function orderedFrames() {
  let latest = -Infinity
  return (event: Cast, view: BrowserViewport) => {
    const time = event.metadata?.monotonicTimestamp
    if (time !== undefined && time < latest) return
    const frame = decode(event, view)
    if (frame && time !== undefined && Number.isFinite(time)) latest = time
    return frame
  }
}

function decode(event: Cast, view: BrowserViewport): Pixels | undefined {
  if (
    event.metadata?.deviceWidth !== view.width ||
    event.metadata.deviceHeight !== view.height ||
    typeof event.data !== "string" ||
    !event.data.length ||
    event.data.length > Math.ceil(PAYLOAD / 3) * 4
  )
    return
  const length = Buffer.byteLength(event.data, "base64")
  if (length > PAYLOAD) return
  // Both the worker transfer and VS Code's binary IPC need the exact bytes, never Node's shared Buffer pool.
  const data = new ArrayBuffer(length)
  const bytes = Buffer.from(data)
  if (bytes.write(event.data, "base64") !== length) return
  const size = scan(bytes)
  if (!size?.width || !size.height) return
  const scale = view.scale ?? 1
  if (Math.abs(size.width - Math.round(view.width * scale)) > 1) return
  if (Math.abs(size.height - Math.round(view.height * scale)) > 1) return
  return { ...size, data }
}

function scan(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return
  for (let offset = 2; offset + 4 <= data.length; ) {
    const marker = data.readUInt16BE(offset)
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda || marker === 0xffd9) return
    const length = data.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > data.length) return
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      if (length < 8) return
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
    }
    offset += length + 2
  }
}
