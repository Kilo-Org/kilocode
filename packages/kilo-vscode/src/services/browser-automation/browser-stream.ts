import { randomBytes } from "node:crypto"
import { setTimeout as wait } from "node:timers/promises"
import type { CDPSession, Page } from "playwright-core"
import { clipboardBridgeScript, clipboardPageScript, COPY_BINDING } from "./browser-clipboard"
import { orderedFrames, screencast, type Cast, type Pixels } from "./browser-frame"
import type { BrowserCaptureExtension } from "./browser-capture-ext"
import { BrowserFrameClient } from "./browser-frame-client"
import {
  CURSORS,
  mergeWheel,
  VIEWPORT_LIMIT,
  type BrowserCursor,
  type BrowserFrame,
  type BrowserInteraction,
  type BrowserViewIdentity,
  type BrowserViewport,
  type WheelInteraction,
} from "../../shared/browser-stream"

type Scope = { browserId: string; navigation: number; committed?: number }
type Key = Extract<BrowserInteraction, { kind: "key" }>
type Pointer = Extract<BrowserInteraction, { kind: "pointer" }>
type Wheel = WheelInteraction
type Clipboard = Extract<BrowserInteraction, { kind: "clipboard" }>["action"]
const TEXT = 64 * 1024
const SETTLE = 250
const BINDING = "__kiloCursor"
const WORLD = "kilo-cursor"
const BUTTONS = { left: 1, right: 2, middle: 4 } as const
const MODIFIERS = [
  { key: "Alt", code: "AltLeft", keyCode: 18, mask: 1 },
  { key: "Control", code: "ControlLeft", keyCode: 17, mask: 2 },
  { key: "Meta", code: "MetaLeft", keyCode: 91, mask: 4 },
  { key: "Shift", code: "ShiftLeft", keyCode: 16, mask: 8 },
] as const
const EDITING: Record<string, string> = {
  "4:KeyA": "selectAll",
  "4:KeyZ": "undo",
  "12:KeyZ": "redo",
  "1:Backspace": "deleteWordBackward",
  "1:Delete": "deleteWordForward",
  "4:Backspace": "deleteToBeginningOfLine",
  "1:ArrowLeft": "moveWordLeft",
  "1:ArrowRight": "moveWordRight",
  "4:ArrowLeft": "moveToLeftEndOfLine",
  "4:ArrowRight": "moveToRightEndOfLine",
  "4:ArrowUp": "moveToBeginningOfDocument",
  "4:ArrowDown": "moveToEndOfDocument",
  "9:ArrowLeft": "moveWordLeftAndModifySelection",
  "9:ArrowRight": "moveWordRightAndModifySelection",
  "12:ArrowLeft": "moveToLeftEndOfLineAndModifySelection",
  "12:ArrowRight": "moveToRightEndOfLineAndModifySelection",
  "12:ArrowUp": "moveToBeginningOfDocumentAndModifySelection",
  "12:ArrowDown": "moveToEndOfDocumentAndModifySelection",
}

function range(value: number, min: number, max: number, integer = false): boolean {
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isSafeInteger(value))
}

function text(value: string, limit: number): boolean {
  return typeof value === "string" && value.length <= limit
}

function position(event: { x: number; y: number; modifiers: number }): boolean {
  return range(event.x, 0, 1) && range(event.y, 0, 1) && range(event.modifiers, 0, 15, true)
}

function pointer(event: Pointer): boolean {
  return (
    position(event) &&
    ["move", "down", "up"].includes(event.action) &&
    ["left", "middle", "right"].includes(event.button) &&
    range(event.buttons, 0, 7, true) &&
    range(event.clicks, 0, 3, true)
  )
}

function key(event: Key): boolean {
  return (
    ["down", "up"].includes(event.action) &&
    text(event.key, 64) &&
    event.key.length > 0 &&
    text(event.code, 64) &&
    range(event.keyCode, 0, 255, true) &&
    range(event.modifiers, 0, 15, true) &&
    typeof event.repeat === "boolean" &&
    (event.text === undefined || text(event.text, 64))
  )
}

function location(event: Key): number {
  if (!MODIFIERS.some((modifier) => modifier.key === event.key)) return 0
  return event.code.endsWith("Right") ? 2 : 1
}

function valid(event: BrowserInteraction): boolean {
  if (!event || typeof event !== "object") return false
  switch (event.kind) {
    case "pointer":
      return pointer(event)
    case "wheel":
      return position(event) && range(event.deltaX, -10000, 10000) && range(event.deltaY, -10000, 10000)
    case "key":
      return key(event)
    case "text":
      return text(event.text, TEXT)
    case "composition":
      return (
        text(event.text, TEXT) &&
        range(event.start, 0, event.text.length, true) &&
        range(event.end, event.start, event.text.length, true)
      )
    case "clipboard":
      return ["copy", "cut", "paste"].includes(event.action)
    case "release":
      return true
    default:
      return false
  }
}

function selection(opts: { action: Clipboard; limit: number; text?: string }): { focused: boolean; text?: string } {
  let node = document.activeElement
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement
  if (node instanceof HTMLIFrameElement || node instanceof HTMLFrameElement) return { focused: false }
  const transfer = (): { handled: boolean; text?: string } => {
    if (opts.action !== "paste" && node instanceof HTMLInputElement && node.type === "password")
      return { handled: true }
    const data = new DataTransfer()
    if (opts.action === "paste") data.setData("text/plain", opts.text ?? "")
    const allowed = (node ?? document).dispatchEvent(
      new ClipboardEvent(opts.action, { bubbles: true, cancelable: true, composed: true, clipboardData: data }),
    )
    if (opts.action === "paste") return { handled: true, text: allowed ? opts.text : undefined }
    if (allowed) return { handled: false }
    const value = data.types.includes("text/plain") ? data.getData("text/plain") : undefined
    if (value !== undefined && value.length > opts.limit) throw new Error("Browser selection exceeds the text limit")
    return { handled: true, text: value }
  }
  const event = transfer()
  if (event.handled) return { focused: true, text: event.text }

  const field = (node: HTMLInputElement | HTMLTextAreaElement) => {
    if (node instanceof HTMLInputElement && node.type === "password") return undefined
    const start = node.selectionStart
    const end = node.selectionEnd
    if (start === null || end === null || start === end) return undefined
    if (end - start > opts.limit) throw new Error("Browser selection exceeds the text limit")
    const value = node.value.slice(start, end)
    if (opts.action === "cut" && !node.readOnly && !node.disabled) document.execCommand("delete")
    return value
  }

  const editable = (node: Node) => {
    let element = node instanceof HTMLElement ? node : node.parentElement
    if (!element?.isContentEditable) return undefined
    while (element.parentElement?.isContentEditable) element = element.parentElement
    return element
  }

  const remove = (range: Range) => {
    const root = editable(range.startContainer)
    if (!root || root !== editable(range.endContainer)) return
    const nodes = root.querySelectorAll('[contenteditable="false"], input, textarea')
    if ([...nodes].some((node) => range.intersectsNode(node))) return
    document.execCommand("delete")
  }

  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    return { focused: true, text: field(node) }
  }
  const value = document.getSelection()
  if (!value || value.isCollapsed || value.rangeCount !== 1) return { focused: true }
  const result = value.toString()
  if (result.length > opts.limit) throw new Error("Browser selection exceeds the text limit")
  if (opts.action === "cut") remove(value.getRangeAt(0))
  return { focused: true, text: result }
}

function kept(current: BrowserViewport | undefined, next: BrowserViewport) {
  return (
    !!current &&
    next.active &&
    next.width === current.width &&
    next.height === current.height &&
    next.scale === current.scale
  )
}

// Discrete CDP wheel events lack trackpad phases, so macOS Chrome stretches and snaps elastic overscroll on every tick
// at the top or bottom of a page. Suppress root elastic bounce when the page uses the browser default.
function suppressOverscroll() {
  const apply = () => {
    const root = document.documentElement
    if (root instanceof HTMLElement && getComputedStyle(root).overscrollBehavior === "auto") {
      root.style.overscrollBehavior = "none"
    }
  }
  const watch = () => {
    apply()
    if (document.documentElement) {
      new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch, { once: true })
  else watch()
  apply()
}

// Runs only in an isolated world. Read the hovered element, not the page's full text or layout.
function reporter(name: string, epoch: number, keywords: string[]) {
  const globals = globalThis as unknown as Record<string, unknown>
  const cleanup = `${name}Cleanup`
  const previous = globals[cleanup]
  if (typeof previous === "function") previous()
  const report = globals[name]
  if (typeof report !== "function") return
  const fields = ["text", "search", "email", "url", "tel", "password", "number"]
  const resolve = (x: number, y: number, node: unknown) => {
    if (!(node instanceof Element)) return "default"
    const style = getComputedStyle(node)
    const keyword = style.cursor.slice(style.cursor.lastIndexOf(",") + 1).trim()
    if (keyword !== "auto") return keywords.includes(keyword) ? keyword : "default"
    if (node.closest("a[href], area[href]")) return "pointer"
    if (node instanceof HTMLTextAreaElement) return node.disabled ? "default" : "text"
    if (node instanceof HTMLElement && node.isContentEditable) return "text"
    if (node instanceof HTMLInputElement) return !node.disabled && fields.includes(node.type) ? "text" : "default"
    if (node.closest("button, select")) return "default"
    if (style.userSelect === "none") return "default"
    const caret = document.caretRangeFromPoint?.(x, y)
    const text = caret?.startContainer
    if (!caret || !(text instanceof Text) || !text.length) return "default"
    // Check only the characters next to the caret, which can fall on either side of the hovered glyph.
    const range = document.createRange()
    range.setStart(text, Math.max(0, caret.startOffset - 1))
    range.setEnd(text, Math.min(text.length, caret.startOffset + 1))
    return [...range.getClientRects()].some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
      ? "text"
      : "default"
  }
  let last = ""
  let lastX = -1
  let lastY = -1
  const emit = (value: string) => {
    if (value === last) return
    last = value
    report(`${epoch}:${value}`)
  }
  const event = typeof PointerEvent === "undefined" ? "mousemove" : "pointermove"
  const enter = event === "pointermove" ? "pointerover" : "mouseover"
  const presses =
    event === "pointermove"
      ? (["pointerdown", "pointerup", "pointercancel"] as const)
      : (["mousedown", "mouseup"] as const)
  let scheduled = 0
  const move = (event: MouseEvent) => {
    lastX = event.clientX
    lastY = event.clientY
    if (event.type === enter) last = ""
    emit(resolve(lastX, lastY, event.composedPath()[0]))
  }
  const onScroll = () => {
    if (lastX < 0 || lastY < 0 || scheduled) return
    scheduled = requestAnimationFrame(() => {
      scheduled = 0
      emit(resolve(lastX, lastY, document.elementFromPoint(lastX, lastY)))
    })
  }
  const press = (event: MouseEvent) => {
    lastX = event.clientX
    lastY = event.clientY
    const node = event.composedPath()[0]
    cancelAnimationFrame(scheduled)
    // Read pressed styles after the page's event handlers, without observing or changing the document.
    scheduled = requestAnimationFrame(() => {
      scheduled = 0
      emit(resolve(lastX, lastY, node instanceof Element && node.isConnected ? node : document.elementFromPoint(lastX, lastY)))
    })
  }
  const leave = () => {
    lastX = -1
    lastY = -1
    cancelAnimationFrame(scheduled)
    scheduled = 0
    emit("default")
  }
  addEventListener(event, move, { capture: true, passive: true })
  addEventListener(enter, move, { capture: true, passive: true })
  addEventListener("scroll", onScroll, { capture: true, passive: true })
  for (const event of presses) addEventListener(event, press, { capture: true, passive: true })
  document.addEventListener("mouseleave", leave, { passive: true })
  globals[cleanup] = () => {
    cancelAnimationFrame(scheduled)
    removeEventListener(event, move, true)
    removeEventListener(enter, move, true)
    removeEventListener("scroll", onScroll, true)
    for (const event of presses) removeEventListener(event, press, true)
    document.removeEventListener("mouseleave", leave)
    delete globals[cleanup]
  }
}

export class BrowserStream {
  private session?: CDPSession
  private readonly capture?: BrowserFrameClient
  private view?: BrowserViewport
  private casting?: BrowserViewport
  private scope: Scope
  private epoch = 0
  private sequence = 0
  private decode = orderedFrames()
  private outstanding?: number
  private buffered?: BrowserFrame
  private pending: Promise<void> = Promise.resolve()
  private cancel?: () => void
  private wheel?: { event: Wheel; result: Promise<string | undefined> }
  private closing?: Promise<void>
  private closed = false
  private started = false // Only the host CDP session needs an explicit Page.stopScreencast.
  private buttons = 0
  private modifiers = 0
  private x = 0
  private y = 0
  private composing = false
  private readonly keys = new Map<string, Key>()
  private readonly contexts = new Set<number>()
  private reporter: Promise<void> = Promise.resolve()
  private script?: string
  private copyScript?: string
  private readonly copyChannel = `__kilo_copy_${randomBytes(16).toString("hex")}`
  private copyArmedUntil = 0
  private keyword?: string

  constructor(
    private readonly page: Page,
    private readonly identity: () => Scope,
    private readonly emit: (frame: BrowserFrame) => void,
    private readonly log: (...args: unknown[]) => void,
    private readonly cursor?: (value: BrowserCursor) => void,
    port?: number,
    endpoint?: (url: string | undefined) => void,
    extension?: () => BrowserCaptureExtension | undefined,
    private readonly copy?: (identity: BrowserViewIdentity, text: string) => void,
  ) {
    this.scope = { ...identity() }
    if (port !== undefined) this.capture = new BrowserFrameClient(port, () => this.rebind(), endpoint, extension)
    page.on("close", this.ended)
  }

  async configure(view: BrowserViewport): Promise<void> {
    if (this.closed) return
    if (
      !view ||
      !range(view.width, Number.MIN_VALUE, Number.MAX_VALUE) ||
      !range(view.height, Number.MIN_VALUE, Number.MAX_VALUE) ||
      (view.scale !== undefined && !range(view.scale, Number.MIN_VALUE, Number.MAX_VALUE)) ||
      !range(view.revision, 0, Number.MAX_SAFE_INTEGER, true) ||
      typeof view.active !== "boolean"
    ) {
      throw new Error("Invalid browser viewport")
    }
    const current = this.view
    const suspend = current && current.active && !view.active && view.revision === current.revision
    if (current && view.revision <= current.revision && !suspend) return
    const width = Math.max(32, Math.min(VIEWPORT_LIMIT.width, Math.round(view.width)))
    const height = Math.max(32, Math.min(VIEWPORT_LIMIT.height, Math.round(view.height)))
    const next = suspend
      ? { ...current, active: false }
      : {
          width,
          height,
          scale: Math.max(
            1,
            Math.min(view.scale ?? 1, 2, VIEWPORT_LIMIT.width / width, VIEWPORT_LIMIT.height / height),
          ),
          revision: view.revision,
          active: view.active,
        }
    this.view = next
    this.reset()
    this.scope = { ...this.identity() }
    // Same size: no resize or paint settle. A worker still needs a fresh binding to discard transferred old frames.
    if (this.casting === current && kept(current, next)) {
      this.casting = next
      if (this.capture) await this.serial(() => this.start(next))
      await this.install()
      return
    }
    await this.serial(async () => {
      if (this.closed || this.view !== next) return
      const session = await this.connect()
      if (this.closed || this.view !== next) return
      await this.stop()
      await this.release()
      if (this.closed || this.view !== next || suspend) return
      await this.page.setViewportSize({ width: next.width, height: next.height })
      if (this.closed || this.view !== next || !next.active) return
      // Playwright also resizes the headless Chrome window. After that resize, Chrome paints only the window
      // content area, which excludes the browser UI and has a minimum width. Screencast frames then do not match
      // the viewport and are dropped, so a static page stays blank. Wait until the resize reaches the page, then
      // set the painted size to the viewport again. A busy renderer must not block the stream queue.
      const abort = new AbortController()
      await Promise.race([
        this.page
          .evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
          .catch(() => this.report("resize wait failed")),
        wait(SETTLE, undefined, { signal: abort.signal }).catch(() => undefined),
      ])
      abort.abort()
      if (this.closed || this.view !== next) return
      await session
        .send("Emulation.setVisibleSize", { width: next.width, height: next.height })
        .catch(() => this.report("visible size failed"))
      if (this.closed || this.view !== next) return
      this.casting = next
      await this.start(next)
      await this.install()
    }).catch((error: unknown) => {
      this.casting = undefined
      if (!this.closed) throw error
    })
  }

  acknowledge(sequence: number): void {
    if (this.closed || !range(sequence, 1, Number.MAX_SAFE_INTEGER, true)) return
    this.synchronize()
    if (this.outstanding !== sequence) return
    this.outstanding = undefined
    const frame = this.buffered
    this.buffered = undefined
    if (frame) this.deliver(frame)
  }

  async interact(
    event: BrowserInteraction,
    read?: () => Promise<string>,
    write?: (text: string) => void | Promise<void>,
  ): Promise<string | undefined> {
    if (this.closed) return
    if (!valid(event)) throw new Error("Invalid browser interaction")
    const input = { ...event }
    this.synchronize()
    const queued = this.coalesce(input)
    if (queued) return queued
    const epoch = this.epoch
    const view = this.view
    const result = this.serial(async () => {
      if (this.wheel?.event === input) this.wheel = undefined
      if (this.closed) return
      this.synchronize()
      if (input.kind === "release") {
        await this.release()
        return
      }
      if (epoch !== this.epoch || !view?.active || this.view !== view || this.casting !== view) return
      const session = this.session
      if (!session) return
      switch (input.kind) {
        case "pointer":
          this.armCopy(input)
          await this.point(session, input, view)
          return
        case "wheel":
          this.coordinates(input, view)
          this.dispatch(
            session.send("Input.dispatchMouseEvent", {
              type: "mouseWheel",
              x: this.x,
              y: this.y,
              modifiers: this.modifiers,
              buttons: this.buttons,
              deltaX: input.deltaX,
              deltaY: input.deltaY,
            }),
          )
          return
        case "key":
          this.armCopy(input)
          await this.keyboard(session, input)
          return
        case "text":
          await session.send("Input.insertText", { text: input.text })
          this.composing = false
          return
        case "composition":
          this.composing = input.text.length > 0
          await session.send("Input.imeSetComposition", {
            text: input.text,
            selectionStart: input.start,
            selectionEnd: input.end,
          })
          return
        case "clipboard":
          if (input.action === "paste") {
            await this.paste(read, epoch)
            return
          }
          return this.clipboard(input.action, epoch, undefined, write)
      }
    }).catch((error: unknown) => {
      if (!this.closed) throw error
      return undefined
    })
    if (input.kind === "wheel") this.wheel = { event: input, result }
    return result
  }

  private async paste(read: (() => Promise<string>) | undefined, epoch: number): Promise<void> {
    if (!read) throw new Error("Clipboard access is not available.")
    const value = await this.cancellable(read)
    this.synchronize()
    if (value === undefined || this.closed || epoch !== this.epoch) return
    if (!text(value, TEXT)) throw new Error("Browser clipboard exceeds the text limit")
    const pasted = await this.clipboard("paste", epoch, value)
    this.synchronize()
    if (pasted === undefined || this.closed || epoch !== this.epoch) return
    await this.session?.send("Input.insertText", { text: pasted })
    this.composing = false
  }

  private async cancellable<T>(run: () => T | Promise<T>): Promise<T | undefined> {
    const stopped = Promise.withResolvers<undefined>()
    const cancel = () => stopped.resolve(undefined)
    this.cancel = cancel
    try {
      return await Promise.race([run(), stopped.promise])
    } finally {
      if (this.cancel === cancel) this.cancel = undefined
    }
  }

  private coalesce(event: BrowserInteraction): Promise<string | undefined> | undefined {
    const queued = this.wheel
    this.wheel = undefined
    if (event.kind !== "wheel" || !queued || !mergeWheel(queued.event, event)) return
    this.wheel = queued
    return queued.result
  }

  // Runs a page operation that must not overlap viewport changes or input.
  exclusive<T>(run: () => Promise<T>): Promise<T> {
    return this.serial(run)
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.reset()
    this.page.off("close", this.ended)
    this.closing = this.serial(async () => {
      await this.release()
      const session = this.session
      if (!session) return
      await this.stop().catch(() => this.report("stop failed"))
      await this.reporter
      if (this.script) {
        await session
          .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.script })
          .catch(() => this.report("cursor script removal failed"))
        this.script = undefined
      }
      if (this.copyScript) {
        await session
          .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.copyScript })
          .catch(() => undefined)
        this.copyScript = undefined
      }
      await Promise.all(
        [...this.contexts].map((contextId) =>
          session
            .send("Runtime.evaluate", {
              contextId,
              expression: this.copy
                ? `globalThis.${BINDING}Cleanup?.(); delete globalThis.${BINDING}; globalThis.${COPY_BINDING}Cleanup?.(); delete globalThis.${COPY_BINDING}`
                : `globalThis.${BINDING}Cleanup?.(); delete globalThis.${BINDING}`,
            })
            .catch(() => this.report("cursor listener removal failed")),
        ),
      )
      if (this.cursor)
        await session
          .send("Runtime.removeBinding", { name: BINDING })
          .catch(() => this.report("cursor binding removal failed"))
      if (this.copy) await session.send("Runtime.removeBinding", { name: COPY_BINDING }).catch(() => undefined)
      session.off("Page.screencastFrame", this.receive)
      session.off("Page.frameNavigated", this.navigated)
      session.off("Runtime.bindingCalled", this.pointed)
      session.off("Runtime.executionContextCreated", this.created)
      session.off("Runtime.executionContextDestroyed", this.destroyed)
      session.off("Runtime.executionContextsCleared", this.cleared)
      this.contexts.clear()
      this.session = undefined
      await session.detach().catch(() => this.report("detach failed"))
    })
    return this.closing
  }

  private readonly ended = (): void => {
    void this.close().catch(() => this.report("close failed"))
  }

  // Only a new main-frame document releases held input. Same-document navigations, such as pushState, keep it.
  private readonly navigated = (event: { frame: { parentId?: string } }): void => {
    if (this.closed || event.frame.parentId) return
    this.scope = { ...this.identity() }
    this.reset()
    this.rebind()
    void this.install()
    void this.serial(() => this.release()).catch(() => this.report("navigation release failed"))
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.pending.then(run)
    this.pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private report(message: string): void {
    this.log(`[Kilo] Browser stream ${message}`)
  }

  private reset(): void {
    this.epoch++
    this.decode = orderedFrames()
    void this.capture?.stop()
    this.cancel?.()
    this.cancel = undefined
    this.wheel = undefined
    this.outstanding = undefined
    this.buffered = undefined
    this.keyword = undefined
    this.copyArmedUntil = 0
  }

  // A same-document commit need not paint again. The broker also calls this when it advances the committed identity.
  synchronize(): void {
    const scope = this.identity()
    if (
      scope.browserId === this.scope.browserId &&
      scope.navigation === this.scope.navigation &&
      scope.committed === this.scope.committed
    )
      return
    this.scope = { ...scope }
    this.reset()
    this.rebind()
    if (this.capture) void this.install()
  }

  private async connect(): Promise<CDPSession> {
    if (this.session) return this.session
    const session = await this.page.context().newCDPSession(this.page)
    this.session = session
    session.on("Page.screencastFrame", this.receive)
    session.on("Page.frameNavigated", this.navigated)
    if (!this.closed) await session.send("Page.enable")
    if (!this.closed && (this.cursor || this.copy)) {
      session.on("Runtime.bindingCalled", this.pointed)
      session.on("Runtime.executionContextCreated", this.created)
      session.on("Runtime.executionContextDestroyed", this.destroyed)
      session.on("Runtime.executionContextsCleared", this.cleared)
      await session
        .send("Runtime.enable")
        .then(async () => {
          if (this.cursor) await session.send("Runtime.addBinding", { name: BINDING, executionContextName: WORLD })
          if (this.copy) {
            await session.send("Runtime.addBinding", { name: COPY_BINDING, executionContextName: WORLD })
            const added = await session.send("Page.addScriptToEvaluateOnNewDocument", {
              source: clipboardPageScript(this.copyChannel),
              runImmediately: true,
            })
            this.copyScript = added.identifier
          }
        })
        .catch(() => this.report("cursor binding setup failed"))
    }
    return session
  }

  private readonly created = (event: { context: { id: number; name: string } }): void => {
    if (event.context.name === WORLD) this.contexts.add(event.context.id)
  }

  private readonly destroyed = (event: { executionContextId: number }): void => {
    this.contexts.delete(event.executionContextId)
  }

  private readonly cleared = (): void => {
    this.contexts.clear()
  }

  private install(): Promise<void> {
    if ((!this.cursor && !this.copy) || this.closed || !this.session) return Promise.resolve()
    const view = this.view
    const epoch = this.epoch
    this.reporter = this.reporter
      .then(async () => {
        const session = this.session
        if (this.closed || !session || !view?.active || this.view !== view || this.epoch !== epoch) return
        // Cross-origin navigations invalidate prior script IDs in Chromium; clear before removing so install recovers.
        const previous = this.script
        this.script = undefined
        if (previous) {
          await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: previous }).catch(() => undefined)
        }
        const parts = [
          `(${reporter.toString()})(${JSON.stringify(BINDING)}, ${epoch}, ${JSON.stringify([...CURSORS])})`,
          `(${suppressOverscroll.toString()})()`,
          ...(this.copy ? [clipboardBridgeScript(this.copyChannel, COPY_BINDING, epoch)] : []),
        ]
        const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
          source: parts.join(";"),
          worldName: WORLD,
          runImmediately: true,
        })
        this.script = result.identifier
      })
      .catch(() => this.report("cursor reporter setup failed"))
    return this.reporter
  }

  private readonly pointed = (event: { name: string; payload: string; executionContextId: number }): void => {
    if (this.closed || !this.contexts.has(event.executionContextId)) return
    if (event.name === COPY_BINDING) {
      this.copied(event.payload)
      return
    }
    if (event.name !== BINDING) return
    this.synchronize()
    const view = this.casting
    if (!view?.active || this.view !== view || typeof event.payload !== "string" || event.payload.length > 64) return
    const prefix = `${this.epoch}:`
    if (!event.payload.startsWith(prefix)) return
    const cursor = event.payload.slice(prefix.length)
    if (!CURSORS.has(cursor) || cursor === this.keyword) return
    this.keyword = cursor
    this.cursor?.({
      browserId: this.scope.browserId,
      navigation: this.scope.navigation,
      revision: view.revision,
      cursor,
    })
  }

  private armCopy(input: BrowserInteraction): void {
    if ((input.kind === "pointer" && input.action !== "move") || (input.kind === "key" && input.action === "down")) {
      this.copyArmedUntil = Date.now() + 1500
    }
  }

  private copied(payload: string): void {
    if (!this.copy || Date.now() > this.copyArmedUntil) return
    this.synchronize()
    const view = this.casting
    if (!view?.active || this.view !== view || typeof payload !== "string") return
    const prefix = `${this.epoch}:`
    if (!payload.startsWith(prefix)) return
    const value = payload.slice(prefix.length)
    if (!value.length || !text(value, TEXT)) return
    this.copyArmedUntil = 0
    this.copy({ browserId: this.scope.browserId, navigation: this.scope.navigation, revision: view.revision }, value)
  }

  private async stop(): Promise<void> {
    this.casting = undefined
    await this.capture?.stop()
    if (!this.started || !this.session) return
    this.started = false
    await this.session.send("Page.stopScreencast")
  }

  private rebind(): void {
    const view = this.casting
    if (!this.capture || this.started || !view || this.view !== view || this.closed) return
    const epoch = this.epoch
    void this.serial(async () => {
      if (this.epoch === epoch) await this.start(view)
    }).catch(() => this.report("capture restart failed"))
  }

  private async start(view: BrowserViewport): Promise<void> {
    const session = this.session
    if (!session || this.closed || this.view !== view || this.casting !== view || this.started) return
    const epoch = this.epoch
    if (this.capture?.enabled) {
      const handled = await this.capture.start(session, view, this.scope, (pixels) => {
        this.synchronize()
        if (this.epoch === epoch) this.frame(pixels, view)
      })
      if (handled || this.epoch !== epoch) return
    }
    if (this.capture) this.report("using host capture")
    this.started = true
    await session.send("Page.startScreencast", screencast(view))
  }

  private readonly receive = (event: Cast): void => {
    const session = this.session
    if (!session) return
    void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {
      if (!this.closed) this.report("frame acknowledgement failed")
    })
    const view = this.casting
    if (!this.started || this.closed || !view || this.view !== view) return
    this.synchronize()
    const pixels = this.decode(event, view)
    if (pixels) this.frame(pixels, view)
  }

  private frame(pixels: Pixels, view: BrowserViewport): void {
    // Explicit navigation announces its identity before the new document commits.
    if (this.scope.committed !== undefined && this.scope.committed !== this.scope.navigation) return
    const frame: BrowserFrame = {
      browserId: this.scope.browserId,
      navigation: this.scope.navigation,
      revision: view.revision,
      sequence: ++this.sequence,
      ...pixels,
    }
    if (this.outstanding !== undefined) {
      this.buffered = frame
      return
    }
    this.deliver(frame)
  }

  private deliver(frame: BrowserFrame): void {
    this.outstanding = frame.sequence
    try {
      this.emit(frame)
    } catch {
      if (this.outstanding === frame.sequence) this.outstanding = undefined
      this.report("frame delivery failed")
    }
  }

  private coordinates(event: { x: number; y: number; modifiers: number }, view: BrowserViewport): void {
    this.x = Math.min(view.width - 1, event.x * view.width)
    this.y = Math.min(view.height - 1, event.y * view.height)
    this.modifiers = event.modifiers
  }

  private async point(session: CDPSession, event: Pointer, view: BrowserViewport): Promise<void> {
    this.coordinates(event, view)
    this.buttons |= event.buttons
    if (event.action === "down") this.buttons |= BUTTONS[event.button]
    if (event.action === "up") this.buttons &= ~BUTTONS[event.button]
    const sent = session.send("Input.dispatchMouseEvent", {
      type: event.action === "move" ? "mouseMoved" : event.action === "down" ? "mousePressed" : "mouseReleased",
      x: this.x,
      y: this.y,
      button: event.action === "move" && !this.buttons ? "none" : event.button,
      buttons: this.buttons,
      clickCount: event.clicks,
      modifiers: this.modifiers,
    })
    if (event.action === "move") return this.dispatch(sent)
    await sent
  }

  // Chrome answers a mouse move or wheel event only after the page renders the next frame. Waiting for that answer
  // limits input to the frame rate, so input from a display with a higher refresh rate lags more and more. CDP keeps
  // the event order, and Chrome merges these events while the page is busy, so they do not wait for the answer.
  private dispatch(sent: Promise<unknown>): void {
    void sent.catch(() => {
      if (!this.closed) this.report("mouse input failed")
    })
  }

  private async clipboard(
    action: Clipboard,
    epoch: number,
    value?: string,
    write?: (text: string) => void | Promise<void>,
  ): Promise<string | undefined> {
    let frame = this.page.mainFrame()
    while (!this.closed) {
      this.synchronize()
      if (this.epoch !== epoch) return
      const result = await frame.evaluate(selection, { action, limit: TEXT, text: value })
      this.synchronize()
      if (this.closed || this.epoch !== epoch) return
      if (result.focused) {
        const copied = result.text
        if (copied !== undefined && !text(copied, TEXT)) throw new Error("Browser selection exceeds the text limit")
        if (copied === undefined || !write) return copied
        await this.cancellable(() => write(copied))
        this.synchronize()
        if (this.closed || epoch !== this.epoch) return
        return copied
      }
      const handle = await frame.evaluateHandle(() => {
        let node = document.activeElement
        while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement
        return node
      })
      const child = await (handle.asElement()?.contentFrame() ?? Promise.resolve(null)).finally(() => handle.dispose())
      if (!child) return
      frame = child
    }
  }

  private async keyboard(session: CDPSession, event: Key): Promise<void> {
    const id = event.code || event.key
    if (event.action === "down") {
      if (this.keys.size >= 256 && !this.keys.has(id)) throw new Error("Too many pressed browser keys")
      this.keys.set(id, event)
    }
    if (event.action === "up") this.keys.delete(id)
    this.modifiers = event.modifiers
    const enter = event.key === "Enter" && !(event.modifiers & 7)
    const value = event.action === "down" ? (event.text ?? (enter ? "\r" : undefined)) : undefined
    const command = process.platform === "darwin" ? EDITING[`${event.modifiers}:${event.code}`] : undefined
    await session.send("Input.dispatchKeyEvent", {
      type: event.action === "up" ? "keyUp" : value ? "keyDown" : "rawKeyDown",
      key: event.key,
      code: event.code,
      windowsVirtualKeyCode: event.keyCode,
      modifiers: event.modifiers,
      autoRepeat: event.repeat,
      location: location(event),
      isKeypad: event.code.startsWith("Numpad"),
      text: value,
      unmodifiedText: value,
      commands: event.action === "down" && command ? [command] : undefined,
    })
  }

  private async release(): Promise<void> {
    const session = this.session
    if (!session) return
    for (const button of ["left", "middle", "right"] as const) {
      if (!(this.buttons & BUTTONS[button])) continue
      this.buttons &= ~BUTTONS[button]
      await session
        .send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: this.x,
          y: this.y,
          button,
          buttons: this.buttons,
          modifiers: this.modifiers,
          clickCount: 1,
        })
        .catch(() => this.report("mouse release failed"))
    }
    for (const modifier of MODIFIERS) {
      if (!(this.modifiers & modifier.mask) || [...this.keys.values()].some((key) => key.key === modifier.key)) continue
      this.keys.set(modifier.code, { ...modifier, kind: "key", action: "up", modifiers: 0, repeat: false })
    }
    const keys = [...this.keys.values()]
    this.keys.clear()
    for (const key of keys) {
      this.modifiers &= ~(MODIFIERS.find((modifier) => modifier.key === key.key)?.mask ?? 0)
      await session
        .send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: key.key,
          code: key.code,
          windowsVirtualKeyCode: key.keyCode,
          modifiers: this.modifiers,
          location: location(key),
          isKeypad: key.code.startsWith("Numpad"),
        })
        .catch(() => this.report("key release failed"))
    }
    this.modifiers = 0
    if (!this.composing) return
    this.composing = false
    await session
      .send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 })
      .catch(() => this.report("composition release failed"))
  }
}
