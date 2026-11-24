/**
 * Streaming VT OSC sequence scanner for Agent Manager terminals.
 *
 * libghostty's WASM wrapper handles screen rendering and VT state, while host
 * integrations need three OSC hooks:
 * - OSC 0 / 2: window title changes (handles both text and binary PTY frames)
 * - OSC 52: clipboard writes (e.g., tmux / neovim)
 * - OSC 777: Kilo CLI terminal activity signals
 */

export interface OscHandlers {
  onTitle?: (title: string) => void
  onClipboard?: (text: string) => void
  onOsc777?: (data: string) => void
}

type State = "ground" | "esc" | "code" | "payload" | "payloadEsc" | "ignore" | "ignoreEsc"

const HANDLED_CODES = new Set([0, 2, 52, 777])
const MAX_SMALL_PAYLOAD = 4_096
const MAX_CLIPBOARD_PAYLOAD = 1_048_576
const MAX_CODE_DIGITS = 8

function decodeBase64Utf8(raw: string): string | undefined {
  const compact = raw.replace(/[\t\n\r ]+/g, "")
  if (compact.length === 0) return undefined
  try {
    const binary = atob(compact)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  } catch {
    return undefined
  }
}

function parseOsc52(payload: string): string | undefined {
  const sep = payload.indexOf(";")
  if (sep < 0) return undefined
  const encoded = payload.slice(sep + 1)
  // Never answer clipboard read queries (`?`) from untrusted PTY output.
  if (encoded === "?" || encoded.length === 0) return undefined
  return decodeBase64Utf8(encoded)
}

function maxLengthFor(code: number): number {
  return code === 52 ? MAX_CLIPBOARD_PAYLOAD : MAX_SMALL_PAYLOAD
}

export function createOscScanner(handlers: OscHandlers) {
  const decoder = new TextDecoder("utf-8", { fatal: false })
  let state: State = "ground"
  let codeText = ""
  let code = -1
  let payload = ""
  let oversized = false
  let lastTitle: string | undefined
  let streamingBytes = false

  const reset = () => {
    state = "ground"
    codeText = ""
    code = -1
    payload = ""
    oversized = false
  }

  const dispatch = () => {
    const currentCode = code
    const currentPayload = payload
    const tooLarge = oversized
    reset()
    if (tooLarge) return
    if (currentCode === 0 || currentCode === 2) {
      if (currentPayload !== lastTitle) {
        lastTitle = currentPayload
        handlers.onTitle?.(currentPayload)
      }
      return
    }
    if (currentCode === 777) {
      handlers.onOsc777?.(currentPayload)
      return
    }
    if (currentCode === 52) {
      const text = parseOsc52(currentPayload)
      if (text !== undefined) handlers.onClipboard?.(text)
    }
  }

  const beginOsc = () => {
    state = "code"
    codeText = ""
    code = -1
    payload = ""
    oversized = false
  }

  const stepCode = (ch: string) => {
    if (ch === ";") {
      const parsed = codeText.length > 0 ? Number.parseInt(codeText, 10) : -1
      if (HANDLED_CODES.has(parsed)) {
        code = parsed
        state = "payload"
        return
      }
      state = "ignore"
      return
    }
    if (ch >= "0" && ch <= "9" && codeText.length < MAX_CODE_DIGITS) {
      codeText += ch
      return
    }
    if (ch === "\x07" || ch === "\u009c") {
      reset()
      return
    }
    if (ch === "\x1b") {
      state = "ignoreEsc"
      return
    }
    state = "ignore"
  }

  const stepPayload = (ch: string) => {
    if (ch === "\x07" || ch === "\u009c") {
      dispatch()
      return
    }
    if (ch === "\x1b") {
      state = "payloadEsc"
      return
    }
    if (ch === "\x18" || ch === "\x1a") {
      reset()
      return
    }
    if (oversized) return
    if (payload.length >= maxLengthFor(code)) {
      oversized = true
      payload = ""
      return
    }
    payload += ch
  }

  const stepEscape = (ch: string, finish: boolean) => {
    if (ch === "\\") {
      if (finish) dispatch()
      else reset()
      return
    }
    if (ch === "]") {
      beginOsc()
      return
    }
    reset()
  }

  const nextIntroducer = (text: string, from: number): { index: number; len: number } | undefined => {
    const osc7 = text.indexOf("\x1b]", from)
    const osc8 = text.indexOf("\u009d", from)
    if (osc7 < 0 && osc8 < 0) return undefined
    if (osc7 < 0) return { index: osc8, len: 1 }
    if (osc8 < 0) return { index: osc7, len: 2 }
    return osc7 < osc8 ? { index: osc7, len: 2 } : { index: osc8, len: 1 }
  }

  const stepChar = (ch: string) => {
    if (state === "esc") {
      if (ch === "]" || ch === "\u009d") beginOsc()
      else if (ch !== "\x1b") state = "ground"
      return
    }
    if (state === "code") return stepCode(ch)
    if (state === "payload") return stepPayload(ch)
    if (state === "payloadEsc") return stepEscape(ch, true)
    if (state === "ignore") {
      if (ch === "\x07" || ch === "\u009c" || ch === "\x18" || ch === "\x1a") reset()
      else if (ch === "\x1b") state = "ignoreEsc"
      return
    }
    stepEscape(ch, false)
  }

  const scan = (text: string) => {
    if (text.length === 0) return
    // Fast path: skip chunks that contain only plain text or CSI/SGR codes (no OSC introducer).
    if (state === "ground" && !text.includes("\x1b]") && !text.includes("\u009d") && !text.endsWith("\x1b")) return

    let i = 0
    while (i < text.length) {
      if (state === "ground") {
        const hit = nextIntroducer(text, i)
        if (!hit) {
          if (text.endsWith("\x1b")) state = "esc"
          return
        }
        beginOsc()
        i = hit.index + hit.len
        continue
      }
      stepChar(text[i]!)
      i++
    }
  }

  const feed = (data: string | Uint8Array) => {
    if (typeof data === "string") {
      if (streamingBytes) {
        streamingBytes = false
        scan(decoder.decode())
      }
      scan(data)
      return
    }
    streamingBytes = true
    scan(decoder.decode(data, { stream: true }))
  }

  const clear = () => {
    if (streamingBytes) {
      streamingBytes = false
      decoder.decode()
    }
    reset()
    lastTitle = undefined
  }

  return { feed, clear }
}
