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

interface Props {
  terminalId: string
  wsUrl: string
  /** Terminal font settings forwarded from the extension host. Used on
   *  initial mount; live changes arrive via `agentManager.terminal.fontChanged`. */
  font: TerminalFont
  /** Whether this terminal is currently the focused tab.
   *
   *  The xterm subtree always stays in the paint tree (see the layer /
   *  slot CSS in `terminal/render.tsx` and `agent-manager.css`), so we
   *  do NOT rely on this prop to rescue the canvas after a hypothetical
   *  `display: none` detach — the layout is designed so that never
   *  happens. It's used only to auto-focus on activation and to force
   *  an xterm re-paint when the slot transitions back to visible after
   *  sitting behind an occluding layer. */
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
  if (e.shiftKey && ["w", "n", "o", "r", "m", "/", "?"].includes(key)) return true
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
      convertEol: true,
      cursorBlink: true,
      fontFamily: props.font.fontFamily,
      fontSize: props.font.fontSize,
      scrollback: 5000,
      theme: readTheme(),
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    // Fit on the next frame — `host` might still have 0px dimensions
    // during the initial layout pass otherwise.
    requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch (err) {
        // Host still detached at mount time. ResizeObserver will retry
        // once layout kicks in. Logged so regressions don't hide.
        log("initial fit() threw", err)
      }
    })

    // Pass agent-manager hotkeys through to the parent key handler so
    // ⌘T / ⌘W / ⌘⌥← etc. still work while the terminal is focused.
    term.attachCustomKeyEventHandler((event) => !isAgentManagerShortcut(event))

    // Track DOM focus so the state layer knows which terminal holds the
    // cursor (drives Cmd+W targeting). focusout is ignored when focus
    // moves within the same host (xterm shuffles inner nodes).
    const onFocusIn = () => props.onFocusChange?.(true)
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return
      props.onFocusChange?.(false)
    }
    host.addEventListener("focusin", onFocusIn)
    host.addEventListener("focusout", onFocusOut)

    // OSC 0/1/2 window-title sequences → tab label. xterm parses and
    // strips these itself, so this only fires for real title codes.
    const disposeTitle = term.onTitleChange((title) => props.onTitleChange?.(title))

    let ws: WebSocket | undefined
    let closed = false
    let pending = ""
    let restartRequested = false
    let disconnected = false
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    let streamed = false
    let socketEnded = false
    let frame: number | undefined
    let deferred: number | undefined
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
        term.writeln(`\r\n\x1b[31m[${t("agentManager.terminal.setupFailed")}]\x1b[0m`)
        return
      }
      if (status.state === "exited" && status.exitCode !== 0) {
        failureWritten = true
        term.writeln(`\r\n\x1b[31m[${t("agentManager.terminal.setupFailedCode")} ${status.exitCode ?? "?"}]\x1b[0m`)
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
    const send = (data: string) => {
      if (disconnected && props.restartable) {
        pending += data
        if (pending.length > 256 * 1024) pending = pending.slice(-256 * 1024)
        requestRestart()
        return
      }
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data)
        return
      }
    }
    const flush = () => {
      if (ws?.readyState !== WebSocket.OPEN) return
      if (readyTimer) {
        clearTimeout(readyTimer)
        readyTimer = undefined
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer)
        fallbackTimer = undefined
      }
      const data = pending
      pending = ""
      if (data && /[^\r\n]/.test(data)) ws.send(data)
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
    const open = (url: string) => {
      if (closed || !url) return
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
          term.write(event.data)
          scheduleFlush()
          return
        }
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          if (bytes.length > 0 && bytes[0] === 0x00) return
          term.write(bytes)
          scheduleFlush()
        }
      }
      next.onerror = () => {
        if (closed || ws !== next) return
        term.writeln(`\r\n\x1b[90m[${t("agentManager.terminal.connectionError")}]\x1b[0m`)
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
        term.writeln(`\r\n\x1b[90m[${t(key)}]\x1b[0m`)
      }
    }
    const disposeData = term.onData(send)
    open(props.wsUrl)

    // These addons are not needed to paint the initial prompt. Defer them
    // until after the first frame so their startup work, especially the
    // Unicode 15 width tables, does not delay the shell connection.
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
      // Use grapheme-aware width tables for newer emoji and ZWJ sequences.
      term.loadAddon(new UnicodeGraphemesAddon())
      term.unicode.activeVersion = "15-graphemes"
      term.refresh(0, Math.max(0, term.rows - 1))
    }
    frame = requestAnimationFrame(() => {
      frame = undefined
      deferred = requestAnimationFrame(loadAddons)
    })

    const restarted = (url: string) => {
      open(url)
    }

    // Resize: fit on any host size change and forward new cols/rows to
    // the backend PTY. Debounced because a user drag can fire dozens of
    // resize events per second.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let lastCols = term.cols
    let lastRows = term.rows
    const syncSize = () => {
      if (term.cols === lastCols && term.rows === lastRows) return
      lastCols = term.cols
      lastRows = term.rows
      vscode.postMessage({
        type: "agentManager.terminal.resize",
        terminalId: props.terminalId,
        cols: term.cols,
        rows: term.rows,
      })
    }
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch (err) {
        // Host went detached/zero-size between observations — the next
        // observation cycle will retry. Logged so it's not invisible.
        log("ResizeObserver fit() threw", err)
        return
      }
      clearTimeout(resizeTimer)
      if (readyTimer) clearTimeout(readyTimer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
      resizeTimer = setTimeout(syncSize, RESIZE_DEBOUNCE_MS)
    })
    ro.observe(host)

    // ---- Repaint recovery ----
    //
    // Every xterm canvas stays mounted in the paint tree (stacking CSS
    // guarantees this), but browsers still deprioritise canvases that
    // aren't visibly contributing pixels: after another terminal is
    // opened on top, or after the window loses focus, the canvas keeps
    // its last painted bitmap frozen while xterm's internal buffer goes
    // on updating. When we flip the slot back to opacity:1 the canvas
    // shows that stale frame until something kicks xterm's render loop
    // — historically "press Enter to wake it up". Forcing a
    // `fit + refresh(0, rows-1)` once per activation reclaims the paint
    // priority; from then on the browser keeps the canvas live.
    //
    // Focus is opt-in per repaint (`shouldFocus`): repaints triggered by
    // resizes or font changes must not yank the cursor out of the chat
    // input, only explicit activation / focus requests may.
    let pendingFrame: number | null = null
    let shouldFocus = false
    const isRenderable = () => {
      if (!host.isConnected) return false
      const rect = host.getBoundingClientRect()
      return rect.width > 1 && rect.height > 1
    }
    const runRepaint = () => {
      pendingFrame = null
      if (!props.active) return
      if (!isRenderable()) return
      try {
        fit.fit()
        syncSize()
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
    }
    const fontSub = vscode.onMessage((message) => {
      if (message.type === "appendReviewCommentsToTerminal") {
        if (message.targetTerminalId !== props.terminalId) return
        const comments = message.comments
        if (!Array.isArray(comments) || comments.length === 0) return
        term.paste(`${formatReviewCommentsMarkdown(comments)}\n`)
        return
      }

      if (message.type === "agentManager.terminal.restarted") {
        if (message.terminalId === props.terminalId) restarted(message.wsUrl)
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
      if (now && (!wasActive || serial !== focusSerial))
        scheduleRepaint((serial > 0 && serial !== focusSerial) || props.focusOnActivate !== false)
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
      if (!props.active || !ownsFocus()) return
      scheduleRepaint(true)
    }
    const onWindowFocus = () => {
      if (!props.active || !ownsFocus()) return
      scheduleRepaint(true)
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
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (deferred !== undefined) cancelAnimationFrame(deferred)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onWindowFocus)
      host.removeEventListener("focusin", onFocusIn)
      host.removeEventListener("focusout", onFocusOut)
      fontSub()
      themeObserver.disconnect()
      clearTimeout(resizeTimer)
      ro.disconnect()
      disposeData.dispose()
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
