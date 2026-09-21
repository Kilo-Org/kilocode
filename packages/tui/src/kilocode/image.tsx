import { imageInfo, type TerminalCapabilities } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { Part } from "@kilocode/sdk/v2"
import { readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"

const MAX_COLS = 72
const MAX_ROWS = 24
const GUTTER = 6
const MAX_FILE_BYTES = 20 * 1024 * 1024

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

// Pure platform/terminal capability matrix, separated so it can be tested
// without a renderer. Auto-detection never selects the low-fidelity half-block
// renderer; unsupported terminals get a text placeholder instead.
export function imageMode(
  caps: TerminalCapabilities | null,
  hasResolution: boolean,
  requested: Protocol = imageProtocol(),
): Protocol | null {
  if (requested !== "auto") return requested
  if (!caps) return null
  if (caps.multiplexer === "tmux" || caps.multiplexer === "screen") return null
  if (caps.kitty_graphics) return "kitty"
  if (caps.sixel && hasResolution) return "sixel"
  return null
}

function decode(url: string) {
  if (url.startsWith("file://")) {
    try {
      const path = fileURLToPath(url)
      const stat = statSync(path)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined
      return new Uint8Array(readFileSync(path))
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

  const sync = (value: TerminalCapabilities) => setCaps(value)
  renderer.on("capabilities", sync)
  onCleanup(() => renderer.off("capabilities", sync))

  // Resolve the drawable protocol. Auto-detection never selects the half-block
  // renderer, so unsupported terminals get a text placeholder instead of a
  // low-resolution fake image.
  const mode = createMemo(() => {
    dims().width // re-resolve after a resize, when pixel resolution may arrive
    return imageMode(caps(), Boolean(renderer.resolution))
  })

  // Decode once per source URL. Resizes must not re-read the payload.
  const data = createMemo(() => {
    const bytes = decode(props.url)
    if (!bytes) return undefined
    try {
      const meta = imageInfo(bytes)
      if (!meta.width || !meta.height) return undefined
      return { bytes, width: meta.width, height: meta.height }
    } catch {
      return undefined
    }
  })

  const size = createMemo(() => {
    const value = data()
    if (!value) return undefined
    const aspect = fallbackAspect(renderer)
    const available = Math.max(1, Math.min(props.maxCols ?? MAX_COLS, dims().width - GUTTER))
    let cols = available
    let rows = cols * (value.height / value.width) / aspect
    const maxRows = props.maxRows ?? MAX_ROWS
    if (rows > maxRows) {
      rows = maxRows
      cols = rows * aspect * (value.width / value.height)
    }
    return {
      ...value,
      cols: Math.max(1, Math.round(cols)),
      rows: Math.max(1, Math.round(rows)),
    }
  })

  const label = () => props.filename ?? props.mime ?? "image"

  const caption = (cols: number) => {
    const name = props.filename ?? ""
    const max = Math.max(1, cols)
    if (name.length <= max) return name
    return `${name.slice(0, Math.max(1, max - 3))}...`
  }

  return (
    <Show when={data()} fallback={<text fg="#888888">{`[Image: ${label()}]`}</text>}>
      <Show when={size()}>
        {(value) => (
          <box flexDirection="column" paddingLeft={props.paddingLeft ?? 0}>
            <Show
              when={mode()}
              fallback={<text fg="#888888">{`[Image: ${label()} ${value().width}x${value().height}]`}</text>}
            >
              <image source={value().bytes} fit="fit" protocol={mode()!} width={value().cols} height={value().rows} />
            </Show>
            <Show when={props.filename && mode()}>
              <text fg="#888888">{caption(value().cols)}</text>
            </Show>
          </box>
        )}
      </Show>
    </Show>
  )
}

export type AttachmentLike = {
  type?: string
  mime?: string
  url?: string
  filename?: string
}

export function imageAttachments<T extends AttachmentLike>(parts: readonly T[]) {
  return parts.filter(
    (x): x is T & { url: string } =>
      x.type === "file" && isImageMime(x.mime) && isRenderableImageUrl(x.url),
  )
}

export function toolImages(part: Part) {
  if (part.type !== "tool") return []
  if (part.state.status !== "completed") return []
  return imageAttachments(part.state.attachments ?? [])
}

export function ImageList(props: {
  parts: readonly AttachmentLike[]
  direction?: "row" | "column"
  gap?: number
  paddingTop?: number
  paddingBottom?: number
  paddingLeft?: number
  marginTop?: number
  maxCols?: number
  maxRows?: number
}) {
  const images = createMemo(() => imageAttachments(props.parts))
  return (
    <Show when={images().length}>
      <box
        flexDirection={props.direction ?? "column"}
        flexWrap={props.direction === "row" ? "wrap" : undefined}
        gap={props.gap ?? 1}
        paddingTop={props.paddingTop ?? 0}
        paddingBottom={props.paddingBottom ?? 0}
        paddingLeft={props.paddingLeft ?? 0}
        marginTop={props.marginTop ?? 0}
      >
        <For each={images()}>
          {(file) => (
            <ImageAttachment
              url={file.url}
              mime={file.mime}
              filename={file.filename}
              maxCols={props.maxCols}
              maxRows={props.maxRows}
            />
          )}
        </For>
      </box>
    </Show>
  )
}
