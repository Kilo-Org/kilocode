import type { CDPSession, Frame, Page } from "playwright-core"
import type { BrowserFrame, BrowserInteraction, BrowserViewport } from "../../shared/browser-stream"

type Scope = { browserId: string; navigation: number }
type Key = Extract<BrowserInteraction, { kind: "key" }>
type Pointer = Extract<BrowserInteraction, { kind: "pointer" }>
type Wheel = Extract<BrowserInteraction, { kind: "wheel" }>
type Clipboard = Extract<BrowserInteraction, { kind: "clipboard" }>["action"]
type Cast = {
  sessionId: number
  data: string
  metadata: { deviceWidth: number; deviceHeight: number }
}

const PAYLOAD = 2 * 1024 * 1024
const TEXT = 64 * 1024
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

function dimensions(value: string): { width: number; height: number } | undefined {
  const data = Buffer.from(value, "base64")
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

function position(event: { x: number; y: number; modifiers: number }): boolean {
  return range(event.x, 0, 1) && range(event.y, 0, 1) && range(event.modifiers, 0, 15, true)
}

function merge(current: Wheel, next: Wheel): boolean {
  if (current.x !== next.x || current.y !== next.y || current.modifiers !== next.modifiers) return false
  for (const axis of ["deltaX", "deltaY"] as const) {
    if (Math.sign(current[axis]) !== Math.sign(next[axis])) return false
    if (!range(current[axis] + next[axis], -10000, 10000)) return false
  }
  current.deltaX += next.deltaX
  current.deltaY += next.deltaY
  return true
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

export class BrowserStream {
  private session?: CDPSession
  private view?: BrowserViewport
  private casting?: BrowserViewport
  private scope: Scope
  private epoch = 0
  private sequence = 0
  private outstanding?: number
  private buffered?: BrowserFrame
  private pending: Promise<void> = Promise.resolve()
  private cancel?: () => void
  private wheel?: { event: Wheel; result: Promise<string | undefined> }
  private closing?: Promise<void>
  private closed = false
  private started = false
  private buttons = 0
  private modifiers = 0
  private x = 0
  private y = 0
  private composing = false
  private readonly keys = new Map<string, Key>()

  constructor(
    private readonly page: Page,
    private readonly identity: () => Scope,
    private readonly emit: (frame: BrowserFrame) => void,
    private readonly log: (...args: unknown[]) => void,
  ) {
    this.scope = { ...identity() }
    page.on("close", this.ended)
    page.on("framenavigated", this.navigated)
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
    const width = Math.max(32, Math.min(4096, Math.round(view.width)))
    const height = Math.max(32, Math.min(2160, Math.round(view.height)))
    const next = suspend
      ? { ...current, active: false }
      : {
          width,
          height,
          scale: Math.max(1, Math.min(view.scale ?? 1, 2, 4096 / width, 2160 / height)),
          revision: view.revision,
          active: view.active,
        }
    this.view = next
    this.reset()
    await this.serial(async () => {
      if (this.closed || this.view !== next) return
      const session = await this.connect()
      if (this.closed || this.view !== next) return
      await this.stop()
      await this.release()
      if (this.closed || this.view !== next || suspend) return
      await this.page.setViewportSize({ width: next.width, height: next.height })
      if (this.closed || this.view !== next || !next.active) return
      this.casting = next
      this.started = true
      await session.send("Page.startScreencast", {
        format: "jpeg",
        quality: 90,
        maxWidth: Math.round(next.width * (next.scale ?? 1)),
        maxHeight: Math.round(next.height * (next.scale ?? 1)),
        everyNthFrame: 1,
      })
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
          await this.point(session, input, view)
          return
        case "wheel":
          this.coordinates(input, view)
          await session.send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: this.x,
            y: this.y,
            modifiers: this.modifiers,
            buttons: this.buttons,
            deltaX: input.deltaX,
            deltaY: input.deltaY,
          })
          return
        case "key":
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
    if (event.kind !== "wheel" || !queued || !merge(queued.event, event)) return
    this.wheel = queued
    return queued.result
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.reset()
    this.page.off("close", this.ended)
    this.page.off("framenavigated", this.navigated)
    this.closing = this.serial(async () => {
      await this.release()
      const session = this.session
      if (!session) return
      await this.stop().catch(() => this.report("stop failed"))
      session.off("Page.screencastFrame", this.receive)
      this.session = undefined
      await session.detach().catch(() => this.report("detach failed"))
    })
    return this.closing
  }

  private readonly ended = (): void => {
    void this.close().catch(() => this.report("close failed"))
  }

  private readonly navigated = (frame: Frame): void => {
    if (this.closed || frame !== this.page.mainFrame()) return
    this.synchronize()
    this.reset()
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
    this.log(`[Kilo New] Browser stream ${message}`)
  }

  private reset(): void {
    this.epoch++
    this.cancel?.()
    this.cancel = undefined
    this.wheel = undefined
    this.outstanding = undefined
    this.buffered = undefined
  }

  private synchronize(): void {
    const scope = this.identity()
    if (scope.browserId === this.scope.browserId && scope.navigation === this.scope.navigation) return
    this.scope = { ...scope }
    this.reset()
  }

  private async connect(): Promise<CDPSession> {
    if (this.session) return this.session
    const session = await this.page.context().newCDPSession(this.page)
    this.session = session
    session.on("Page.screencastFrame", this.receive)
    if (!this.closed) await session.send("Page.enable")
    return session
  }

  private async stop(): Promise<void> {
    this.casting = undefined
    if (!this.started || !this.session) return
    this.started = false
    await this.session.send("Page.stopScreencast")
  }

  private readonly receive = (event: Cast): void => {
    const session = this.session
    if (!session) return
    void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {
      if (!this.closed) this.report("frame acknowledgement failed")
    })
    const view = this.casting
    if (this.closed || !view || this.view !== view) return
    this.synchronize()
    if (
      typeof event.data !== "string" ||
      !event.data.length ||
      event.data.length > Math.ceil(PAYLOAD / 3) * 4 ||
      Buffer.byteLength(event.data, "base64") > PAYLOAD ||
      event.metadata.deviceWidth !== view.width ||
      event.metadata.deviceHeight !== view.height
    )
      return
    const size = dimensions(event.data)
    if (
      !size ||
      !size.width ||
      !size.height ||
      Math.abs(size.width - Math.round(view.width * (view.scale ?? 1))) > 1 ||
      Math.abs(size.height - Math.round(view.height * (view.scale ?? 1))) > 1
    )
      return
    const frame: BrowserFrame = {
      ...this.scope,
      revision: view.revision,
      sequence: ++this.sequence,
      width: size.width,
      height: size.height,
      data: event.data,
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
    await session.send("Input.dispatchMouseEvent", {
      type: event.action === "move" ? "mouseMoved" : event.action === "down" ? "mousePressed" : "mouseReleased",
      x: this.x,
      y: this.y,
      button: event.action === "move" && !this.buttons ? "none" : event.button,
      buttons: this.buttons,
      clickCount: event.clicks,
      modifiers: this.modifiers,
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
