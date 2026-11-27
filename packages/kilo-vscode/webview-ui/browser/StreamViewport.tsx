import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor, type Component } from "solid-js"
import {
  CURSORS,
  mergeWheel,
  sameWheel,
  VIEWPORT_LIMIT,
  type BrowserFrame,
  type BrowserInteraction,
  type BrowserViewIdentity,
  type BrowserViewport,
} from "../../src/shared/browser-stream"
import type { BrowserPosition, BrowserScope, BrowserState, BrowserTransport } from "./types"
import { DirectStream } from "./direct-stream"
import { clicks, clipboard, key, modifiers, pointer, transition, typing, wheel } from "./stream-input"
import "./stream.css"

type Frame = BrowserFrame & { scope: BrowserScope }
type View = { scope: BrowserScope; identity: BrowserViewIdentity; viewport: BrowserViewport }
type Job = { frame: Frame; done: boolean }

let revision = Date.now()
const SETTLE = 300

function same(scope: BrowserScope, value: BrowserScope) {
  return scope.sessionId === value.sessionId && scope.projectId === value.projectId
}

function matches(value: BrowserViewIdentity, identity: BrowserViewIdentity) {
  return (
    value.browserId === identity.browserId &&
    value.navigation === identity.navigation &&
    value.revision === identity.revision
  )
}

function identity(frame: BrowserViewIdentity): BrowserViewIdentity {
  return { browserId: frame.browserId, navigation: frame.navigation, revision: frame.revision }
}

function fits(view: BrowserViewport, next: Omit<BrowserViewport, "revision">) {
  return (
    view.width === next.width && view.height === next.height && view.scale === next.scale && view.active === next.active
  )
}

function valid(frame: Frame) {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.width <= 8192 &&
    frame.height <= 8192 &&
    frame.width * frame.height <= 16 * 1024 * 1024 &&
    frame.data instanceof ArrayBuffer &&
    frame.data.byteLength > 0 &&
    frame.data.byteLength <= 2 * 1024 * 1024
  )
}

export const StreamViewport: Component<{
  scope: Accessor<BrowserScope | undefined>
  state: Accessor<BrowserState | undefined>
  transport: BrowserTransport
  label: string
  inspecting?: Accessor<boolean>
  onScroll?: (position: BrowserPosition) => void
}> = (props) => {
  let host!: HTMLDivElement
  let canvas!: HTMLCanvasElement
  let textarea!: HTMLTextAreaElement
  let ctx: CanvasRenderingContext2D | null | undefined
  let canvasRect: DOMRect | undefined
  let current: View | undefined
  let painted: BrowserViewIdentity | undefined
  let held: View | undefined
  let pending: Job | undefined
  let decoding: Job | undefined
  let sequence = -1
  let mounted = false
  let disposed = false
  let intersecting = false
  let pid: number | undefined
  let scheduled: number | undefined
  let moving: BrowserInteraction | undefined
  let wheeling: Extract<BrowserInteraction, { kind: "wheel" }> | undefined
  let leading: typeof wheeling
  let published = 0
  let deferred: ReturnType<typeof setTimeout> | undefined
  const keyboard = new Map<string, Extract<BrowserInteraction, { kind: "key" }>>()
  const clicker = clicks()
  const text = typing()
  const [cursor, update] = createSignal("default")

  const publish = (view: View, viewport = view.viewport) => {
    props.transport.send({
      type: "viewport",
      scope: view.scope,
      browserId: view.identity.browserId,
      navigation: view.identity.navigation,
      viewport,
    })
  }

  const acknowledge = (job: Job) => {
    if (job.done) return
    job.done = true
    props.transport.send({
      type: "acknowledge",
      scope: job.frame.scope,
      identity: identity(job.frame),
      sequence: job.frame.sequence,
    })
  }

  const drop = (job: Job | undefined) => {
    if (!job) return
    acknowledge(job)
  }

  const release = () => {
    const view = held
    held = undefined
    const composition = text.reset()
    keyboard.clear()
    clicker.reset()
    moving = undefined
    wheeling = undefined
    leading = undefined
    if (scheduled !== undefined) cancelAnimationFrame(scheduled)
    scheduled = undefined
    const captured = pid
    pid = undefined
    if (captured !== undefined && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured)
    if (textarea) textarea.value = ""
    if (!view) return
    if (composition)
      props.transport.send({ type: "interact", scope: view.scope, identity: view.identity, event: composition })
    props.transport.send({ type: "interact", scope: view.scope, identity: view.identity, event: { kind: "release" } })
  }

  // Keep the last image on a resize or a new document of the same page, so the preview does not go blank until the
  // next frame.
  const clear = (keep = false) => {
    update("default")
    release()
    const queued = pending
    pending = undefined
    drop(queued)
    drop(decoding)
    direct.reset()
    painted = undefined
    sequence = -1
    canvasRect = undefined
    if (!canvas || keep) return
    canvas.width = 0
    canvas.height = 0
    canvas.style.removeProperty("width")
    canvas.style.removeProperty("height")
    for (const name of ["browserId", "navigation", "revision", "sequence", "sessionId", "projectId"]) {
      delete canvas.dataset[name]
    }
    host.dataset.ready = "false"
  }

  const blur = () => {
    release()
    textarea.blur()
  }

  type Target = {
    scope: BrowserScope
    browserId: string
    navigation: number
    inspecting?: boolean
    streamUrl?: string
  }

  // Memoize structural stream identity so console logs, title updates, and status ticks never flush layout mid-scroll.
  const target = createMemo<Target | undefined>(
    () => {
      const scope = props.scope()
      const state = props.state()
      if (!scope || !state || !same(scope, state.scope) || state.status === "closed" || !state.browserId) return
      const navigation = state.navigation
      if (navigation === undefined || !Number.isSafeInteger(navigation) || navigation < 0) return
      return {
        scope,
        browserId: state.browserId,
        navigation,
        inspecting: state.inspecting,
        streamUrl: state.streamUrl,
      }
    },
    undefined,
    {
      equals: (prev, next) =>
        prev === next ||
        (!!prev &&
          !!next &&
          same(prev.scope, next.scope) &&
          prev.browserId === next.browserId &&
          prev.navigation === next.navigation &&
          prev.inspecting === next.inspecting &&
          prev.streamUrl === next.streamUrl),
    },
  )

  const inspecting = createMemo(() => Boolean(target()?.inspecting || props.inspecting?.()))

  const restrict = () => {
    if (inspecting() && (held || moving?.kind === "pointer")) release()
  }

  const measure = () => {
    const bounds = host.getBoundingClientRect()
    // Match the host bounds, so a panel larger than the stream limit does not make the frame scale back up.
    const width = Math.max(0, Math.min(VIEWPORT_LIMIT.width, Math.round(bounds.width)))
    const height = Math.max(0, Math.min(VIEWPORT_LIMIT.height, Math.round(bounds.height)))
    const visible = !host.checkVisibility || host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const active = intersecting && document.visibilityState !== "hidden" && visible && width > 0 && height > 0
    return {
      width: width || current?.viewport.width || 1,
      height: height || current?.viewport.height || 1,
      scale: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
      active,
    }
  }

  const connectDirect = (active: boolean) => {
    direct.connect(active ? target()?.streamUrl : undefined)
  }

  const sync = () => {
    const next = target()
    if (disposed || !mounted) return
    const previous = current
    if (!next) {
      current = undefined
      connectDirect(false)
      clear()
      if (previous) publish(previous, { ...previous.viewport, revision: ++revision, active: false })
      host.dataset.active = "false"
      host.setAttribute("aria-busy", "false")
      textarea.blur()
      return
    }
    const viewport = measure()
    canvasRect = undefined
    const page = previous && same(previous.scope, next.scope) && previous.identity.browserId === next.browserId
    const unchanged = page && previous.identity.navigation === next.navigation
    if (unchanged && fits(previous.viewport, viewport)) {
      connectDirect(viewport.active)
      restrict()
      return
    }
    if (unchanged && hold(previous, viewport.active)) return
    // Keep the last painted image across worktree switches for the same document
    // (`unchanged`) and live same-page navigations (`page && viewport.active`),
    // while clearing stale screenshots if a new document navigated while hidden.
    clear(unchanged || (page && viewport.active))
    if (previous && !unchanged) publish(previous, { ...previous.viewport, revision: ++revision, active: false })
    const version = ++revision
    current = {
      scope: { ...next.scope },
      identity: { browserId: next.browserId, navigation: next.navigation, revision: version },
      viewport: { ...viewport, revision: version },
    }
    connectDirect(viewport.active)
    host.dataset.active = String(viewport.active)
    host.setAttribute("aria-busy", String(viewport.active))
    if (!page || !viewport.active) textarea.blur()
    published = performance.now()
    publish(current)
  }

  // Each size restarts the stream. During a continuous resize, send the next size only after the page painted the
  // last one, so the preview follows the resize instead of waiting for it to end.
  const hold = (view: View, active: boolean) => {
    const wait = SETTLE - (performance.now() - published)
    if (!view.viewport.active || !active || painted || wait <= 0) return false
    deferred ??= setTimeout(resume, wait)
    return true
  }

  const resume = () => {
    clearTimeout(deferred)
    deferred = undefined
    sync()
  }

  const bound = (frame: Frame) => current && same(current.scope, frame.scope) && matches(frame, current.identity)

  const ready = (input = true) => {
    sync()
    if (!current?.viewport.active || !painted || !matches(painted, current.identity) || (input && inspecting())) return
    return current
  }

  const focused = () => document.activeElement === textarea && ready()

  const emit = (event: BrowserInteraction) => {
    const view = ready(event.kind !== "wheel")
    if (!view) return false
    if (event.kind !== "wheel") held = view
    props.transport.send({ type: "interact", scope: view.scope, identity: view.identity, event })
    if (event.kind === "wheel" && inspecting()) {
      const bounds = canvas.getBoundingClientRect()
      props.onScroll?.({ x: event.x, y: event.y, width: bounds.width, height: bounds.height })
    }
    return true
  }

  // Keep the image at its page size. A resize then shows or hides the page edge, like a native browser, and does not
  // stretch the text until the next frame.
  const fit = (viewport: BrowserViewport) => {
    const width = `${viewport.width}px`
    const height = `${viewport.height}px`
    if (canvas.style.width !== width) canvas.style.width = width
    if (canvas.style.height !== height) canvas.style.height = height
    canvasRect = undefined
  }

  const present = (
    source: CanvasImageSource,
    meta: {
      width: number
      height: number
      browserId: string
      navigation: number
      revision: number
      sequence: number
      scope: BrowserScope
    },
  ) => {
    if (disposed || !current?.viewport.active) return
    const context = ctx ?? (ctx = canvas.getContext("2d", { alpha: false }))
    if (!context) return
    if (canvas.width !== meta.width) canvas.width = meta.width
    if (canvas.height !== meta.height) canvas.height = meta.height
    context.drawImage(source, 0, 0)
    canvas.dataset.sequence = String(meta.sequence)
    if (painted) return
    fit(current.viewport)
    painted = identity(meta)
    canvas.dataset.browserId = meta.browserId
    canvas.dataset.navigation = String(meta.navigation)
    canvas.dataset.revision = String(meta.revision)
    canvas.dataset.sessionId = meta.scope.sessionId
    delete canvas.dataset.projectId
    if (meta.scope.projectId !== undefined) canvas.dataset.projectId = meta.scope.projectId
    host.dataset.ready = "true"
    host.setAttribute("aria-busy", "false")
    if (deferred !== undefined) resume()
  }

  const direct = new DirectStream(
    (meta) =>
      !disposed &&
      !!current?.viewport.active &&
      current.identity.navigation === meta.navigation &&
      current.identity.revision === meta.revision,
    (source, meta) => {
      if (!current) return
      present(source, { ...meta, browserId: current.identity.browserId, scope: current.scope })
    },
  )

  // After a frame, send a size that waited for it, then draw the newest frame.
  const proceed = () => {
    if (deferred !== undefined && painted) resume()
    drain()
  }

  const draw = async (job: Job) => {
    let image: ImageBitmap | undefined
    try {
      image = await createImageBitmap(new Blob([job.frame.data], { type: "image/jpeg" }))
      if (disposed || job.done || !bound(job.frame) || !current?.viewport.active || pending) return
      present(image, job.frame)
    } catch (error) {
      if (!disposed && !job.done) console.warn("[Kilo] Browser frame decode failed", error)
    } finally {
      image?.close()
      acknowledge(job)
      decoding = undefined
      if (!disposed) proceed()
    }
  }

  const drain = () => {
    if (disposed || decoding || !pending) return
    const job = pending
    pending = undefined
    decoding = job
    void draw(job)
  }

  const receive = (frame: Frame) => {
    if (disposed) return
    if (!bound(frame) || !Number.isSafeInteger(frame.sequence) || frame.sequence < 0) return
    if (
      (decoding && !decoding.done && decoding.frame.sequence === frame.sequence) ||
      pending?.frame.sequence === frame.sequence
    )
      return
    const job = { frame, done: false }
    if (frame.sequence <= sequence) {
      drop(job)
      return
    }
    sequence = frame.sequence
    if (!current?.viewport.active || !valid(frame)) {
      drop(job)
      return
    }
    const queued = pending
    pending = job
    drop(queued)
    drain()
  }

  const flush = () => {
    if (scheduled !== undefined) cancelAnimationFrame(scheduled)
    scheduled = undefined
    const queue = [wheeling, moving]
    wheeling = undefined
    leading = undefined
    moving = undefined
    for (const event of queue) if (event) emit(event)
  }

  const focus = () => {
    if (!ready()) return false
    textarea.focus({ preventScroll: true })
    return true
  }

  const down = (event: PointerEvent) => {
    if (!event.isPrimary || (pid !== undefined && pid !== event.pointerId) || !ready()) return
    const value = pointer(event, canvas.getBoundingClientRect(), "down", clicker.down(event))
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    flush()
    focus()
    if (!emit(value)) return
    pid = event.pointerId
    canvas.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent) => {
    if (!event.isPrimary || (pid !== undefined && pid !== event.pointerId) || !ready()) return
    const action = transition(event)
    if (action === "down") return down(event)
    if (action === "up") return up(event)
    clicker.move(event)
    const rect = canvasRect ?? (canvasRect = canvas.getBoundingClientRect())
    moving = pointer(event, rect, "move", 0)
    if (!moving || scheduled !== undefined) return
    scheduled = requestAnimationFrame(flush)
  }

  const up = (event: PointerEvent) => {
    if (pid !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    flush()
    const value = pointer(event, canvas.getBoundingClientRect(), "up", clicker.up())
    if (value) emit(value)
    if (event.buttons & 7) return
    pid = undefined
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }

  const cancel = (event: PointerEvent) => {
    if (pid === event.pointerId) release()
  }

  const sendDirectWheel = (value: Extract<BrowserInteraction, { kind: "wheel" }>, rect: DOMRect): boolean => {
    if (!current || moving || wheeling) return false
    const sent = direct.sendWheel({
      navigation: current.identity.navigation,
      revision: current.identity.revision,
      x: value.x,
      y: value.y,
      deltaX: value.deltaX,
      deltaY: value.deltaY,
      modifiers: value.modifiers,
    })
    if (sent && inspecting()) props.onScroll?.({ x: value.x, y: value.y, width: rect.width, height: rect.height })
    return sent
  }

  const scroll = (event: WheelEvent) => {
    if (!current?.viewport.active || !painted) return
    if (event.target instanceof Element && event.target.closest(".am-browser-error-overlay")) return
    const line = event.deltaMode === 1 ? Number.parseFloat(getComputedStyle(host).lineHeight) || 16 : 16
    const rect = canvasRect ?? (canvasRect = canvas.getBoundingClientRect())
    const value = wheel(event, rect, line)
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    if (sendDirectWheel(value, rect)) return
    // Send the leading wheel delta immediately. Batch the rest of the burst until the next refresh.
    // A reversal or a different scroll target starts a new burst, even before the scheduled refresh.
    if (moving || (leading && !sameWheel(leading, value))) flush()
    if (!leading) {
      if (emit(value)) {
        leading = value
        scheduled ??= requestAnimationFrame(flush)
      }
      return
    }
    if (wheeling && mergeWheel(wheeling, value)) return
    // Flush a full batch before it would exceed the limit on a single wheel delta.
    if (wheeling) emit(wheeling)
    wheeling = value
  }

  const press = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === "Escape" && event.shiftKey && !event.isComposing && !text.active()) {
      event.preventDefault()
      blur()
      canvas.focus({ preventScroll: true })
      return
    }
    if (!focused()) {
      event.preventDefault()
      return
    }
    const action = clipboard(event)
    if (action) {
      event.preventDefault()
      if (!event.repeat) emit({ kind: "clipboard", action })
      return
    }
    if (text.active()) return
    text.prepare(event)
    const value = key(event, "down")
    if (!value) return
    event.preventDefault()
    flush()
    if (emit(value)) keyboard.set(event.code || event.key, value)
  }

  const lift = (event: KeyboardEvent) => {
    event.stopPropagation()
    const name = event.code || event.key
    const value = keyboard.get(name)
    if (!value) return
    event.preventDefault()
    keyboard.delete(name)
    emit({ ...value, action: "up", repeat: false, modifiers: modifiers(event) })
  }

  const transfer = (event: ClipboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const action = event.type === "copy" ? "copy" : event.type === "cut" ? "cut" : "paste"
    if (focused()) emit({ kind: "clipboard", action })
  }

  const before = (event: InputEvent) => {
    event.stopPropagation()
    if (!focused()) {
      event.preventDefault()
      return
    }
    if (event.isComposing || text.active()) return
    if (event.inputType === "insertFromPaste" || event.inputType === "deleteByCut") {
      event.preventDefault()
      emit({ kind: "clipboard", action: event.inputType === "deleteByCut" ? "cut" : "paste" })
      return
    }
    if (event.inputType === "insertFromDrop") {
      event.preventDefault()
      return
    }
    const strokes: Record<string, { key: string; code: string; keyCode: number }> = {
      insertLineBreak: { key: "Enter", code: "Enter", keyCode: 13 },
      insertParagraph: { key: "Enter", code: "Enter", keyCode: 13 },
      deleteContentBackward: { key: "Backspace", code: "Backspace", keyCode: 8 },
      deleteContentForward: { key: "Delete", code: "Delete", keyCode: 46 },
    }
    const stroke = strokes[event.inputType]
    if (!stroke) return
    event.preventDefault()
    emit({ kind: "key", action: "down", ...stroke, modifiers: 0, repeat: false })
    emit({ kind: "key", action: "up", ...stroke, modifiers: 0, repeat: false })
  }

  const input = (event: InputEvent) => {
    event.stopPropagation()
    const value = focused() ? text.input(event, textarea.value) : undefined
    if (!text.active() && !event.isComposing) textarea.value = ""
    if (value) emit(value)
  }

  const compose = (event: CompositionEvent) => {
    event.stopPropagation()
    if (!focused()) return
    const value =
      event.type === "compositionstart"
        ? text.start()
        : event.type === "compositionupdate"
          ? text.update(event.data)
          : text.end(event.data)
    if (value) emit(value)
    if (event.type === "compositionend") textarea.value = ""
  }

  const unsubscribe = props.transport.subscribe((event) => {
    if (event.type === "frame") receive(event.value)
    if (event.type !== "cursor" || disposed) return
    sync()
    const value = event.value
    if (!current?.viewport.active || !same(current.scope, value.scope) || !matches(value, current.identity)) return
    if (CURSORS.has(value.cursor)) update(value.cursor)
  })

  createEffect(sync)

  onMount(() => {
    mounted = true
    const resize = new ResizeObserver(sync)
    const intersection = new IntersectionObserver((entries) => {
      const entry = entries.find((entry) => entry.target === host)
      if (!entry) return
      intersecting = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
      sync()
    })
    const visibility = new MutationObserver(sync)
    for (let node: HTMLElement | null = host; node; node = node.parentElement) {
      visibility.observe(node, { attributes: true, attributeFilter: ["class", "style", "hidden"] })
    }
    resize.observe(host, { box: "device-pixel-content-box" })
    intersection.observe(host)
    const viewport = host.parentElement ?? host
    viewport.addEventListener("wheel", scroll, { passive: false })
    viewport.addEventListener("pointerdown", flush, true)
    viewport.addEventListener("pointerleave", flush)
    document.addEventListener("visibilitychange", sync)
    const invalidate = () => {
      canvasRect = undefined
    }
    window.addEventListener("resize", invalidate)
    window.addEventListener("blur", blur)
    sync()
    onCleanup(() => {
      resize.disconnect()
      intersection.disconnect()
      visibility.disconnect()
      viewport.removeEventListener("wheel", scroll)
      viewport.removeEventListener("pointerdown", flush, true)
      viewport.removeEventListener("pointerleave", flush)
      document.removeEventListener("visibilitychange", sync)
      window.removeEventListener("resize", invalidate)
      window.removeEventListener("blur", blur)
    })
  })

  onCleanup(() => {
    disposed = true
    clearTimeout(deferred)
    unsubscribe()
    direct.dispose()
    clear()
    textarea.blur()
    if (current) publish(current, { ...current.viewport, revision: ++revision, active: false })
    current = undefined
  })

  return (
    <div ref={host} class="am-browser-stream" data-ready="false" data-active="false">
      <canvas
        ref={canvas}
        width={0}
        height={0}
        tabIndex={0}
        role="img"
        aria-label={props.label}
        aria-description="Press Enter to interact. Press Shift+Escape to leave page input, then Shift+Tab to return to the toolbar."
        aria-keyshortcuts="Enter"
        style={{ cursor: inspecting() ? "crosshair" : cursor() }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          event.stopPropagation()
          focus()
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerLeave={() => update("default")}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onDblClick={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
      />
      <textarea
        ref={textarea}
        class="am-browser-stream-input"
        tabIndex={-1}
        aria-label={props.label}
        aria-keyshortcuts="Shift+Escape"
        aria-description="Press Shift+Escape to leave page input, then Shift+Tab to return to the toolbar."
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        onKeyDown={press}
        onKeyUp={lift}
        onBeforeInput={before}
        onInput={input}
        onCompositionStart={compose}
        onCompositionUpdate={compose}
        onCompositionEnd={compose}
        onCopy={transfer}
        onCut={transfer}
        onPaste={transfer}
        onBlur={release}
      />
    </div>
  )
}
