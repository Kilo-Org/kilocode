import { imageInfo } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"

const MAX_COLS = 72
const MAX_ROWS = 24
const MIN_COLS = 12
const GUTTER = 6

type Protocol = "auto" | "kitty" | "sixel" | "blocks"

// Kilo image protocol override. "auto" uses terminal capability detection and
// never falls back to the low-fidelity half-block renderer unless asked to.
export function imageProtocol(): Protocol {
  const value = process.env.KILO_IMAGE_PROTOCOL?.toLowerCase()
  if (value === "kitty" || value === "sixel" || value === "blocks") return value
  return "auto"
}

export function isImageMime(mime: string | undefined) {
  return mime != null && mime.startsWith("image/") && mime !== "image/svg+xml"
}

export function isRenderableImageUrl(url: string | undefined) {
  if (url == null) return false
  if (url.startsWith("file://")) return true
  return url.startsWith("data:") && url.includes(";base64,")
}

function decode(url: string) {
  if (url.startsWith("file://")) {
    try {
      return new Uint8Array(readFileSync(fileURLToPath(url)))
    } catch {
      return undefined
    }
  }
  const marker = ";base64,"
  const index = url.indexOf(marker)
  if (index === -1) return undefined
  const payload = url.slice(index + marker.length)
  if (!payload) return undefined
  try {
    return Uint8Array.from(Buffer.from(payload, "base64"))
  } catch {
    return undefined
  }
}

function fallbackAspect(renderer: { resolution: { width: number; height: number } | null; terminalWidth: number; terminalHeight: number }) {
  const resolution = renderer.resolution
  if (resolution && resolution.width > 0 && resolution.height > 0 && renderer.terminalWidth > 0 && renderer.terminalHeight > 0)
    return resolution.height / renderer.terminalHeight / (resolution.width / renderer.terminalWidth)
  return 2
}

export function ImageAttachment(props: {
  url: string
  mime?: string
  filename?: string
  maxCols?: number
  maxRows?: number
  paddingLeft?: number
}) {
  const renderer = useRenderer()
  const dims = useTerminalDimensions()
  const [caps, setCaps] = createSignal(renderer.capabilities)
  const [resolution, setResolution] = createSignal(renderer.resolution)

  const sync = () => {
    setCaps(renderer.capabilities)
    setResolution(renderer.resolution)
  }
  renderer.on("capabilities", sync)
  onCleanup(() => renderer.off("capabilities", sync))

  // Resolve the drawable protocol. Auto-detection never selects the half-block
  // renderer, so unsupported terminals get a text placeholder instead of a
  // low-resolution fake image.
  const mode = createMemo((): Protocol | null => {
    const override = imageProtocol()
    if (override !== "auto") return override
    const value = caps()
    if (!value) return null
    if (value.multiplexer === "tmux" || value.multiplexer === "screen") return null
    if (value.kitty_graphics) return "kitty"
    if (value.sixel && resolution()) return "sixel"
    return null
  })

  const size = createMemo(() => {
    const bytes = decode(props.url)
    if (!bytes) return undefined
    let meta
    try {
      meta = imageInfo(bytes)
    } catch {
      return undefined
    }
    if (!meta.width || !meta.height) return undefined
    const aspect = fallbackAspect(renderer)
    const available = Math.max(MIN_COLS, Math.min(props.maxCols ?? MAX_COLS, dims().width - GUTTER))
    let cols = available
    let rows = cols * (meta.height / meta.width) / aspect
    const maxRows = props.maxRows ?? MAX_ROWS
    if (rows > maxRows) {
      rows = maxRows
      cols = rows * aspect * (meta.width / meta.height)
    }
    return {
      bytes,
      width: meta.width,
      height: meta.height,
      cols: Math.max(1, Math.round(cols)),
      rows: Math.max(1, Math.round(rows)),
    }
  })

  const placeholder = (value: { width: number; height: number }) => {
    const label = props.filename ?? props.mime ?? "image"
    return `[Image: ${label} ${value.width}x${value.height}]`
  }

  return (
    <Show when={size()}>
      {(value) => (
        <box flexDirection="column" paddingLeft={props.paddingLeft ?? 0}>
          <Show when={mode()} fallback={<text fg="#888888">{placeholder(value())}</text>}>
            <image source={value().bytes} fit="fit" protocol={mode()!} width={value().cols} height={value().rows} />
          </Show>
          <Show when={props.filename && mode()}>
            <text fg="#888888">{props.filename}</text>
          </Show>
        </box>
      )}
    </Show>
  )
}
