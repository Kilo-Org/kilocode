import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  clampPanelWidth,
  createPanelResize,
  maxPanelWidth,
  minPanelWidth,
} from "../../webview-ui/agent-manager/side-panel-layout"

const css = readFileSync(resolve(import.meta.dir, "../../webview-ui/agent-manager/agent-manager.css"), "utf8")
const app = readFileSync(resolve(import.meta.dir, "../../webview-ui/agent-manager/AgentManagerApp.tsx"), "utf8")
const subagent = readFileSync(resolve(import.meta.dir, "../../webview-ui/agent-manager/SubagentPanel.tsx"), "utf8")
const terminal = readFileSync(
  resolve(import.meta.dir, "../../webview-ui/agent-manager/terminal/TerminalTab.tsx"),
  "utf8",
)
const pkg = readFileSync(resolve(import.meta.dir, "../../package.json"), "utf8")

test("xterm owns the padding used by FitAddon", () => {
  const host = css.match(/\.am-terminal-host\s*\{([^}]*)\}/)?.[1]
  const term = css.match(/\.am-terminal-host \[class~="xterm"\]\s*\{([^}]*)\}/)?.[1]

  expect(host).toBeDefined()
  expect(term).toBeDefined()
  expect(host).not.toMatch(/\bpadding\s*:/)
  expect(term).toMatch(/\bpadding\s*:\s*8px\s*;/)
})

test("uses one persisted width for every inspector panel", () => {
  expect(app).toContain("persisted?.sidePanelWidth")
  expect(app).toContain("createPanelResize(setPanelWidth")
  expect(app).toContain("style={{ width: `${panelWidth()}px` }}")
  expect(subagent).toContain("InspectorTabStrip")
  expect(app).not.toContain("diffWidth")
  expect(app).not.toContain("terminalWidth")
})

test("hides keyboard hints only in inspector tabs", () => {
  const side = readFileSync(
    resolve(import.meta.dir, "../../webview-ui/agent-manager/terminal/SideTerminalPanel.tsx"),
    "utf8",
  )

  expect(subagent).toContain("showKeybind={false}")
  expect(side).toContain("showKeybind={false}")
  expect(
    readFileSync(resolve(import.meta.dir, "../../webview-ui/agent-manager/terminal/render.tsx"), "utf8"),
  ).not.toContain("showKeybind={false}")
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
  const callback = terminal.match(/const ro = new ResizeObserver\(\(\) => \{([\s\S]*?)\n    \}\)/)?.[1]
  expect(callback).toBeDefined()
  expect(callback).toContain("if (!props.active) return")
  expect(callback!.indexOf("if (!props.active) return")).toBeLessThan(callback!.indexOf("fit.fit()"))
})

test("uses the scalable DOM renderer for concurrent terminals", () => {
  expect(terminal).not.toContain("WebglAddon")
  expect(pkg).not.toContain("@xterm/addon-webgl")
})

test("orders local terminal status lines through the output batcher", () => {
  expect(terminal).toContain("const writeLine =")
  expect(terminal).not.toContain("term.writeln(")
})

test("keeps raw PTY line endings and initializes Unicode widths before attaching", () => {
  expect(terminal).toContain("convertEol: false")
  expect(terminal).toContain('term.unicode.activeVersion = "15-graphemes"')
  expect(terminal.indexOf("term.loadAddon(new UnicodeGraphemesAddon())")).toBeLessThan(
    terminal.indexOf("open(props.wsUrl)"),
  )
})

test("fits and forces the initial PTY dimensions before socket attach", () => {
  expect(terminal).toContain("const syncSize = (force = false)")
  expect(terminal).toContain("if (props.active) syncSize(true)")
  expect(terminal.indexOf("fitNow()\n      if (!ws) open(props.wsUrl)")).toBeGreaterThan(-1)
})

test("keeps terminal sockets mounted while history is open", () => {
  expect(css).toContain(".am-detail-stack-hidden")
  expect(css).toMatch(/\.am-detail-stack-hidden[^}]*top: 36px/s)
  expect(css).toMatch(/\.am-detail-stack-hidden[^}]*transform: translate\(-100vw, 0\)/s)
})

test("moves a closed side panel outside xterm's intersection area", () => {
  expect(css).toMatch(/\.am-side-host-hidden[^}]*transform: translate\(-100vw, 0\)/s)
})

test("re-sends dimensions when an optimistic terminal receives its PTY", () => {
  const created = terminal.match(
    /if \(message\.terminalId === props\.terminalId && !ws\) \{([\s\S]*?)\n        \}/,
  )?.[1]
  expect(created).toBeDefined()
  expect(created).toContain("fitNow()")
  expect(created!.indexOf("fitNow()")).toBeLessThan(created!.indexOf("open(message.wsUrl)"))
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
