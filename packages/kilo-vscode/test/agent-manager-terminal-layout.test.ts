import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  clampPanelWidth,
  createPanelResize,
  maxPanelWidth,
  minPanelWidth,
} from "../webview-ui/agent-manager/side-panel-layout"

const normalize = (source: string) => source.replace(/\r\n/g, "\n")
const css = normalize(
  readFileSync(resolve(import.meta.dir, "../webview-ui/agent-manager/agent-manager.css"), "utf8"),
)
const terminal = normalize(
  readFileSync(resolve(import.meta.dir, "../webview-ui/agent-manager/terminal/TerminalTab.tsx"), "utf8"),
)
const pkg = normalize(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"))

test("terminal host owns the padding used by libghostty FitAddon", () => {
  const host = css.match(/\.am-terminal-host\s*\{([^}]*)\}/)?.[1]

  expect(host).toBeDefined()
  expect(host).toMatch(/\bpadding\s*:\s*8px\s*;/)
  expect(host).toMatch(/\bbox-sizing\s*:\s*border-box\s*;/)
  expect(css).not.toContain('[class~="xterm"]')
})

test("limits inspector layout updates during resize", () => {
  const frames: ((time: number) => void)[] = []
  const widths: number[] = []
  const resize = createPanelResize(
    (width) => widths.push(width),
    () => 1200,
    (frame) => frames.push(frame),
  )

  resize(700)
  resize(720)
  expect(frames).toHaveLength(1)
  frames.shift()!(16)
  expect(frames).toHaveLength(1)
  expect(widths).toEqual([])
  frames.shift()!(32)
  expect(widths).toEqual([720])
})

test("does not refit hidden terminal buffers during resize", () => {
  const callback = terminal.match(/const ro = new ResizeObserver\(\(\) => \{([\s\S]*?)\n  \}\)/)?.[1]
  expect(callback).toBeDefined()
  expect(callback).toContain("if (!props.active) return")
  expect(callback!.indexOf("if (!props.active) return")).toBeLessThan(callback!.indexOf("fitTerminalDirect(term, fit)"))
})

test("uses libghostty exclusively with no xterm dependencies remaining", () => {
  expect(pkg).toContain('"ghostty-web"')
  expect(pkg).not.toContain("@xterm/")
  expect(terminal).toContain('from "ghostty-web"')
  expect(terminal).not.toContain("@xterm/")
})

test("pauses hidden terminals and resumes on activation", () => {
  expect(terminal).toContain("pauseTerminalRender(term)")
  expect(terminal).toContain("resumeTerminalRender(term")
})

test("orders local terminal status lines through the output batcher", () => {
  expect(terminal).toContain("const writeLine =")
  expect(terminal).not.toContain("term.writeln(")
})

test("uses a browser-valid close code when replay overflows", () => {
  expect(terminal).not.toContain("close(1009,")
  expect(terminal).toContain('close(4009, "terminal replay exceeded limit")')
})

test("keeps raw PTY line endings and shares one Ghostty WASM instance", () => {
  expect(terminal).toContain("convertEol: false")
  expect(terminal).toContain("loadGhostty()")
  expect(terminal).toContain("ghostty,")
})

test("fits and forces the initial PTY dimensions before socket attach", () => {
  expect(terminal).toContain("const syncSize = (force = false)")
  expect(terminal).toContain("if (props.active) syncSize(true)")
  expect(terminal.indexOf("repaint.fitNow()\n    if (!socket.connected() && canAttachNow) socket.open()")).toBeGreaterThan(-1)
})

test("guards against 0-byte WASM writes on empty replay boundaries", () => {
  expect(terminal).toContain("if (len > 0)")
  expect(terminal).toContain("batcher.flush()")
})

test("keeps terminal sockets mounted while history is open", () => {
  expect(css).toContain(".am-detail-stack-hidden")
  expect(css).toMatch(/\.am-detail-stack-hidden[^}]*top: 36px/s)
  expect(css).toMatch(/\.am-detail-stack-hidden[^}]*transform: translate\(-100vw, 0\)/s)
})

test("moves a closed side panel off-screen without unmounting terminals", () => {
  expect(css).toMatch(/\.am-side-host-hidden[^}]*transform: translate\(-100vw, 0\)/s)
})

test("re-sends dimensions when an optimistic terminal receives its PTY", () => {
  const created = terminal.match(
    /if \(message\.terminalId === props\.terminalId && !socket\.connected\(\)\) \{([\s\S]*?)\n      \}/,
  )?.[1]
  expect(created).toBeDefined()
  expect(created).toContain("repaint.fitNow()")
  expect(created!.indexOf("repaint.fitNow()")).toBeLessThan(created!.indexOf("socket.open()"))
})

const tabsCss = normalize(
  readFileSync(resolve(import.meta.dir, "../webview-ui/src/styles/session-tabs.css"), "utf8"),
)

test("tab strip uses definite width so terminal OSC title updates never flicker header width", () => {
  const rule = tabsCss.match(/\.am-inspector-tablist\s*\{([^}]*)\}/)?.[1]
  expect(rule).toBeDefined()
  expect(rule).toContain("width: calc(var(--tab-count, 1) * var(--am-tab-max-width));")
  expect(rule).toContain("max-width: 100%;")
})

test("clamps the restored inspector width to the shared layout bounds", () => {
  expect(clampPanelWidth(undefined, 1200)).toBe(600)
  expect(clampPanelWidth(500, 1200)).toBe(500)
  expect(clampPanelWidth(1000, 1000)).toBe(maxPanelWidth(1000))
  expect(clampPanelWidth(100, 1200)).toBe(minPanelWidth(1200))
  expect(clampPanelWidth("invalid", 1200)).toBe(600)
  expect(minPanelWidth(400)).toBe(200)
  expect(maxPanelWidth(400)).toBe(320)
  expect(clampPanelWidth(undefined, 400)).toBe(200)
  expect(clampPanelWidth(360, 400)).toBe(320)
})
