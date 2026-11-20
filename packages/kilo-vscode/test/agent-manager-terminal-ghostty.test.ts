import { describe, expect, it } from "bun:test"
import path from "node:path"
import { DirtyState, Ghostty, type IRenderable, type Terminal } from "ghostty-web"
import { createOscScanner } from "../webview-ui/agent-manager/terminal/osc"
import { createTerminalKeyHandler, type TerminalKeyEvent } from "../webview-ui/agent-manager/terminal/keys"
import {
  blendColor,
  normalizeHexColor,
  parseCssColor,
  pickSelectionForeground,
} from "../webview-ui/agent-manager/terminal/theme"
import {
  disposeTerminalSafely,
  fitTerminalDirect,
  optimizeTerminalRenderer,
  pauseTerminalRender,
  readWasmBuffer,
  resumeTerminalRender,
} from "../webview-ui/agent-manager/terminal/ghostty"
import {
  CURSOR_GLIDE_MS,
  CURSOR_IDLE_STOP_MS,
  computeBlinkState,
  createDecscusrScanner,
  sampleCursorGlide,
  startCursorGlide,
  type CursorStyle,
} from "../webview-ui/agent-manager/terminal/cursor"
import { createReplayGate, createWriteBatcher } from "../webview-ui/agent-manager/terminal/replay"

const wasmPath = path.join(
  path.dirname(Bun.resolveSync("ghostty-web/package.json", path.resolve(import.meta.dir, ".."))),
  "ghostty-vt.wasm",
)

describe("libghostty OSC scanner", () => {
  it("parses OSC 0/2 titles across BEL, 7-bit ST, 8-bit ST, and split binary UTF-8 chunks", () => {
    const titles: string[] = []
    const osc = createOscScanner({ onTitle: (title) => titles.push(title) })
    const encoder = new TextEncoder()

    osc.feed("\x1b]2;first title\x07")
    // Duplicate title is deduplicated.
    osc.feed("\x1b]0;first title\x1b\\")
    // Split UTF-8 emoji and 7-bit ST across binary chunks.
    const bytes = encoder.encode("\x1b]2;build 🚀 done\x1b\\")
    for (let i = 0; i < bytes.length; i += 3) osc.feed(bytes.subarray(i, i + 3))
    // 8-bit OSC introducer + 8-bit ST terminator.
    osc.feed("\u009d2;c1 title\u009c")

    expect(titles).toEqual(["first title", "build 🚀 done", "c1 title"])
  })

  it("extracts OSC 777 activity packets split across chunks", () => {
    const packets: string[] = []
    const osc = createOscScanner({ onOsc777: (data) => packets.push(data) })

    osc.feed("normal output\x1b]77")
    osc.feed("7;kilo;activity;1;busy;1700000000000\x1b")
    osc.feed("\\trailing")

    expect(packets).toEqual(["kilo;activity;1;busy;1700000000000"])
  })

  it("decodes OSC 52 clipboard writes and ignores clipboard read queries", () => {
    const copied: string[] = []
    const osc = createOscScanner({ onClipboard: (text) => copied.push(text) })
    const encoded = Buffer.from("hello 世界", "utf8").toString("base64")

    osc.feed(`\x1b]52;c;${encoded.slice(0, 4)} \n ${encoded.slice(4)}\x07`)
    // Security: never act on clipboard read queries.
    osc.feed("\x1b]52;c;?\x07")
    // Malformed base64 does not throw.
    osc.feed("\x1b]52;c;%%%not-base64%%%\x07")

    expect(copied).toEqual(["hello 世界"])
  })

  it("ignores unhandled OSC codes, aborts on CAN/SUB, handles split ESC ] across CSI chunks, and drops oversized payloads", () => {
    const titles: string[] = []
    const osc = createOscScanner({ onTitle: (title) => titles.push(title) })

    // Fast-path CSI-heavy chunks never trigger false titles, and a trailing ESC splits cleanly into OSC.
    osc.feed("\x1b[38;5;196mcolored\x1b[0m\n\x1b")
    osc.feed("]2;split-after-csi\x07")
    osc.feed("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")
    osc.feed("\x1b]2;aborted\x18still ground")
    osc.feed(`\x1b]2;${"a".repeat(5000)}\x07`)
    osc.feed("\x1b]2;after\x07")

    expect(titles).toEqual(["split-after-csi", "after"])
  })
})

describe("libghostty theme normalization", () => {
  it("normalizes hex and rgb/rgba colors with backdrop blending", () => {
    const bg = parseCssColor("#1e1e1e")!
    expect(normalizeHexColor("#abc", "#000000")).toBe("#aabbcc")
    expect(normalizeHexColor("#1e1e1eff", "#000000")).toBe("#1e1e1e")
    expect(normalizeHexColor("rgb(13, 188, 121)", "#000000")).toBe("#0dbc79")
    expect(normalizeHexColor("rgba(255, 255, 255, 0.5)", "#000000", bg)).toBe("#8f8f8f")
    expect(blendColor({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 })).toEqual({
      r: 128,
      g: 128,
      b: 128,
      a: 1,
    })
  })

  it("picks high-contrast selection foreground for dark and light themes", () => {
    // Dark theme with dark blue selection keeps light text instead of ghostty-web's dark default.
    expect(pickSelectionForeground("#264f78", "#d4d4d4", "#1e1e1e")).toBe("#d4d4d4")
    // Light theme with pale blue selection keeps dark text.
    expect(pickSelectionForeground("#add6ff", "#333333", "#ffffff")).toBe("#333333")
    // Dark theme with bright white selection flips to dark text for readability.
    expect(pickSelectionForeground("#d4d4d4", "#d4d4d4", "#1e1e1e")).toBe("#1e1e1e")
  })
})

describe("libghostty key handler", () => {
  const key = (
    overrides: Partial<TerminalKeyEvent> & { key: string; code?: string },
  ): TerminalKeyEvent => ({
    type: "keydown",
    code: overrides.code ?? "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  })

  it("routes macOS shortcuts, copy/paste, selectAll, Cmd+Backspace, and Ctrl+V accurately", () => {
    const sent: string[] = []
    let copied = 0
    let selected = 0
    let focusedPrompt = 0
    let selection = true
    const handle = createTerminalKeyHandler({
      mac: true,
      hasSelection: () => selection,
      onCopy: () => copied++,
      onSelectAll: () => selected++,
      onFocusPrompt: () => focusedPrompt++,
      sendInput: (data) => sent.push(data),
    })

    // Agent Manager focus chord
    expect(handle(key({ key: "M", code: "KeyM", metaKey: true, shiftKey: true }))).toBe(true)
    expect(focusedPrompt).toBe(1)

    // Agent Manager shortcuts leave terminal (true = ghostty-web skips PTY encoding)
    expect(handle(key({ key: "t", code: "KeyT", metaKey: true }))).toBe(true)
    expect(handle(key({ key: "w", code: "KeyW", metaKey: true }))).toBe(true)
    expect(handle(key({ key: "/", code: "Slash", metaKey: true }))).toBe(true)

    // Cmd+Backspace kills line
    expect(handle(key({ key: "Backspace", code: "Backspace", metaKey: true }))).toBe(true)
    expect(sent).toEqual(["\x15"])

    // Ctrl+V on macOS sends literal 0x16 to shell/vim
    expect(handle(key({ key: "v", code: "KeyV", ctrlKey: true }))).toBe(true)
    expect(sent).toEqual(["\x15", "\x16"])

    // Cmd+V passes through to native paste event
    expect(handle(key({ key: "v", code: "KeyV", metaKey: true }))).toBe(false)

    // Cmd+C copies when selected, still consumes when unselected so raw 'c' never hits PTY
    expect(handle(key({ key: "c", code: "KeyC", metaKey: true }))).toBe(true)
    expect(copied).toBe(1)
    selection = false
    expect(handle(key({ key: "c", code: "KeyC", metaKey: true }))).toBe(true)
    expect(copied).toBe(1)

    // Cmd+A selects all
    expect(handle(key({ key: "a", code: "KeyA", metaKey: true }))).toBe(true)
    expect(selected).toBe(1)

    // Unhandled Cmd+<char> is consumed so stray chars never hit PTY
    expect(handle(key({ key: "k", code: "KeyK", metaKey: true }))).toBe(true)

    // Normal Ctrl chords go straight to libghostty (false = ghostty-web handles)
    expect(handle(key({ key: "c", code: "KeyC", ctrlKey: true }))).toBe(false)
    expect(handle(key({ key: "e", code: "KeyE", ctrlKey: true }))).toBe(false)
    expect(handle(key({ key: "w", code: "KeyW", ctrlKey: true }))).toBe(false)
    expect(handle(key({ key: "d", code: "KeyD", ctrlKey: true }))).toBe(false)
  })

  it("handles non-Mac Ctrl+Shift+C copy and keeps Ctrl+C for the shell", () => {
    let copied = 0
    const handle = createTerminalKeyHandler({
      mac: false,
      hasSelection: () => true,
      onCopy: () => copied++,
      onSelectAll: () => undefined,
      sendInput: () => undefined,
    })

    expect(handle(key({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(copied).toBe(1)
    expect(handle(key({ key: "c", code: "KeyC", ctrlKey: true }))).toBe(false)
    expect(handle(key({ key: "t", code: "KeyT", ctrlKey: true }))).toBe(true)
  })
})

describe("libghostty WASM engine and lifecycle helpers", () => {
  it("loads ghostty-vt.wasm, parses VT output, answers DSR queries synchronously, and rasterizes Kilo sextants", async () => {
    const ghostty = await Ghostty.load(wasmPath)
    const term = ghostty.createTerminal(80, 24)
    try {
      term.write("hello libghostty\r\n\x1b[32mgreen\x1b[0m\x1b[6n")
      const reply = term.readResponse()
      expect(reply).toBe("\x1b[2;6R")

      const line0 = term.getLine(0)
      expect(line0).not.toBeNull()
      const text0 = line0!
        .slice(0, 16)
        .map((cell) => String.fromCodePoint(cell.codepoint || 32))
        .join("")
      expect(text0).toBe("hello libghostty")

      // Kilo's modern wordmark uses Unicode sextant glyphs (U+1FB01, U+1FB0F, U+1FB2C, U+1FB3A).
      for (const cp of [0x2500, 0x2588, 0xe0b0, 0x1fb01, 0x1fb0f, 0x1fb2c, 0x1fb3a]) {
        expect(ghostty.hasSpriteCodepoint(cp)).toBe(true)
        expect(ghostty.rasterizeSprite(cp, 16, 32, 2)).not.toBeNull()
      }
    } finally {
      term.free()
    }
  })

  it("completes an empty 0x00 replay boundary without crashing WASM or blocking input and DA1 replies", async () => {
    const ghostty = await Ghostty.load(wasmPath)
    const term = ghostty.createTerminal(80, 24)
    const sent: string[] = []
    try {
      const batcher = createWriteBatcher(
        (data, callback) => {
          const len = typeof data === "string" ? data.length : data.byteLength
          if (len > 0) {
            term.write(data)
            for (let reply = term.readResponse(); reply !== null; reply = term.readResponse()) sent.push(reply)
          }
          callback?.()
        },
        () => 1,
        () => undefined,
      )
      const replay = createReplayGate({
        write: (data, callback) => batcher.write(data, callback),
        flush: () => sent.push("FLUSHED"),
      })

      replay.attach(false)
      expect(replay.blocked()).toBe(true)
      // Server sends 0x00 metadata frame when cursor=0 (empty replay before shell output).
      expect(replay.frame(new Uint8Array([0, 123, 125]))).toBe(true)
      batcher.flush()
      expect(replay.blocked()).toBe(false)
      expect(sent).toEqual(["FLUSHED"])

      // Shell startup probe (fish DA1 + XTVERSION + Kitty) immediately gets its reply.
      const fishProbe =
        "\x1b[?u\x1b[>0q\x1b]11;?\x1b\\\x1b[?1049h\x1bP+q696e646e\x1b\\\x1b[?1049l\x1b[0c"
      replay.output(fishProbe)
      batcher.flush()
      expect(sent[1]).toContain("\x1b[?62;22c")
      batcher.cancel()
    } finally {
      term.free()
    }
  })

  it("fits directly without FitAddon 50ms lockout and skips no-op resizes", () => {
    const resizes: Array<[number, number]> = []
    const fakeTerm = {
      cols: 80,
      rows: 24,
      resize(this: { cols: number; rows: number }, cols: number, rows: number) {
        this.cols = cols
        this.rows = rows
        resizes.push([cols, rows])
      },
    } as unknown as Terminal
    let dims = { cols: 100, rows: 30 }
    const fakeFit = { proposeDimensions: () => dims } as unknown as Parameters<typeof fitTerminalDirect>[1]

    expect(fitTerminalDirect(fakeTerm, fakeFit)).toBe(true)
    expect(fitTerminalDirect(fakeTerm, fakeFit)).toBe(false)
    dims = { cols: 110, rows: 32 }
    expect(fitTerminalDirect(fakeTerm, fakeFit)).toBe(true)
    expect(resizes).toEqual([
      [100, 30],
      [110, 32],
    ])
  })

  it("preserves ZWJ emoji, flags, CJK, Devanagari, Arabic, combining marks, and scrollback in readWasmBuffer", async () => {
    const ghostty = await Ghostty.load(wasmPath)
    const term = ghostty.createTerminal(80, 6)
    try {
      const lines = [
        "Family: 👨‍👩‍👧‍👦",
        "Wave: 👋🏽 Flag: 🇺🇸 Heart: ❤️",
        "CJK: 日本語 한국어 中文",
        "Devanagari: हिन्दी नमस्ते",
        "Arabic: العربية",
        "Combining: café vs cafe\u0301",
        "Bottom line",
        "Tail line",
      ]
      for (const line of lines) term.write(`${line}\r\n`)
      const text = readWasmBuffer(term)
      for (const line of lines) expect(text).toContain(line)
    } finally {
      term.free()
    }
  })

  it("routes scrollback grapheme lookups to getScrollbackGraphemeString when scrolled up", () => {
    const lookedUp: string[] = []
    let capturedBuffer: IRenderable | undefined
    const buffer = {
      update: () => DirtyState.FULL,
      getCursor: () => ({ x: 0, y: 0, visible: true }),
      getDimensions: () => ({ cols: 80, rows: 10 }),
      getLine: () => null,
      isRowDirty: () => false,
      clearDirty: () => undefined,
      getGraphemeString: (row: number, col: number) => {
        lookedUp.push(`screen:${row}:${col}`)
        return "S"
      },
      getScrollbackGraphemeString: (offset: number, col: number) => {
        lookedUp.push(`scrollback:${offset}:${col}`)
        return "👨‍👩‍👧‍👦"
      },
    } as unknown as IRenderable
    const scrollback = { getScrollbackLine: () => null, getScrollbackLength: () => 50 }
    const renderer = {
      getCanvas: () => ({ parentElement: null }),
      render: (target: IRenderable) => {
        capturedBuffer = target
      },
    }
    const fake = { renderer } as unknown as Terminal

    optimizeTerminalRenderer(fake)
    fake.renderer!.render(buffer, true, 4, scrollback, 0)

    // Rows 0..3 map to scrollback offsets 46..49; row 4 maps to screen row 0.
    expect(capturedBuffer?.getGraphemeString?.(1, 5)).toBe("👨‍👩‍👧‍👦")
    expect(capturedBuffer?.getGraphemeString?.(4, 2)).toBe("S")
    expect(lookedUp).toEqual(["scrollback:47:5", "screen:0:2"])
  })

  it("pauses, resumes, and safely disposes terminal render loops and document mouseup listeners", () => {
    const calls: string[] = []
    const mouseUp = () => undefined
    const fake = {
      viewportY: 0,
      wasmTerm: {},
      renderer: {
        setCursorBlink: (enabled: boolean) => calls.push(`blink:${enabled}`),
        render: () => calls.push("render"),
      },
      cancelRenderLoop: () => calls.push("cancel"),
      startRenderLoop: () => calls.push("start"),
      handleMouseUp: mouseUp,
      dispose: () => calls.push("dispose"),
    } as unknown as Terminal

    pauseTerminalRender(fake)
    resumeTerminalRender(fake, true)
    disposeTerminalSafely(fake)

    expect(calls).toEqual(["cancel", "blink:false", "blink:true", "render", "start", "dispose"])
  })

  it("skips redundant idle frames while scrolled up or blinking and floors fractional viewportY", () => {
    const rendered: Array<{ forceAll: boolean; viewportY: number }> = []
    let dirty = DirtyState.NONE
    let cursorVisible = true
    const buffer = {
      update: () => dirty,
      getCursor: () => ({ x: 0, y: 0, visible: true }),
      getDimensions: () => ({ cols: 80, rows: 24 }),
      getLine: () => null,
      isRowDirty: () => false,
      clearDirty: () => undefined,
    } as unknown as IRenderable
    const scrollback = { getScrollbackLine: () => null, getScrollbackLength: () => 500 }
    const renderer = {
      cursorBlink: true,
      get cursorVisible() {
        return cursorVisible
      },
      getCanvas: () => ({ parentElement: null }),
      render: (_buf: IRenderable, forceAll = false, viewportY = 0) => {
        rendered.push({ forceAll, viewportY })
      },
    }
    const fake = { renderer } as unknown as Terminal

    optimizeTerminalRenderer(fake)

    // Initial scrolled render floors fractional smooth-scroll offset to integer row.
    fake.renderer!.render(buffer, false, 41.7, scrollback, 0)
    // Subsequent identical idle frames at fractional offsets in the same row are skipped.
    fake.renderer!.render(buffer, false, 41.9, scrollback, 0)
    fake.renderer!.render(buffer, false, 41.2, scrollback, 0)
    // Moving to a new integer row renders once with the floored value.
    fake.renderer!.render(buffer, false, 42.1, scrollback, 0)
    // Returning to bottom renders once; repeated idle frames with unchanged cursor blink skip.
    fake.renderer!.render(buffer, false, 0, scrollback, 0)
    fake.renderer!.render(buffer, false, 0, scrollback, 0)
    // Cursor blink toggle triggers one redraw; dirty WASM state triggers one redraw.
    cursorVisible = false
    fake.renderer!.render(buffer, false, 0, scrollback, 0)
    dirty = DirtyState.PARTIAL
    fake.renderer!.render(buffer, false, 0, scrollback, 0)
    // Explicit forceAll always renders.
    dirty = DirtyState.NONE
    fake.renderer!.render(buffer, true, 0, scrollback, 0)

    expect(rendered).toEqual([
      { forceAll: false, viewportY: 41 },
      { forceAll: false, viewportY: 42 },
      { forceAll: false, viewportY: 0 },
      { forceAll: false, viewportY: 0 },
      { forceAll: false, viewportY: 0 },
      { forceAll: true, viewportY: 0 },
    ])
  })
})

describe("libghostty animated cursor", () => {
  it("breathes smoothly while active, sleeps on flat holds, and stops blinking after idle or blur", () => {
    // Solid hold: 0 rAF needed, schedules wake timer for fade-out start.
    const solid = computeBlinkState(100, { blinking: true, focused: true })
    expect(solid.opacity).toBe(1)
    expect(solid.animating).toBe(false)
    expect(solid.nextWakeMs).toBeGreaterThan(0)

    // Mid fade-out: actively animating smoothly between 1 and dim opacity.
    const fading = computeBlinkState(580, { blinking: true, focused: true })
    expect(fading.animating).toBe(true)
    expect(fading.opacity).toBeGreaterThan(0.14)
    expect(fading.opacity).toBeLessThan(1)

    // After 10s idle: settles steady at 1.0 with no rAF and no timer.
    const idle = computeBlinkState(CURSOR_IDLE_STOP_MS, { blinking: true, focused: true })
    expect(idle).toEqual({ opacity: 1, animating: false, nextWakeMs: undefined })

    // Unfocused or steady mode: static with no animation or timer.
    expect(computeBlinkState(580, { blinking: true, focused: false })).toEqual({
      opacity: 1,
      animating: false,
      nextWakeMs: undefined,
    })
    expect(computeBlinkState(580, { blinking: false, focused: true })).toEqual({
      opacity: 1,
      animating: false,
      nextWakeMs: undefined,
    })
  })

  it("glides smoothly with subtle horizontal stretch and snaps on large vertical jumps", () => {
    const initial = startCursorGlide(undefined, { x: 2, y: 5 }, 1000, true)
    expect(initial.active).toBe(false)

    const moving = startCursorGlide(initial, { x: 6, y: 5 }, 1000, true)
    expect(moving.active).toBe(true)
    const mid = sampleCursorGlide(moving, 1000 + CURSOR_GLIDE_MS / 2)
    expect(mid.active).toBe(true)
    expect(mid.x).toBeGreaterThan(4)
    expect(mid.x).toBeLessThan(6)
    expect(mid.stretchX).toBeGreaterThan(0)

    const settled = sampleCursorGlide(moving, 1000 + CURSOR_GLIDE_MS)
    expect(settled).toEqual({ x: 6, y: 5, stretchX: 0, active: false })

    // Large row jump (e.g., screen clear or page jump) snaps immediately.
    const jump = startCursorGlide(settled.active ? moving : initial, { x: 0, y: 25 }, 1100, true)
    expect(jump.active).toBe(false)
    expect(sampleCursorGlide(jump, 1100)).toEqual({ x: 0, y: 25, stretchX: 0, active: false })
  })

  it("parses DECSCUSR cursor shape and steady/blink sequences across chunk boundaries", () => {
    const events: Array<[CursorStyle, boolean]> = []
    const scanner = createDecscusrScanner((style, blink) => events.push([style, blink]))

    scanner.feed("plain output without sequences")
    scanner.feed("\x1b[6 q")
    scanner.feed("\x1b[")
    scanner.feed("3 q\x1b[2 q")
    scanner.feed(new TextEncoder().encode("\x1b[5 q\x1b[ q"))

    expect(events).toEqual([
      ["bar", false],
      ["underline", true],
      ["block", false],
      ["bar", true],
      ["block", true],
    ])
  })
})
