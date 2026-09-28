import { createEffect, onCleanup, onMount, type Accessor, type Component } from "solid-js"
import {
  source,
  type BrowserFrame,
  type BrowserInteraction,
  type BrowserViewIdentity,
  type BrowserViewport,
} from "../../src/shared/browser-stream"
import type { BrowserScope, BrowserState, BrowserTransport } from "./types"
import { clicks, clipboard, key, modifiers, pointer, transition, typing, wheel } from "./stream-input"
import "./stream.css"

type Frame = BrowserFrame & { scope: BrowserScope }
type View = { scope: BrowserScope; identity: BrowserViewIdentity; viewport: BrowserViewport }
type Job = { frame: Frame; done: boolean; image?: HTMLImageElement }

let revision = Date.now()

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

function valid(frame: Frame) {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.width <= 8192 &&
    frame.height <= 8192 &&
    frame.width * frame.height <= 16 * 1024 * 1024 &&
    typeof frame.data === "string" &&
    frame.data.length > 0 &&
    frame.data.length <= 16 * 1024 * 1024
  )
}

export const StreamViewport: Component<{
  scope: Accessor<BrowserScope | undefined>
  state: Accessor<BrowserState | undefined>
  transport: BrowserTransport
  label: string
}> = (props) => {
  let host!: HTMLDivElement
  let canvas!: HTMLCanvasElement
  let textarea!: HTMLTextAreaElement
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
  const keyboard = new Map<string, Extract<BrowserInteraction, { kind: "key" }>>()
  const clicker = clicks()
  const text = typing()

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
    job.image?.removeAttribute("src")
    acknowledge(job)
  }

  const release = () => {
    const view = held
    held = undefined
    const composition = text.reset()
    keyboard.clear()
    clicker.reset()
    moving = undefined
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

  const clear = () => {
    release()
    const queued = pending
    pending = undefined
    drop(queued)
    drop(decoding)
    painted = undefined
    sequence = -1
    if (!canvas) return
    canvas.width = 0
    canvas.height = 0
    for (const name of ["browserId", "navigation", "revision", "sequence", "sessionId", "projectId"]) {
      delete canvas.dataset[name]
    }
    host.dataset.ready = "false"
  }

  const blur = () => {
    release()
    textarea.blur()
  }

  const target = () => {
    const scope = props.scope()
    const state = props.state()
    if (!scope || !state || !same(scope, state.scope) || state.status === "closed" || !state.browserId) return
    const navigation = state.navigation
    if (navigation === undefined || !Number.isSafeInteger(navigation) || navigation < 0) return
    return { scope, browserId: state.browserId, navigation, inspecting: state.inspecting }
  }

  const measure = () => {
    const bounds = host.getBoundingClientRect()
    const width = Math.max(0, Math.round(bounds.width))
    const height = Math.max(0, Math.round(bounds.height))
    const visible = !host.checkVisibility || host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const active = intersecting && document.visibilityState !== "hidden" && visible && width > 0 && height > 0
    return {
      width: width || current?.viewport.width || 1,
      height: height || current?.viewport.height || 1,
      scale: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
      active,
    }
  }

  const sync = () => {
    const next = target()
    if (disposed || !mounted) return
    const previous = current
    if (!next) {
      current = undefined
      clear()
      if (previous) publish(previous, { ...previous.viewport, revision: ++revision, active: false })
      host.dataset.active = "false"
      host.setAttribute("aria-busy", "false")
      textarea.blur()
      return
    }
    const viewport = measure()
    const unchanged =
      previous &&
      same(previous.scope, next.scope) &&
      previous.identity.browserId === next.browserId &&
      previous.identity.navigation === next.navigation
    if (
      unchanged &&
      previous.viewport.width === viewport.width &&
      previous.viewport.height === viewport.height &&
      previous.viewport.scale === viewport.scale &&
      previous.viewport.active === viewport.active
    ) {
      if (next.inspecting) release()
      return
    }
    clear()
    if (previous && !unchanged) publish(previous, { ...previous.viewport, revision: ++revision, active: false })
    const version = ++revision
    current = {
      scope: { ...next.scope },
      identity: { browserId: next.browserId, navigation: next.navigation, revision: version },
      viewport: { ...viewport, revision: version },
    }
    host.dataset.active = String(viewport.active)
    host.setAttribute("aria-busy", String(viewport.active))
    if (!unchanged || !viewport.active) textarea.blur()
    publish(current)
  }

  const bound = (frame: Frame) => current && same(current.scope, frame.scope) && matches(frame, current.identity)

  const ready = () => {
    sync()
    if (!current?.viewport.active || !painted || !matches(painted, current.identity) || props.state()?.inspecting)
      return
    return current
  }

  const focused = () => document.activeElement === textarea && ready()

  const emit = (event: BrowserInteraction) => {
    const view = ready()
    if (!view) return false
    held = view
    props.transport.send({ type: "interact", scope: view.scope, identity: view.identity, event })
    return true
  }

  const draw = async (job: Job, data: string) => {
    const image = new Image()
    job.image = image
    image.decoding = "async"
    try {
      image.src = data
      await image.decode()
      sync()
      if (disposed || job.done || !bound(job.frame) || !current?.viewport.active || pending) return
      const context = canvas.getContext("2d")
      if (!context || !image.naturalWidth || !image.naturalHeight) return
      const frame = job.frame
      if (canvas.width !== frame.width) canvas.width = frame.width
      if (canvas.height !== frame.height) canvas.height = frame.height
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      painted = identity(frame)
      canvas.dataset.browserId = frame.browserId
      canvas.dataset.navigation = String(frame.navigation)
      canvas.dataset.revision = String(frame.revision)
      canvas.dataset.sequence = String(frame.sequence)
      canvas.dataset.sessionId = frame.scope.sessionId
      delete canvas.dataset.projectId
      if (frame.scope.projectId !== undefined) canvas.dataset.projectId = frame.scope.projectId
      host.dataset.ready = "true"
      host.setAttribute("aria-busy", "false")
    } catch (error) {
      if (!disposed && !job.done) console.warn("[Kilo New] Browser frame decode failed", error)
    } finally {
      image.removeAttribute("src")
      job.image = undefined
      acknowledge(job)
      decoding = undefined
      if (!disposed) drain()
    }
  }

  const drain = () => {
    if (disposed || decoding || !pending) return
    const job = pending
    pending = undefined
    const data = source(job.frame.data)
    if (!data) {
      drop(job)
      return
    }
    decoding = job
    void draw(job, data)
  }

  const receive = (frame: Frame) => {
    if (disposed) return
    sync()
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
    const event = moving
    moving = undefined
    if (event) emit(event)
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
    moving = pointer(event, canvas.getBoundingClientRect(), "move", 0)
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

  const scroll = (event: WheelEvent) => {
    if (!ready()) return
    const line = Number.parseFloat(getComputedStyle(host).lineHeight) || 16
    const value = wheel(event, canvas.getBoundingClientRect(), line)
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    flush()
    emit(value)
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
    host.addEventListener("wheel", scroll, { passive: false })
    document.addEventListener("visibilitychange", sync)
    window.addEventListener("blur", blur)
    sync()
    onCleanup(() => {
      resize.disconnect()
      intersection.disconnect()
      visibility.disconnect()
      host.removeEventListener("wheel", scroll)
      document.removeEventListener("visibilitychange", sync)
      window.removeEventListener("blur", blur)
    })
  })

  onCleanup(() => {
    disposed = true
    unsubscribe()
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
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          event.stopPropagation()
          focus()
        }}
        onPointerDown={down}
        onPointerMove={move}
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
