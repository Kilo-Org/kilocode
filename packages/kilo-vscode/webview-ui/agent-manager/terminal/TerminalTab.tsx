/**
 * libghostty (ghostty-web) terminal tab.
 *
 * Mounts a Ghostty WASM Terminal in a ref'd div and streams its PTY through the
 * extension-host relay (`./socket.ts`). Output frames arrive as text (PTY
 * bytes) or binary (control frames with a leading 0x00 byte carrying cursor
 * metadata). The relay forwards them over the panel message channel, which is
 * the only path because the server rejects a browser `Origin` on its PTY
 * connect route.
 */

import { Component, createEffect, onCleanup, onMount } from "solid-js"
import { FitAddon, Terminal, type Ghostty } from "ghostty-web"
import { useBridge } from "../v2/vscode"
import type { InMessage, VSCodeContext } from "../v2/bridge"
import { useLanguage } from "../../src/context/language"
import type { ScriptTerminalStatus, TerminalFont } from "./state"
import { createInputBuffer, createReplayGate, createWriteBatcher } from "./replay"
import { TerminalSocket } from "./socket"
import { registerTerminalOutput, unregisterTerminalOutput } from "./output"
import { createActivityTracker } from "./activity"
import { createOscScanner } from "./osc"
import { createTerminalKeyHandler } from "./keys"
import { readColorScheme, readTerminalTheme } from "./theme"
import {
  createAnimatedCursor,
  createDecscusrScanner,
  type AnimatedCursorController,
} from "./cursor"
import {
  disposeTerminalSafely,
  fitTerminalDirect,
  getLoadedGhostty,
  hoveredLinkText,
  loadGhostty,
  measureHostDimensions,
  optimizeTerminalRenderer,
  pauseTerminalRender,
  readTerminalBuffer,
  redrawTerminal,
  renderTerminalDirty,
  resolveLinkAtClick,
  resumeTerminalRender,
} from "./ghostty"
import type { Activity } from "../v2/activity"
import { repaintMayFocus, terminalActivation } from "../focus"
import { hasPopup } from "../../src/utils/focus"
import {
  APPEND_REVIEW_COMMENTS,
  takeReviewCommentsForTerminal,
  type AppendReviewCommentsDetail,
} from "../../diff-viewer/review-annotations"

interface Props {
  terminalId: string
  /** Terminal font settings forwarded from the extension host. Used on
   *  initial mount; live changes arrive via `agentManager.terminal.fontChanged`. */
  font: TerminalFont
  /** Whether this terminal is currently the focused tab.
   *
   *  Inactive slots are translated off-screen (see the layer / slot CSS
   *  in `terminal/render.tsx` and `agent-manager.css`) and their render
   *  loops are paused until activated, eliminating background rAF and
   *  Canvas overhead while WASM parsing keeps their screen state current. */
  active: boolean
  /** Side terminals only repaint on activation; focus is restored explicitly
   *  when that context's remembered focus owner is the terminal. */
  focusOnActivate?: boolean
  /** Serial of the latest explicit focus request for this terminal
   *  (`state.focusRequest()`), consumed so re-requesting focus on an
   *  already-visible terminal still re-focuses it. */
  focusSerial?: number
  /** Reports DOM focus entering or leaving the terminal host. The state
   *  layer tracks this as `focusedId` so `Cmd+W` can target the
   *  terminal that actually has the cursor. */
  onFocusChange?: (focused: boolean) => void
  /** Handle the Agent Manager prompt shortcut locally because the terminal
   *  textarea does not reliably forward custom commands to the workbench. */
  onFocusPrompt?: () => void
  /** Reports OSC window-title escape codes (`ESC ] 0/2 ; title BEL/ST`)
   *  sent by the shell or running programs. The state layer mirrors it
   *  into the tab label. */
  onTitleChange?: (title: string) => void
  onActivityChange?: (state: Activity) => void
  /** Provider-owned script status (Run/Setup), used to annotate the
   *  output when a script ends in failure. */
  status?: () => ScriptTerminalStatus | undefined
  restartable?: boolean
  /** The PTY does not exist yet; the socket opens when the host reports it created. */
  pending?: boolean
}

interface EarlyMessages {
  createdFont?: TerminalFont
  font?: TerminalFont
  restarted: boolean
}

interface MountedTerminal {
  noteFailure: () => void
  syncActivation: (active: boolean, serial: number) => void
  handleMessage: (message: InMessage) => void
  dispose: () => void
}

/** How long the ResizeObserver waits after the last size change before
 *  posting a `resize` message upstream to the backend PTY. Visual fitting
 *  coalesces to 60fps animation frames; only backend sync is debounced. */
const RESIZE_DEBOUNCE_MS = 100
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

export const TerminalTab: Component<Props> = (props) => {
  const vscode = useBridge()
  const { t } = useLanguage()
  let host!: HTMLDivElement

  const log = (...args: unknown[]) => console.warn(`[Kilo New][Ghostty][${props.terminalId}]`, ...args)

  onMount(() => {
    let closed = false
    let mounted: MountedTerminal | undefined
    const early: EarlyMessages = { restarted: false }

    // Subscribe synchronously before WASM load so an optimistic terminal's
    // `terminal.created` reply can never be missed during a cold start.
    const msgSub = vscode.onMessage((message) => {
      if (mounted) {
        mounted.handleMessage(message)
        return
      }
      if (message.type === "agentManager.terminal.created" && message.terminalId === props.terminalId) {
        early.createdFont = message.font
        return
      }
      if (message.type === "agentManager.terminal.restarted" && message.terminalId === props.terminalId) {
        early.restarted = true
        return
      }
      if (message.type === "agentManager.terminal.fontChanged") {
        early.font = message.font
      }
    })

    const attach = (ghostty: Ghostty) => {
      if (closed) return
      mounted = mountTerminal({ ghostty, host, props, vscode, t, log, early })
      mounted.syncActivation(props.active, props.focusSerial ?? 0)
      mounted.noteFailure()
    }

    createEffect(() => {
      props.status?.()
      mounted?.noteFailure()
    })

    createEffect(() => {
      const now = props.active
      const serial = props.focusSerial ?? 0
      mounted?.syncActivation(now, serial)
    })

    // Hot path: mount synchronously when WASM is already compiled (0ms delay).
    const ready = getLoadedGhostty()
    if (ready) attach(ready)
    else {
      void loadGhostty().then(attach, (error: unknown) => {
        if (!closed) log("Failed to load libghostty WASM", error)
      })
    }

    onCleanup(() => {
      closed = true
      msgSub()
      mounted?.dispose()
      mounted = undefined
    })
  })

  return <div ref={host} class="am-terminal-host" data-terminal-id={props.terminalId} />
}

interface MountContext {
  ghostty: Ghostty
  host: HTMLDivElement
  props: Props
  vscode: VSCodeContext
  t: (key: string) => string
  log: (...args: unknown[]) => void
  early: EarlyMessages
}

function mountTerminal(ctx: MountContext): MountedTerminal {
  const { ghostty, host, props, vscode, t, log, early } = ctx
  let closed = false
  let writing = false
  let user = false
  let lastInputAt = 0

  const initialFont = early.font ?? early.createdFont ?? props.font
  const initialSize = measureHostDimensions(host, initialFont)
  const initialTheme = readTerminalTheme()
  const term = new Terminal({
    ...(initialSize ? { cols: initialSize.cols, rows: initialSize.rows } : {}),
    // PTY output already contains terminal line endings. Converting LF to
    // CRLF here corrupts raw PTY output when a narrow terminal wraps.
    convertEol: false,
    // Handled by our dedicated overlay cursor (smooth glide, breathing fade,
    // 10s idle stop, unfocused hollow outline, DECSCUSR).
    cursorBlink: false,
    cursorStyle: "block",
    fontFamily: initialFont.fontFamily,
    fontSize: initialFont.fontSize,
    scrollback: 5000,
    theme: initialTheme,
    colorScheme: readColorScheme(),
    ghostty,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host)
  const cursor = createAnimatedCursor({ term, host, theme: initialTheme, style: "block", blink: true })
  optimizeTerminalRenderer(term, (pos, viewportY) => cursor.syncFrame(pos, viewportY))
  if (term.wasmTerm) cursor.syncFrame(term.wasmTerm.getCursor(), 0)

  if (!props.active || document.hidden) {
    pauseTerminalRender(term)
    cursor.pause()
  }

  registerTerminalOutput(props.terminalId, () => readTerminalBuffer(term))

  const copyText = (text: string) => {
    if (!text) return
    vscode.postMessage({ type: "agentManager.copyToClipboard", text })
  }

  const markUser = () => {
    user = true
    lastInputAt = performance.now()
    cursor.notifyActivity()
    queueMicrotask(() => {
      user = false
    })
  }

  term.attachCustomKeyEventHandler(
    createTerminalKeyHandler({
      mac,
      hasSelection: () => term.hasSelection(),
      onCopy: () => {
        const text = term.getSelection()
        if (!text) return
        term.copySelection()
        copyText(text)
      },
      onSelectAll: () => term.selectAll(),
      onFocusPrompt: () => props.onFocusPrompt?.(),
      sendInput: (data) => {
        markUser()
        term.input(data, true)
      },
    }),
  )

  const activity = createActivityTracker((state) => {
    props.onActivityChange?.(closed || socket.ended() ? "idle" : state)
  })
  const osc = createOscScanner({
    onTitle: (title) => props.onTitleChange?.(title),
    onOsc777: (data) => activity.handle(data),
    onClipboard: copyText,
  })
  const decscusr = createDecscusrScanner((nextStyle, nextBlink) => cursor.setStyle(nextStyle, nextBlink))
  const batcher = createWriteBatcher((data, callback) => {
    const len = typeof data === "string" ? data.length : data.byteLength
    // ghostty-web's WASM allocator throws RangeError on 0-byte writes; never pass empty chunks.
    if (len > 0) {
      osc.feed(data)
      decscusr.feed(data)
      writing = true
      try {
        term.write(data)
      } finally {
        writing = false
      }
      // Paint dirty rows right inside this turn/frame instead of deferring
      // another full rAF to ghostty-web's render loop (cuts 16ms echo & burst latency).
      if (props.active && !document.hidden) renderTerminalDirty(term)
    }
    // libghostty parses bytes and emits terminal query responses synchronously
    // inside `term.write()`, so complete the batch immediately without waiting
    // on a potentially throttled animation frame.
    callback?.()
  })

  let echoFlushed = false
  let echoFrame: number | undefined
  const consumeInteractiveEcho = (size: number) => {
    if (size > 256 || echoFlushed || performance.now() - lastInputAt >= 120) return false
    echoFlushed = true
    echoFrame = requestAnimationFrame(() => {
      echoFrame = undefined
      echoFlushed = false
    })
    return true
  }

  const socket = createSocketController({
    term,
    props,
    vscode,
    t,
    log,
    batcher,
    clearActivity: activity.clear,
    isClosed: () => closed,
    isWriting: () => writing,
    shouldFlushEcho: consumeInteractiveEcho,
    consumeUser: () => {
      const was = user
      user = false
      return was
    },
  })

  const repaint = createRepaintController({
    term,
    fit,
    host,
    props,
    vscode,
    log,
    cursor,
    isClosed: () => closed,
  })

  const disposeHost = bindHostEvents({
    term,
    host,
    props,
    vscode,
    copyText,
    markUser,
    cursor,
    isClosed: () => closed,
  })
  const disposeKey = term.onKey(markUser)
  const disposeData = term.onData(socket.send)

  const canAttachNow = !props.pending || early.createdFont !== undefined || early.restarted
  let frame: number | undefined
  if (host.clientWidth > 1 && host.clientHeight > 1) {
    repaint.fitNow()
    if (!socket.connected() && canAttachNow) socket.open()
  } else {
    // Host has not been laid out yet; wait one frame so the shell gets real columns.
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (closed) return
      repaint.fitNow()
      if (!socket.connected() && (!props.pending || early.createdFont !== undefined || early.restarted)) socket.open()
    })
  }

  if (typeof document !== "undefined" && "fonts" in document) {
    void document.fonts.ready.then(() => {
      if (closed) return
      term.renderer?.remeasureFont()
      if (props.active && !document.hidden) repaint.scheduleRepaint()
    })
  }

  const handleMessage = (message: InMessage) => {
    if (message.type === "agentManager.terminal.restarted") {
      if (message.terminalId === props.terminalId) socket.restarted()
      return
    }
    if (message.type === "agentManager.terminal.created") {
      if (message.terminalId === props.terminalId && !socket.connected()) {
        term.options.fontFamily = message.font.fontFamily
        term.options.fontSize = message.font.fontSize
        repaint.fitNow()
        repaint.scheduleRepaint()
        socket.open()
      }
      return
    }
    if (message.type === "agentManager.terminal.error" && message.terminalId === props.terminalId) {
      socket.clearRestart()
      return
    }
    if (message.type === "agentManager.terminal.fontChanged") {
      term.options.fontFamily = message.font.fontFamily
      term.options.fontSize = message.font.fontSize
      repaint.scheduleRepaint()
    }
  }

  // Re-apply theme colors and color scheme when VS Code switches themes
  // (body class flips dark/light; root inline style updates CSS tokens for any theme change).
  let lastThemeKey = ""
  const applyTheme = () => {
    const nextTheme = readTerminalTheme()
    const nextScheme = readColorScheme()
    const key = `${nextScheme}:${JSON.stringify(nextTheme)}`
    if (key === lastThemeKey) return
    lastThemeKey = key
    term.options.theme = nextTheme
    term.options.colorScheme = nextScheme
    cursor.setTheme(nextTheme)
    if (props.active && !document.hidden) redrawTerminal(term)
  }
  const themeObserver = new MutationObserver(applyTheme)
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })

  return {
    noteFailure: socket.noteFailure,
    syncActivation: repaint.syncActivation,
    handleMessage,
    dispose: () => {
      closed = true
      activity.dispose()
      osc.clear()
      decscusr.clear()
      batcher.cancel()
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (echoFrame !== undefined) cancelAnimationFrame(echoFrame)
      disposeHost()
      disposeKey.dispose()
      disposeData.dispose()
      themeObserver.disconnect()
      repaint.dispose()
      socket.dispose()
      cursor.dispose()
      unregisterTerminalOutput(props.terminalId)
      disposeTerminalSafely(term)
    },
  }
}

function bindHostEvents(opts: {
  term: Terminal
  host: HTMLDivElement
  props: Props
  vscode: VSCodeContext
  copyText: (text: string) => void
  markUser: () => void
  cursor: AnimatedCursorController
  isClosed: () => boolean
}): () => void {
  const { term, host, props, vscode, copyText, markUser, cursor, isClosed } = opts

  const reportFocus = () => {
    const focused = host.contains(document.activeElement)
    props.onFocusChange?.(focused)
    cursor.setFocused(document.hasFocus() && focused)
  }
  const onFocusIn = () => queueMicrotask(reportFocus)
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return
    queueMicrotask(reportFocus)
  }

  // ghostty-web only focuses its hidden textarea on canvas mousedown; clicking
  // the 8px padding or gap beside the canvas must also focus the textarea.
  const onHostMouseDown = (event: MouseEvent) => {
    if (event.target !== host) return
    event.preventDefault()
    term.focus()
  }

  const onCopy = (event: ClipboardEvent) => {
    if (!term.hasSelection()) return
    const text = term.getSelection()
    if (!text) return
    event.preventDefault()
    event.clipboardData?.setData("text/plain", text)
    copyText(text)
  }

  // VS Code webviews silently drop `window.open()`, which ghostty-web's built-in
  // link providers call in bubble phase. Intercept Cmd+click (macOS) / Ctrl+click
  // (Linux/Windows) in capture phase and forward the URL through the extension host.
  const onClick = (event: MouseEvent) => {
    const trigger = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
    if (!trigger || event.altKey || event.button !== 0) return
    const immediate = hoveredLinkText(term)
    if (immediate) {
      event.preventDefault()
      event.stopImmediatePropagation()
      vscode.postMessage({ type: "open", url: immediate, external: event.shiftKey })
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    void resolveLinkAtClick(term, event).then((url) => {
      if (!isClosed() && url) vscode.postMessage({ type: "open", url, external: event.shiftKey })
    })
  }

  const onReviewComments = (event: Event) => {
    const text = takeReviewCommentsForTerminal(
      (event as CustomEvent<AppendReviewCommentsDetail>).detail,
      props.terminalId,
    )
    if (text === undefined) return
    markUser()
    term.paste(text)
  }

  const userEvents = ["input", "paste", "compositionend", "mousedown", "wheel"] as const
  host.addEventListener("focusin", onFocusIn)
  host.addEventListener("focusout", onFocusOut)
  host.addEventListener("mousedown", onHostMouseDown)
  host.addEventListener("copy", onCopy, true)
  host.addEventListener("click", onClick, true)
  window.addEventListener(APPEND_REVIEW_COMMENTS, onReviewComments)
  for (const name of userEvents) host.addEventListener(name, markUser, true)

  return () => {
    host.removeEventListener("focusin", onFocusIn)
    host.removeEventListener("focusout", onFocusOut)
    host.removeEventListener("mousedown", onHostMouseDown)
    host.removeEventListener("copy", onCopy, true)
    host.removeEventListener("click", onClick, true)
    window.removeEventListener(APPEND_REVIEW_COMMENTS, onReviewComments)
    for (const name of userEvents) host.removeEventListener(name, markUser, true)
  }
}

function createSocketController(opts: {
  term: Terminal
  props: Props
  vscode: VSCodeContext
  t: (key: string) => string
  log: (...args: unknown[]) => void
  batcher: ReturnType<typeof createWriteBatcher>
  clearActivity: () => void
  isClosed: () => boolean
  isWriting: () => boolean
  shouldFlushEcho: (size: number) => boolean
  consumeUser: () => boolean
}) {
  const { term, props, vscode, t, log, batcher, clearActivity, isClosed, isWriting, shouldFlushEcho, consumeUser } =
    opts
  let ws: TerminalSocket | undefined
  const input = createInputBuffer()
  let restartRequested = false
  let disconnected = false
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let streamed = false
  let socketEnded = false
  let opened = false
  let attached = false
  let failureWritten = false

  const writeLine = (data: string) => batcher.write(`${data}\r\n`)

  const clearTimers = () => {
    clearTimeout(readyTimer)
    readyTimer = undefined
    clearTimeout(fallbackTimer)
    fallbackTimer = undefined
  }

  const noteFailure = () => {
    if (failureWritten || (!streamed && !socketEnded)) return
    const status = props.status?.()
    if (status?.kind !== "setup") return
    if (status.state === "failed") {
      failureWritten = true
      writeLine(`\r\n\x1b[31m[${t("agentManager.terminal.setupFailed")}]\x1b[0m`)
      return
    }
    if (status.state === "exited" && status.exitCode !== 0) {
      failureWritten = true
      writeLine(`\r\n\x1b[31m[${t("agentManager.terminal.setupFailedCode")} ${status.exitCode ?? "?"}]\x1b[0m`)
    }
  }

  const requestRestart = () => {
    if (restartRequested) return
    restartRequested = true
    vscode.postMessage({
      type: "agentManager.terminal.restart",
      terminalId: props.terminalId,
      cols: term.cols,
      rows: term.rows,
    })
  }

  const flush = (all = false) => {
    if (ws?.readyState !== TerminalSocket.OPEN) return
    clearTimers()
    const data = input.take()
    if (data && (all || /[^\r\n]/.test(data))) ws.send(data)
    disconnected = false
    restartRequested = false
  }

  const scheduleFlush = () => {
    if (!disconnected) return
    clearTimeout(readyTimer)
    readyTimer = setTimeout(() => {
      readyTimer = undefined
      flush()
    }, 100)
  }

  const replay = createReplayGate({
    write: (data, callback) => batcher.write(data, callback),
    flush: () => flush(true),
  })

  const send = (data: string) => {
    const wasUser = consumeUser()
    const reply = isWriting() || (replay.draining() && !wasUser)
    if (props.restartable && (replay.blocked() || disconnected || ws?.readyState !== TerminalSocket.OPEN)) {
      input.add(data, reply)
      if (disconnected) requestRestart()
      return
    }
    if (ws?.readyState === TerminalSocket.OPEN) ws.send(data)
  }

  const handleMessage = (next: TerminalSocket, payload: string | ArrayBuffer) => {
    if (typeof payload === "string") {
      if (!replay.output(payload)) {
        input.clear()
        next.close(4009, "terminal replay exceeded limit")
        return
      }
      // Flush startup capability probes and small interactive keystroke echoes
      // immediately (at most once per frame) while coalescing large bursts per rAF.
      if (!streamed || shouldFlushEcho(payload.length)) batcher.flush()
      scheduleFlush()
      return
    }
    const bytes = new Uint8Array(payload)
    if (replay.frame(bytes)) {
      // Flush the replay boundary immediately so `blocked` clears and startup
      // query replies leave for the PTY on the same turn without waiting 16ms.
      batcher.flush()
      return
    }
    if (!replay.output(bytes)) {
      input.clear()
      next.close(4009, "terminal replay exceeded limit")
      return
    }
    if (!streamed || shouldFlushEcho(bytes.byteLength)) batcher.flush()
    scheduleFlush()
  }

  const open = () => {
    if (isClosed()) return
    if (ws && ws.readyState !== TerminalSocket.CLOSING && ws.readyState !== TerminalSocket.CLOSED) return
    replay.attach(disconnected)
    const next = new TerminalSocket(vscode, props.terminalId)
    ws = next
    opened = false
    next.onopen = () => {
      if (isClosed() || ws !== next) return
      opened = true
      socketEnded = false
      if (props.restartable && disconnected) {
        fallbackTimer = setTimeout(() => {
          fallbackTimer = undefined
          flush()
        }, 1_000)
      }
    }
    next.onmessage = (event) => {
      if (isClosed() || ws !== next) return
      const first = !streamed
      handleMessage(next, event.data)
      if (first && !(event.data instanceof ArrayBuffer && new Uint8Array(event.data)[0] === 0x00)) {
        streamed = true
      }
    }
    next.onerror = () => {
      if (isClosed() || ws !== next) return
      writeLine(`\r\n\x1b[90m[${t("agentManager.terminal.connectionError")}]\x1b[0m`)
    }
    next.onclose = () => {
      if (isClosed() || ws !== next) return
      ws = undefined
      clearTimers()
      socketEnded = true
      clearActivity()
      noteFailure()
      if (!opened && !attached) {
        attached = true
        open()
        return
      }
      if (props.restartable) {
        disconnected = true
        restartRequested = false
      }
      const key = props.restartable ? "agentManager.terminal.endedRestartable" : "agentManager.terminal.ended"
      writeLine(`\r\n\x1b[90m[${t(key)}]\x1b[0m`)
    }
  }

  const restarted = () => {
    ws?.close()
    ws = undefined
    open()
  }

  const dispose = () => {
    replay.cancel()
    clearTimers()
    try {
      ws?.close()
    } catch (error) {
      log("ws.close() threw", error)
    }
  }

  return {
    open,
    restarted,
    send,
    noteFailure,
    clearRestart: () => {
      restartRequested = false
    },
    connected: () => ws !== undefined,
    ended: () => socketEnded,
    dispose,
  }
}

function createRepaintController(opts: {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  props: Props
  vscode: VSCodeContext
  log: (...args: unknown[]) => void
  cursor: AnimatedCursorController
  isClosed: () => boolean
}) {
  const { term, fit, host, props, vscode, log, cursor, isClosed } = opts
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let resizeFrame: number | undefined
  let lastCols = term.cols
  let lastRows = term.rows
  let synced = false
  let pendingFrame: number | null = null
  let repaintTimer: ReturnType<typeof setTimeout> | undefined
  let shouldFocus = false
  let forceFocus = false
  let wasActive = false
  let focusSerial = -1

  const ownsFocus = () => host.contains(document.activeElement)
  const isRenderable = () => {
    if (!host.isConnected) return false
    const rect = host.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }

  const syncSize = (force = false) => {
    if (!force && synced && term.cols === lastCols && term.rows === lastRows) return
    lastCols = term.cols
    lastRows = term.rows
    synced = true
    vscode.postMessage({
      type: "agentManager.terminal.resize",
      terminalId: props.terminalId,
      cols: term.cols,
      rows: term.rows,
    })
  }

  const fitNow = () => {
    try {
      fitTerminalDirect(term, fit)
      if (props.active) syncSize(true)
      // `term.resize()` restarts ghostty-web's rAF loop; re-pause if hidden.
      if (!props.active || document.hidden) pauseTerminalRender(term)
    } catch (error) {
      log("fit() threw", error)
    }
  }

  // Coalesce resize observations to one direct 60fps fit per animation frame
  // (bypassing FitAddon.fit()'s 50ms lockout) and debounce backend PTY sync.
  const ro = new ResizeObserver(() => {
    if (!props.active) return
    if (resizeFrame !== undefined) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      if (isClosed() || !props.active) return
      try {
        fitTerminalDirect(term, fit)
      } catch (error) {
        log("ResizeObserver fit() threw", error)
        return
      }
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(syncSize, RESIZE_DEBOUNCE_MS)
    })
  })
  ro.observe(host)

  const runRepaint = () => {
    pendingFrame = null
    clearTimeout(repaintTimer)
    repaintTimer = undefined
    if (isClosed() || !props.active || !isRenderable()) return
    try {
      fitTerminalDirect(term, fit)
      syncSize(!synced)
    } catch (error) {
      log("repaint fit() threw", error)
    }
    if (!document.hidden) {
      resumeTerminalRender(term, false)
      cursor.resume()
    }
    if (shouldFocus && document.hasFocus()) {
      const allowed = forceFocus ? !hasPopup() : repaintMayFocus(document.activeElement, host)
      if (allowed) term.focus()
    }
    cursor.setFocused(document.hasFocus() && ownsFocus())
    shouldFocus = false
    forceFocus = false
  }

  const scheduleRepaint = (focus = false, explicit = false) => {
    shouldFocus ||= focus
    forceFocus ||= explicit
    if (pendingFrame !== null) return
    pendingFrame = requestAnimationFrame(runRepaint)
    repaintTimer = setTimeout(() => {
      if (pendingFrame === null) return
      cancelAnimationFrame(pendingFrame)
      runRepaint()
    }, 250)
  }

  const syncActivation = (now: boolean, serial: number) => {
    const explicit = serial > 0 && serial !== focusSerial
    const step = terminalActivation({
      active: now,
      wasActive,
      serial,
      previous: focusSerial,
      focusOnActivate: props.focusOnActivate !== false,
    })
    if (step) {
      if (!document.hidden) {
        resumeTerminalRender(term, false)
        cursor.resume()
      }
      if (step.focus && document.hasFocus()) term.focus()
      cursor.setFocused(document.hasFocus() && ownsFocus())
      scheduleRepaint(step.focus, explicit)
    }
    if (!now && wasActive) {
      term.blur()
      pauseTerminalRender(term)
      cursor.pause()
      cursor.setFocused(false)
    }
    wasActive = now
    focusSerial = serial
  }

  const onVisibilityChange = () => {
    if (document.hidden) {
      pauseTerminalRender(term)
      cursor.pause()
      return
    }
    if (!props.active) return
    resumeTerminalRender(term, false)
    cursor.resume()
    scheduleRepaint(ownsFocus())
  }

  const onWindowFocus = () => {
    if (!props.active || document.hidden) return
    resumeTerminalRender(term, false)
    cursor.resume()
    cursor.setFocused(ownsFocus())
    scheduleRepaint(ownsFocus())
  }

  const onWindowBlur = () => {
    cursor.setFocused(false)
  }

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("focus", onWindowFocus)
  window.addEventListener("blur", onWindowBlur)

  return {
    fitNow,
    scheduleRepaint,
    syncActivation,
    dispose: () => {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      clearTimeout(repaintTimer)
      clearTimeout(resizeTimer)
      ro.disconnect()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onWindowFocus)
      window.removeEventListener("blur", onWindowBlur)
    },
  }
}
