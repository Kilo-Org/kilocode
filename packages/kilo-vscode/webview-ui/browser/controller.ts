import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { BrowserReference } from "../../src/shared/browser-feedback"
import type {
  BrowserCommand,
  BrowserEvent,
  BrowserInspection,
  BrowserPosition,
  BrowserScope,
  BrowserState,
  BrowserTransport,
} from "./types"

export interface BrowserControllerOptions {
  scope: Accessor<BrowserScope | undefined>
  transport: BrowserTransport
  onReference: (reference: BrowserReference) => void
  onClose: () => void
  theme?: Accessor<"dark" | "light">
  schedule?: (callback: FrameRequestCallback) => number
  cancel?: (frame: number) => void
}

export interface BrowserController {
  url: Accessor<string>
  state: Accessor<BrowserState | undefined>
  selecting: Accessor<boolean>
  pointing: Accessor<boolean>
  hovered: Accessor<BrowserInspection | undefined>
  tools: Accessor<{ browserId: string; url: string } | undefined>
  loading: Accessor<boolean>
  setUrl: (value: string) => void
  open: () => void
  refresh: () => void
  close: () => void
  toggleSelecting: () => void
  toggleTools: () => void
  move: (value: BrowserPosition) => void
  select: (value: BrowserPosition) => void
  dispose: () => void
}

export function createBrowserController(props: BrowserControllerOptions): BrowserController {
  const [url, setUrl] = createSignal("")
  const [selecting, setSelecting] = createSignal(false)
  const [pointing, setPointing] = createSignal(false)
  const [hovered, setHovered] = createSignal<BrowserInspection>()
  const [state, setState] = createSignal<BrowserState>()
  const [tools, setTools] = createSignal<{ browserId: string; url: string }>()
  const scheduleFrame = props.schedule ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback))
  const cancelFrame = props.cancel ?? ((frame: number) => cancelAnimationFrame(frame))
  let frame: number | undefined
  let pending: BrowserPosition | undefined
  let active: string | undefined
  let selected: string | undefined
  let sequence = 0
  let current: BrowserScope | undefined
  let unsubscribe: (() => void) | undefined
  let generation = 0
  let disposed = false

  const stop = () => {
    if (frame !== undefined) cancelFrame(frame)
    frame = undefined
    pending = undefined
    active = undefined
    selected = undefined
    setHovered(undefined)
  }

  const reset = () => {
    stop()
    setState(undefined)
    setUrl("")
    setSelecting(false)
    setPointing(false)
    setTools(undefined)
  }

  const same = (scope: BrowserScope, value: BrowserScope) =>
    scope.sessionId === value.sessionId && scope.projectId === value.projectId

  const send = (command: BrowserCommand) => {
    if (disposed) return
    props.transport.send(command)
  }

  const request = (type: "refresh" | "close" | "state") => {
    sync()
    if (!current) return
    send({ type, scope: current })
  }

  const inspect = (value: BrowserPosition, hover: boolean) => {
    sync()
    if (!current) return
    const requestId = String(++sequence)
    if (hover) active = requestId
    else selected = requestId
    send({ type: "inspect", scope: current, position: value, hover, requestId })
  }

  const input = (value: BrowserPosition, click: boolean) => {
    sync()
    if (!current) return
    send({ type: "input", scope: current, position: value, click })
  }

  const schedule = () => {
    if (frame !== undefined || active || !pending || (!selecting() && !pointing())) return
    frame = scheduleFrame(() => {
      frame = undefined
      const value = pending
      pending = undefined
      if (!value || (!selecting() && !pointing())) return
      if (pointing()) input(value, false)
      inspect(value, true)
    })
  }

  const receiveState = (value: BrowserState) => {
    if (!current || !same(current, value.scope)) return
    const previous = state()
    const changed = value.url !== previous?.url
    if (
      value.browserId !== previous?.browserId ||
      value.navigation !== previous?.navigation ||
      value.status === "closed"
    ) {
      stop()
      setSelecting(false)
    }
    const inspecting = value.status !== "closed" && value.status !== "error" && value.inspecting === true
    if (inspecting !== pointing()) {
      stop()
      setPointing(inspecting)
      if (inspecting) setSelecting(false)
    }
    if (tools()?.browserId !== value.browserId || value.status === "closed") setTools(undefined)
    setState(value)
    if (value.url && changed) setUrl(value.url)
  }

  const receiveInspection = (value: BrowserInspection) => {
    if (!current || !same(current, value.scope)) return
    if (value.hover) {
      if ((!selecting() && !pointing()) || value.requestId !== active) return
      active = undefined
      setHovered(value.error ? undefined : value)
      schedule()
      return
    }
    if (value.requestId !== selected) return
    selected = undefined
    const element = value.element
    if (value.error || !element?.selector) {
      setSelecting(true)
      return
    }
    props.onReference({
      id: crypto.randomUUID(),
      sessionId: current.sessionId,
      selector: element.selector,
      text: element.text,
      url: value.url,
      title: value.title,
      hierarchy: element.hierarchy,
      html: element.html,
      styles: element.styles,
      source: element.source,
    })
    setSelecting(false)
    stop()
  }

  const receive = (event: BrowserEvent) => {
    if (disposed) return
    sync()
    if (!current) return
    if (event.type === "state") return receiveState(event.value)
    if (event.type === "devtools") {
      if (!same(current, event.value.scope) || event.value.browserId !== state()?.browserId) return
      setTools({ browserId: event.value.browserId, url: event.value.url })
      return
    }
    receiveInspection(event.value)
  }

  const attach = (scope: BrowserScope | undefined) => {
    unsubscribe?.()
    unsubscribe = undefined
    generation++
    current = scope ? { ...scope } : undefined
    reset()
    if (!current) return
    const version = generation
    unsubscribe = props.transport.subscribe((event) => {
      if (version !== generation) return
      receive(event)
    })
    send({ type: "state", scope: current })
  }

  const sync = () => {
    if (disposed) return false
    const next = props.scope()
    if (next?.sessionId !== current?.sessionId || next?.projectId !== current?.projectId) attach(next)
    return true
  }
  attach(props.scope())
  createEffect(() => sync())
  const read =
    <T>(value: Accessor<T>): Accessor<T> =>
    () => {
      sync()
      return value()
    }

  const controller: BrowserController = {
    url: read(url),
    state: read(state),
    selecting: read(selecting),
    pointing: read(pointing),
    hovered: read(hovered),
    tools: read(tools),
    loading: read(() => state()?.status === "loading" || state()?.status === "starting"),
    setUrl: (value) => {
      if (!sync()) return
      setUrl(value)
    },
    open: () => {
      if (!sync() || !current) return
      const value = url().trim()
      if (!value) return
      send({ type: "open", scope: current, url: /^https?:\/\//i.test(value) ? value : `http://${value}` })
    },
    refresh: () => request("refresh"),
    close: () => {
      if (!sync()) return
      stop()
      setSelecting(false)
      setPointing(false)
      request("close")
      props.onClose()
    },
    toggleSelecting: () => {
      if (!sync()) return
      const next = !selecting()
      stop()
      setSelecting(next)
    },
    toggleTools: () => {
      if (!sync()) return
      if (tools()) {
        setTools(undefined)
        return
      }
      if (!current) return
      send({
        type: "devtools",
        scope: current,
        theme: props.theme?.() ?? "dark",
      })
    },
    move: (value) => {
      if (!sync()) return
      pending = value
      schedule()
    },
    select: (value) => {
      if (!sync()) return
      stop()
      if (pointing()) {
        input(value, true)
        return
      }
      setSelecting(false)
      inspect(value, false)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe?.()
      unsubscribe = undefined
      reset()
      current = undefined
    },
  }

  onCleanup(controller.dispose)
  return controller
}
