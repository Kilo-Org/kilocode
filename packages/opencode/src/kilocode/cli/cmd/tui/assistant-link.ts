import { getLinkId, MouseButton, type CliRenderer, type MouseEvent } from "@opentui/core"
import open from "open"

type Node = {
  id: string
  parent: Node | null
}

type Native = {
  linkGetUrl(id: number): string
}

type Input = {
  renderer: CliRenderer
  event: MouseEvent
  dragged?: boolean
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  launch?: (url: string) => Promise<unknown>
  error?: (err: unknown) => void
}

export namespace AssistantLink {
  export function ghostty(input: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv }) {
    if (input.platform !== "darwin") return false
    if (input.env.TERM_PROGRAM?.toLowerCase() === "ghostty") return true
    return input.env.TERM?.toLowerCase() === "xterm-ghostty"
  }

  export function target(node: Node | null) {
    for (let current = node; current; current = current.parent) {
      if (current.id.startsWith("assistant-text-")) return true
    }
    return false
  }

  export function url(renderer: CliRenderer, x: number, y: number) {
    return httpUrl(nativeUrl(renderer, x, y)) ?? bareUrl(renderer, x, y)
  }

  function isNative(value: unknown): value is Native {
    return (
      typeof value === "object" && value !== null && "linkGetUrl" in value && typeof value.linkGetUrl === "function"
    )
  }

  // OpenTUI only attaches native hyperlink metadata to the URL substring of a
  // `[label](url)` Markdown link; the label text and bare URLs carry none.
  function nativeUrl(renderer: CliRenderer, x: number, y: number): string | undefined {
    const buffer = renderer.currentRenderBuffer
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return undefined

    const id = getLinkId(buffer.buffers.attributes[y * buffer.width + x] ?? 0)
    if (!id) return undefined

    const native = Reflect.get(renderer, "lib")
    if (!isNative(native)) return undefined

    return native.linkGetUrl(id)
  }

  function httpUrl(href: string | undefined): string | undefined {
    if (!href) return undefined
    const parsed = URL.parse(href)
    if (!parsed) return undefined
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
    return href
  }

  const URL_CHAR = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/

  type RenderBuffer = CliRenderer["currentRenderBuffer"]

  function charAt(buffer: RenderBuffer, x: number, y: number) {
    const code = buffer.buffers.char[y * buffer.width + x] ?? 0
    return code ? String.fromCodePoint(code) : " "
  }

  // Word-wrapping leaves blank padding after the last word on a row instead
  // of filling it, so a wrapped run's true row-edge is the first blank cell,
  // not necessarily the buffer's last column.
  function blankToRowEnd(buffer: RenderBuffer, y: number, fromX: number) {
    for (let x = fromX; x < buffer.width; x++) if (charAt(buffer, x, y) !== " ") return false
    return true
  }

  function lastNonBlankCol(buffer: RenderBuffer, y: number) {
    for (let x = buffer.width - 1; x >= 0; x--) if (charAt(buffer, x, y) !== " ") return x
    return -1
  }

  // The assistant-text box is padded and nested inside further padding, so a
  // wrapped paragraph's rows don't start at buffer column 0 in production.
  // Find where this row's own content actually begins instead of assuming it.
  function firstNonBlankCol(buffer: RenderBuffer, y: number) {
    for (let x = 0; x < buffer.width; x++) if (charAt(buffer, x, y) !== " ") return x
    return -1
  }

  function blankBeforeCol(buffer: RenderBuffer, y: number, toX: number) {
    for (let x = 0; x < toX; x++) if (charAt(buffer, x, y) !== " ") return false
    return true
  }

  // Bare HTTP(S) URLs carry no native hyperlink metadata, so a click is
  // resolved by reading the visible characters around it directly. A run of
  // URL-safe characters that reaches a row's trailing blank padding continues
  // onto the next row, reassembling URLs OpenTUI word-wrapped across rows.
  function bareUrl(renderer: CliRenderer, x: number, y: number): string | undefined {
    const buffer = renderer.currentRenderBuffer
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return undefined
    if (!URL_CHAR.test(charAt(buffer, x, y))) return undefined

    let text = charAt(buffer, x, y)

    let cx = x
    let cy = y
    for (;;) {
      if (cx > 0) {
        const ch = charAt(buffer, cx - 1, cy)
        if (URL_CHAR.test(ch)) {
          text = ch + text
          cx--
          continue
        }
      }
      // Reached this row's own left content edge (column 0, or blank padding
      // before it) rather than unrelated text; try continuing into the
      // previous row's wrapped continuation, at whatever column it ends on.
      if (!blankBeforeCol(buffer, cy, cx)) break
      if (cy === 0) break
      const prevRowLastCol = lastNonBlankCol(buffer, cy - 1)
      if (prevRowLastCol < 0) break
      const prevCh = charAt(buffer, prevRowLastCol, cy - 1)
      if (!URL_CHAR.test(prevCh)) break
      cy--
      cx = prevRowLastCol
      text = prevCh + text
    }

    cx = x
    cy = y
    for (;;) {
      if (cx < buffer.width - 1) {
        const ch = charAt(buffer, cx + 1, cy)
        if (URL_CHAR.test(ch)) {
          text += ch
          cx++
          continue
        }
        if (blankToRowEnd(buffer, cy, cx + 1) && cy < buffer.height - 1) {
          const nextRowStart = firstNonBlankCol(buffer, cy + 1)
          if (nextRowStart >= 0 && URL_CHAR.test(charAt(buffer, nextRowStart, cy + 1))) {
            cy++
            cx = nextRowStart
            text += charAt(buffer, nextRowStart, cy)
            continue
          }
        }
        break
      }
      if (cy === buffer.height - 1) break
      const nextRowStart = firstNonBlankCol(buffer, cy + 1)
      if (nextRowStart < 0) break
      const nextCh = charAt(buffer, nextRowStart, cy + 1)
      if (!URL_CHAR.test(nextCh)) break
      cy++
      cx = nextRowStart
      text += nextCh
    }

    const match = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*/)
    if (!match) return undefined
    return httpUrl(trimTrailingPunctuation(match[0]))
  }

  // "(" and ")" are valid URL characters, so a URL enclosed in prose like
  // "(see https://example.com)" scans in with its closing paren attached.
  // Trim trailing punctuation that isn't balanced by an opening counterpart,
  // plus sentence punctuation that's never a real URL's final character.
  function trimTrailingPunctuation(href: string) {
    let url = href
    for (;;) {
      const last = url.at(-1)
      if (!last) break
      if (".,;:!?".includes(last)) {
        url = url.slice(0, -1)
        continue
      }
      const opens: Record<string, string> = { ")": "(", "]": "[", "}": "{" }
      const open = opens[last]
      if (open) {
        const opened = url.split(open).length - 1
        const closed = url.split(last).length - 1
        if (closed > opened) {
          url = url.slice(0, -1)
          continue
        }
      }
      break
    }
    return url
  }

  export function handle(input: Input) {
    if (!ghostty({ platform: input.platform ?? process.platform, env: input.env ?? process.env })) return false
    if (input.event.button !== MouseButton.LEFT) return false
    if (input.dragged) return false
    if (!target(input.event.target)) return false

    const href = url(input.renderer, input.event.x, input.event.y)
    if (!href) return false

    input.event.preventDefault()
    input.event.stopPropagation()
    void (input.launch ?? open)(href).catch((err) => input.error?.(err))
    return true
  }
}
