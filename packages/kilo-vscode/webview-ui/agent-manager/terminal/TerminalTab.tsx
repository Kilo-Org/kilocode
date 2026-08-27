/**
 * Experimental xterm.js terminal tab.
 *
 * Mounts an xterm Terminal in a ref'd div and opens a WebSocket directly
 * to the CLI server's `/pty/:id/connect` endpoint. Output frames come back
 * as text (PTY bytes) or binary (control frames with a leading 0x00 byte
 * carrying cursor metadata — see `packages/opencode/src/pty/index.ts:46`).
 *
 * The extension host is only involved at terminal create/close/resize time;
 * once the WebSocket is up, raw bytes bypass postMessage entirely.
 */

import { Component, createEffect, onCleanup, onMount } from "solid-js"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { ClipboardAddon } from "@xterm/addon-clipboard"
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes"
import "@xterm/xterm/css/xterm.css"
import { useVSCode } from "../../src/context/vscode"
import { useLanguage } from "../../src/context/language"
import { formatReviewCommentsMarkdown } from "../../src/utils/review-comment-markdown"
import type { ScriptTerminalStatus, TerminalFont } from "./state"
import { createInputBuffer, createReplayGate, createWriteBatcher } from "./replay"
import { registerTerminalOutput, unregisterTerminalOutput } from "./output"

interface Props {
  terminalId: string
  wsUrl: string
  /** Terminal font settings forwarded from the extension host. Used on
   *  initial mount; live changes arrive via `agentManager.terminal.fontChanged`. */
  font: TerminalFont
  /** Whether this terminal is currently the focused tab.
   *
   *  Inactive slots are translated off-screen (see the layer / slot CSS
   *  in `terminal/render.tsx` and `agent-manager.css`): xterm's render
   *  observer pauses invisible terminals and resumes them with a full
   *  refresh on activation. This prop drives that activation repaint
   *  plus auto-focus on activation — xterm's own resume is primary, the
   *  explicit fit + refresh here is insurance. */
  active: boolean
  /** Side terminals only repaint on activation; focus is restored explicitly
   *  when that context's remembered focus owner is the terminal. */
  focusOnActivate?: boolean
  /** Serial of the latest explicit focus request for this terminal
   *  (`state.focusRequest()`), consumed so re-requesting focus on an
   *  already-visible terminal still re-focuses it. */
  focusSerial?: number
  /** Reports DOM focus entering or leaving the xterm host. The state
   *  layer tracks this as `focusedId` so `Cmd+W` can target the
   *  terminal that actually has the cursor. */
  onFocusChange?: (focused: boolean) => void
  /** Handle the Agent Manager prompt shortcut locally because xterm's
   *  textarea does not reliably forward custom commands to the workbench. */
  onFocusPrompt?: () => void
  /** Reports OSC window-title escape codes (`ESC ] 0/1/2 ; title BEL`)
   *  sent by the shell or running programs — fish sets it to the active
   *  command, oh-my-zsh to user@host:cwd, vim to the file name. The
   *  state layer mirrors it into the tab label. */
  onTitleChange?: (title: string) => void
  /** Provider-owned script status (Run/Setup), used to annotate the
   *  output when a script ends in failure. */
  status?: () => ScriptTerminalStatus | undefined
  restartable?: boolean
}

/** How long the ResizeObserver waits after the last size change before
 *  it posts a `resize` message upstream to the backend PTY. Short
 *  enough to feel live while a user drags the panel divider, long
 *  enough to not flood the extension host with messages on every
 *  sub-frame layout change. 100 ms is a starting point — if we ever
 *  observe laggy resizes on slower machines we can bump it without
 *  touching anything else. The fit itself happens synchronously on
 *  every observation, so the visible terminal is never stale; only
 *  the backend dimension sync is debounced. */
const RESIZE_DEBOUNCE_MS = 100

/** Resolve a VS Code CSS custom property to a concrete color string.
 *
 *  xterm's `theme` option is forwarded to its renderer and doesn't parse
 *  `var(--…)` strings, so we read the resolved value from the computed
 *  style and fall back to a hard-coded default only if the variable is
 *  undefined (e.g. the first render before VS Code has pushed its theme
 *  tokens, or a theme that doesn't define the full ANSI palette). */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Build the xterm theme object from VS Code's live theme tokens.
 *
 * VS Code exposes its current theme to webviews as CSS custom properties
 * on the root element — the same `--vscode-terminal-*` variables the
 * built-in integrated terminal uses. When the user switches themes, VS
 * Code updates these variables in place rather than emitting an event,
 * so we re-read them whenever the host document's class list changes —
 * that's the signal VS Code uses to flip `vscode-light` ↔ `vscode-dark`
 * / `vscode-high-contrast`.
 *
 * Driven by a MutationObserver because VS Code is the source of truth here
 * rather than a Solid theme signal.
 */
function readTheme() {
  return {
    background: cssVar("--vscode-terminal-background", "#1e1e1e"),
    foreground: cssVar("--vscode-terminal-foreground", "#d4d4d4"),
    cursor: cssVar("--vscode-terminalCursor-foreground", "#d4d4d4"),
    cursorAccent: cssVar("--vscode-terminalCursor-background", "#1e1e1e"),
    selectionBackground: cssVar("--vscode-terminal-selectionBackground", "rgba(255,255,255,0.2)"),
    black: cssVar("--vscode-terminal-ansiBlack", "#000000"),
    red: cssVar("--vscode-terminal-ansiRed", "#cd3131"),
    green: cssVar("--vscode-terminal-ansiGreen", "#0dbc79"),
    yellow: cssVar("--vscode-terminal-ansiYellow", "#e5e510"),
    blue: cssVar("--vscode-terminal-ansiBlue", "#2472c8"),
    magenta: cssVar("--vscode-terminal-ansiMagenta", "#bc3fbc"),
    cyan: cssVar("--vscode-terminal-ansiCyan", "#11a8cd"),
    white: cssVar("--vscode-terminal-ansiWhite", "#e5e5e5"),
    brightBlack: cssVar("--vscode-terminal-ansiBrightBlack", "#666666"),
    brightRed: cssVar("--vscode-terminal-ansiBrightRed", "#f14c4c"),
    brightGreen: cssVar("--vscode-terminal-ansiBrightGreen", "#23d18b"),
    brightYellow: cssVar("--vscode-terminal-ansiBrightYellow", "#f5f543"),
    brightBlue: cssVar("--vscode-terminal-ansiBrightBlue", "#3b8eea"),
    brightMagenta: cssVar("--vscode-terminal-ansiBrightMagenta", "#d670d6"),
    brightCyan: cssVar("--vscode-terminal-ansiBrightCyan", "#29b8db"),
    brightWhite: cssVar("--vscode-terminal-ansiBrightWhite", "#e5e5e5"),
  }
}

/** Allow agent-manager Cmd/Ctrl shortcuts to fall through xterm's key handler. */
function isAgentManagerShortcut(e: KeyboardEvent): boolean {
  if (!e.metaKey && !e.ctrlKey) return false
  const key = e.key.toLowerCase()
  if (e.altKey && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) return true
  if (["t", "w", "n", "d", "e", "f"].includes(key)) return true
  if (e.shiftKey && ["t", "w", "n", "o", "r", "m", "[", "]", "/", "?"].includes(key)) return true
  if (/^[1-9]$/.test(key)) return true
  if (key === "/") return true
  return false
}

export const TerminalTab: Component<Props> = (props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  let host!: HTMLDivElement

  /** Single logger so every error path in this file surfaces in the
   *  webview DevTools console with a consistent prefix. The component
   *  is intricate — we deliberately do not swallow errors silently. */
  const log = (...args: unknown[]) => console.warn(`[Kilo New][XTerm][${props.terminalId}]`, ...args)

  onMount(() => {
    const term = new Terminal({
      // PTY output already contains terminal line endings. Converting LF to
      // CRLF here corrupts raw PTY output and is especially visible when a
      // narrow terminal wraps and redraws the prompt.
      convertEol: false,
      cursorBlink: true,
      cursorInactiveStyle: "outline",
      fontFamily: props.font.fontFamily,
      fontSize: props.font.fontSize,
      scrollback: 5000,
      theme: readTheme(),
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    // Keep xterm's DOM renderer. Every mounted WebGL addon owns a scarce
    // browser context, including when xterm pauses an off-screen terminal.
    // Chromium can evict a live renderer once enough Agent Manager terminals
    // exist, and xterm 6.0's WebGL addon also has unresolved shared-atlas
    // corruption. Frame batching below removes the per-message render churn
    // without making terminal correctness depend on GPU resources.
    registerTerminalOutput(props.terminalId, () => {
      const buffer = term.buffer.active
      return Array.from(
        { length: buffer.length },
        (_, index) => buffer.getLine(index)?.translateToString(true) ?? "",
      ).join("\n")
    })
    // Unicode width must be configured before the first PTY bytes are parsed.
    // Loading it later can leave already-wrapped graphemes with stale cell
    // widths, which moves the cursor in narrow terminals.
    term.loadAddon(new UnicodeGraphemesAddon())
    term.unicode.activeVersion = "15-graphemes"

    // Pass Agent Manager hotkeys through to the parent key handler so
    // ⌘T / ⌘W / terminal cycling / ⌘⌥← still work while focused.
    term.attachCustomKeyEventHandler((event) => {
      const prompt =
        (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m"
      if (prompt) {
        if (event.type === "keydown") props.onFocusPrompt?.()
        return false
      }
      return !isAgentManagerShortcut(event)
    })

    // Track DOM focus so the state layer knows which terminal holds the
    // cursor (drives Cmd+W targeting). focusout is ignored when focus
    // moves within the same host (xterm shuffles inner nodes).
    const reportFocus = () => props.onFocusChange?.(host.contains(document.activeElement))
    const onFocusIn = () => queueMicrotask(reportFocus)
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return
      queueMicrotask(reportFocus)
    }
    host.addEventListener("focusin", onFocusIn)
    host.addEventListener("focusout", onFocusOut)

    // OSC 0/1/2 window-title sequences → tab label. xterm parses and
    // strips these itself, so this only fires for real title codes.
    const disposeTitle = term.onTitleChange((title) => props.onTitleChange?.(title))

    let ws: WebSocket | undefined
    let closed = false
    const input = createInputBuffer()
    let user = false
    let restartRequested = false
    let disconnected = false
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    let streamed = false
    let socketEnded = false
    let frame: number | undefined
    let deferred: number | undefined
    const batcher = createWriteBatcher((data, callback) => term.write(data, callback))
    const writeLine = (data: string) => batcher.write(`${data}\r\n`)
    // The failure line must not depend on event ordering: the stream can
    // close before the exited snapshot lands (fast failures), or stay open
    // when a background child outlives the script. Write it exactly once,
    // from whichever signal arrives first.
    let failureWritten = false
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
    createEffect(() => {
      props.status?.()
      noteFailure()
    })
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
    const markUser = () => {
      user = true
      queueMicrotask(() => {
        user = false
      })
    }
    const send = (data: string) => {
      const reply = replay.draining() && !user
      user = false
      if (props.restartable && (replay.blocked() || disconnected || ws?.readyState !== WebSocket.OPEN)) {
        input.add(data, reply)
        if (disconnected) requestRestart()
        return
      }
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data)
        return
      }
    }
    const flush = (all = false) => {
      if (ws?.readyState !== WebSocket.OPEN) return
      if (readyTimer) {
        clearTimeout(readyTimer)
        readyTimer = undefined
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer)
        fallbackTimer = undefined
      }
      const data = input.take()
      if (data && (all || /[^\r\n]/.test(data))) ws.send(data)
      disconnected = false
      restartRequested = false
    }
    const scheduleFlush = () => {
      if (!disconnected) return
      if (readyTimer) clearTimeout(readyTimer)
      readyTimer = setTimeout(() => {
        readyTimer = undefined
        flush()
      }, 100)
    }
    const replay = createReplayGate({
      write: (data, callback) => batcher.write(data, callback),
      flush: () => flush(true),
    })
    const disposeKey = term.onKey(markUser)
    for (const event of ["input", "paste", "compositionend", "mousedown", "wheel"]) {
      host.addEventListener(event, markUser, true)
    }
    const open = (url: string) => {
      if (closed || !url) return
      if (ws && ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) return
      replay.attach(disconnected)
      const next = new WebSocket(url)
      next.binaryType = "arraybuffer"
      ws = next
      next.onopen = () => {
        if (closed || ws !== next) return
        socketEnded = false
        if (props.restartable && disconnected) {
          fallbackTimer = setTimeout(() => {
            fallbackTimer = undefined
            flush()
          }, 1_000)
        }
      }
      next.onmessage = (event) => {
        if (closed || ws !== next) return
        streamed = true
        if (typeof event.data === "string") {
          if (!replay.output(event.data)) {
            input.clear()
            next.close(4009, "terminal replay exceeded limit")
            return
          }
          scheduleFlush()
          return
        }
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          if (replay.frame(bytes)) return
          if (!replay.output(bytes)) {
            input.clear()
            next.close(4009, "terminal replay exceeded limit")
            return
          }
          scheduleFlush()
        }
      }
      next.onerror = () => {
        if (closed || ws !== next) return
        writeLine(`\r\n\x1b[90m[${t("agentManager.terminal.connectionError")}]\x1b[0m`)
      }
      next.onclose = () => {
        if (closed || ws !== next) return
        ws = undefined
        if (readyTimer) {
          clearTimeout(readyTimer)
          readyTimer = undefined
        }
        if (fallbackTimer) {
          clearTimeout(fallbackTimer)
          fallbackTimer = undefined
        }
        socketEnded = true
        noteFailure()
        if (props.restartable) {
          disconnected = true
          restartRequested = false
        }
        const key = props.restartable ? "agentManager.terminal.endedRestartable" : "agentManager.terminal.ended"
        writeLine(`\r\n\x1b[90m[${t(key)}]\x1b[0m`)
      }
    }
    const disposeData = term.onData(send)
    const disposeBinary = term.onBinary(send)
    // These addons are not needed to paint the initial prompt. Defer them
    // until after the first frame so their startup work does not delay the
    // shell connection.
    const loadAddons = () => {
      deferred = undefined
      if (closed) return

      // Clickable URLs in terminal output (Cmd/Ctrl+click to open).
      // WebLinksAddon's default handler calls `window.open`, which VS Code
      // webviews intercept and silently drop, so post an explicit message.
      term.loadAddon(
        new WebLinksAddon((_event, url) => {
          vscode.postMessage({ type: "openExternal", url })
        }),
      )
      // OSC 52 clipboard support for shell programs such as tmux and neovim.
      term.loadAddon(new ClipboardAddon())
      term.refresh(0, Math.max(0, term.rows - 1))
    }
    const restarted = (url: string) => {
      open(url)
    }

    // Resize the visible terminal and forward new cols/rows to the backend
    // PTY. Hidden terminals refit when activated, avoiding scrollback reflow
    // for every mounted terminal during an inspector drag.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let lastCols = term.cols
    let lastRows = term.rows
    let synced = false
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
        fit.fit()
        if (props.active) syncSize(true)
      } catch (err) {
        // Host still detached at mount time. ResizeObserver will retry
        // once layout kicks in. Logged so regressions don't hide.
        log("fit() threw", err)
      }
    }
    const ro = new ResizeObserver(() => {
      if (!props.active) return
      try {
        fit.fit()
      } catch (err) {
        // Host went detached/zero-size between observations — the next
        // observation cycle will retry. Logged so it's not invisible.
        log("ResizeObserver fit() threw", err)
        return
      }
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(syncSize, RESIZE_DEBOUNCE_MS)
    })
    ro.observe(host)
    // Wait for the first committed layout before attaching the socket. This
    // prevents the shell from emitting its first prompt at xterm's default
    // 80 columns, which is most visible in a narrow side panel.
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (closed) return
      fitNow()
      if (!ws) open(props.wsUrl)
      deferred = requestAnimationFrame(loadAddons)
    })

    // ---- Repaint recovery ----
    //
    // Inactive xterm slots slide off-screen with their layout box
    // intact, so their canvases are not composed while hidden but
    // FitAddon keeps measuring. xterm's render observer pauses hidden
    // terminals and replays a full refresh when they slide back in, but
    // browsers still defer some canvas/render work: forcing a
    // `fit + refresh(0, rows-1)` once per activation reclaims paint
    // priority immediately; from then on the renderer keeps the canvas
    // live. Historically the missing insurance step here was "press
    // Enter to wake it up".
    //
    // Focus is opt-in per repaint (`shouldFocus`): repaints triggered by
    // resizes or font changes must not yank the cursor out of the chat
    // input, only explicit activation / focus requests may.
    let pendingFrame: number | null = null
    let repaintTimer: ReturnType<typeof setTimeout> | undefined
    let shouldFocus = false
    const isRenderable = () => {
      if (!host.isConnected) return false
      const rect = host.getBoundingClientRect()
      return rect.width > 1 && rect.height > 1
    }
    const runRepaint = () => {
      pendingFrame = null
      clearTimeout(repaintTimer)
      repaintTimer = undefined
      if (!props.active) return
      if (!isRenderable()) return
      try {
        fit.fit()
        syncSize(!synced)
      } catch (err) {
        // Layout not settled yet; ResizeObserver retries on next change.
        log("repaint fit() threw", err)
      }
      term.refresh(0, Math.max(0, term.rows - 1))
      if (shouldFocus && document.hasFocus()) term.focus()
      shouldFocus = false
    }
    const scheduleRepaint = (focus = false) => {
      shouldFocus ||= focus
      if (pendingFrame !== null) return
      pendingFrame = requestAnimationFrame(runRepaint)
      repaintTimer = setTimeout(() => {
        if (pendingFrame === null) return
        cancelAnimationFrame(pendingFrame)
        runRepaint()
      }, 250)
    }
    const fontSub = vscode.onMessage((message) => {
      if (message.type === "appendReviewCommentsToTerminal") {
        if (message.targetTerminalId !== props.terminalId) return
        const comments = message.comments
        if (!Array.isArray(comments) || comments.length === 0) return
        markUser()
        term.paste(`${formatReviewCommentsMarkdown(comments)}\n`)
        return
      }

      if (message.type === "agentManager.terminal.restarted") {
        if (message.terminalId === props.terminalId) restarted(message.wsUrl)
        return
      }

      if (message.type === "agentManager.terminal.created") {
        if (message.terminalId === props.terminalId && !ws) {
          term.options.fontFamily = message.font.fontFamily
          term.options.fontSize = message.font.fontSize
          // Optimistic side terminals can fit before their backend PTY exists;
          // force the first resize again once the created response arrives.
          fitNow()
          scheduleRepaint()
          open(message.wsUrl)
        }
        return
      }

      if (message.type === "agentManager.terminal.error" && message.terminalId === props.terminalId) {
        restartRequested = false
        return
      }

      if (message.type === "agentManager.terminal.fontChanged") {
        term.options.fontFamily = message.font.fontFamily
        term.options.fontSize = message.font.fontSize
        scheduleRepaint()
        return
      }

      // fontSizeChanged/ready control the Kilo chat UI font — do not apply
      // them to the terminal, which has its own independent font settings.
      // Keep the repaint for any downstream layout side-effects.
      const size =
        message.type === "fontSizeChanged" ? message.fontSize : message.type === "ready" ? message.fontSize : undefined
      if (size === undefined) return
      scheduleRepaint()
    })

    // Activation and explicit focus requests focus the terminal;
    // deactivation blurs it so keystrokes never land in a hidden xterm.
    // `wasActive` starts false so a terminal mounted already-active (the
    // create-and-activate flow) still gets its initial focus repaint.
    let wasActive = false
    let focusSerial = -1
    createEffect(() => {
      const now = props.active
      const serial = props.focusSerial ?? 0
      if (now && (!wasActive || serial !== focusSerial)) {
        const focus = (serial > 0 && serial !== focusSerial) || props.focusOnActivate !== false
        // xterm creates its textarea synchronously in term.open(). Focus it
        // now so a freshly revealed terminal accepts input in this event
        // turn; the queued repaint below still refits and retries next frame.
        if (focus && document.hasFocus()) term.focus()
        scheduleRepaint(focus)
      }
      if (!now && wasActive) term.blur()
      wasActive = now
      focusSerial = serial
    })

    // Also recover when the user returns from an external window or the
    // OS-level window manager (alt-tab, browser → VS Code, etc.) — the
    // browser often suspends canvas paint while the window is in the
    // background, and the Solid `active` prop alone doesn't see that.
    // Gated on `props.active` so inactive tabs don't do needless work,
    // and on the terminal already owning focus so returning to the
    // window never steals the cursor back from the chat input.
    const ownsFocus = () => host.contains(document.activeElement)
    const onVisibilityChange = () => {
      if (document.hidden) return
      if (!props.active) return
      scheduleRepaint(ownsFocus())
    }
    const onWindowFocus = () => {
      if (!props.active) return
      scheduleRepaint(ownsFocus())
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", onWindowFocus)

    // Re-apply theme colors when VS Code flips its theme tokens.
    // VS Code does this by updating the class list on <body> (e.g.
    // `vscode-light` → `vscode-dark`) + the CSS custom properties on
    // the root — so we observe class changes, re-read the custom
    // properties, and hand the new palette to xterm. The canvas / DOM
    // renderer picks the new colors up on the next refresh.
    const applyTheme = () => {
      term.options.theme = readTheme()
      term.refresh(0, Math.max(0, term.rows - 1))
    }
    const themeObserver = new MutationObserver(applyTheme)
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] })

    onCleanup(() => {
      closed = true
      batcher.cancel()
      replay.cancel()
      unregisterTerminalOutput(props.terminalId)
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      clearTimeout(repaintTimer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (deferred !== undefined) cancelAnimationFrame(deferred)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onWindowFocus)
      host.removeEventListener("focusin", onFocusIn)
      host.removeEventListener("focusout", onFocusOut)
      for (const event of ["input", "paste", "compositionend", "mousedown", "wheel"]) {
        host.removeEventListener(event, markUser, true)
      }
      disposeKey.dispose()
      fontSub()
      themeObserver.disconnect()
      clearTimeout(resizeTimer)
      clearTimeout(readyTimer)
      clearTimeout(fallbackTimer)
      ro.disconnect()
      disposeData.dispose()
      disposeBinary.dispose()
      disposeTitle.dispose()
      try {
        ws?.close()
      } catch (err) {
        // Already closed (ws.close on a closed socket is a no-op in
        // most browsers; the throw is defensive). Logged so unexpected
        // error classes don't get silently dropped.
        log("ws.close() threw", err)
      }
      term.dispose()
    })
  })

  return <div ref={host} class="am-terminal-host" data-terminal-id={props.terminalId} />
}
