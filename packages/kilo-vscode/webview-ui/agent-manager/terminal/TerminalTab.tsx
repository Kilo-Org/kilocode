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

interface Props {
  terminalId: string
  wsUrl: string
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
 * Matches the intent of opencode desktop's
 * `packages/app/src/components/terminal.tsx:236-255` approach (memo on
 * theme mode + `setOptionIfSupported(term, "theme", colors)`), just
 * driven by a MutationObserver because VS Code is the source of truth
 * here rather than their own Solid theme signal.
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
  if (["t", "w", "n", "d", "e"].includes(key)) return true
  if (e.shiftKey && ["w", "n", "o", "m", "/", "?"].includes(key)) return true
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
      fontFamily: cssVar("--vscode-editor-font-family", "Menlo, Monaco, 'Courier New', monospace"),
      fontSize: 13,
      scrollback: 5000,
      theme: readTheme(),
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Clickable URLs in terminal output (Cmd/Ctrl+click to open).
    // WebLinksAddon's default handler calls `window.open`, which VS Code
    // webviews intercept and silently drop — so we pass an explicit
    // handler that posts an `openExternal` message. The message falls
    // through `AgentManagerProvider.onMessage` to the underlying
    // `KiloProvider.handleWebviewMessage` path which already calls
    // `vscode.env.openExternal` for sidebar + settings links.
    term.loadAddon(
      new WebLinksAddon((_event, url) => {
        vscode.postMessage({ type: "openExternal", url })
      }),
    )
    // OSC 52 clipboard support — lets shell programs (tmux, neovim, etc.)
    // copy to the system clipboard via escape sequences. Writes always
    // work in the webview; reads require the clipboard-read permission,
    // which VS Code does not grant by default, so paste-from-escape
    // silently falls back to no-op. Acceptable trade-off.
    term.loadAddon(new ClipboardAddon())
    // Unicode 15 grapheme-aware width tables. Fixes cell width for
    // emoji introduced in Unicode 12-15 (🫠 melting face, 🫡 salute,
    // 🧌 troll, and ~400 others) plus ZWJ grapheme sequences like
    // 👨‍👩‍👧‍👦 and 🏳️‍🌈. The older `@xterm/addon-unicode11` (which VS
    // Code's integrated terminal still uses) stops at Unicode 11
    // (2018), leaving all post-2020 emoji rendered with wrong width —
    // the canvas cuts them off in the DOM renderer and cursor math
    // drifts by one cell per emoji. VS Code hides this visually with
    // WebGL; in a webview we don't have that fallback, so we fix it
    // at the buffer-width layer instead. Addon is marked
    // "experimental" in its README but has been stable on npm since
    // 2023, is shipped by the same maintainer as the core xterm.js
    // package, and has no open bugs as of v0.4.0.
    term.loadAddon(new UnicodeGraphemesAddon())
    term.unicode.activeVersion = "15-graphemes"
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

    const ws = new WebSocket(props.wsUrl)
    ws.binaryType = "arraybuffer"
    let closed = false
    const disposeData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
    ws.onmessage = (event) => {
      // Text frames carry PTY output; binary frames starting with 0x00
      // are control metadata (cursor position). See pty/index.ts:46.
      if (typeof event.data === "string") {
        term.write(event.data)
        return
      }
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data)
        if (bytes.length > 0 && bytes[0] === 0x00) return
        term.write(bytes)
      }
    }
    ws.onerror = () => {
      if (closed) return
      term.writeln(`\r\n\x1b[90m[${t("agentManager.terminal.connectionError")}]\x1b[0m`)
    }
    ws.onclose = () => {
      if (closed) return
      closed = true
      term.writeln(`\r\n\x1b[90m[${t("agentManager.terminal.ended")}]\x1b[0m`)
    }

    // Resize: fit on any host size change and forward new cols/rows to
    // the backend PTY. Debounced because a user drag can fire dozens of
    // resize events per second.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let lastCols = term.cols
    let lastRows = term.rows
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
      resizeTimer = setTimeout(() => {
        if (term.cols === lastCols && term.rows === lastRows) return
        lastCols = term.cols
        lastRows = term.rows
        vscode.postMessage({
          type: "agentManager.terminal.resize",
          terminalId: props.terminalId,
          cols: term.cols,
          rows: term.rows,
        })
      }, RESIZE_DEBOUNCE_MS)
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
    let pendingFrame: number | null = null
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
      } catch (err) {
        // Layout not settled yet; ResizeObserver retries on next change.
        log("repaint fit() threw", err)
      }
      term.refresh(0, Math.max(0, term.rows - 1))
      if (document.hasFocus()) term.focus()
    }
    const scheduleRepaint = () => {
      if (pendingFrame !== null) return
      pendingFrame = requestAnimationFrame(runRepaint)
    }

    let wasActive = props.active
    createEffect(() => {
      const now = props.active
      if (now && !wasActive) scheduleRepaint()
      wasActive = now
    })

    // Also recover when the user returns from an external window or the
    // OS-level window manager (alt-tab, browser → VS Code, etc.) — the
    // browser often suspends canvas paint while the window is in the
    // background, and the Solid `active` prop alone doesn't see that.
    // Gated on `props.active` so inactive tabs don't do needless work.
    const onVisibilityChange = () => {
      if (document.hidden) return
      if (!props.active) return
      scheduleRepaint()
    }
    const onWindowFocus = () => {
      if (!props.active) return
      scheduleRepaint()
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
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onWindowFocus)
      themeObserver.disconnect()
      clearTimeout(resizeTimer)
      ro.disconnect()
      disposeData.dispose()
      try {
        ws.close()
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
