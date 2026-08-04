import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { clampPanelWidth, maxPanelWidth, minPanelWidth } from "../../webview-ui/agent-manager/side-panel-layout"

const css = readFileSync(resolve(import.meta.dir, "../../webview-ui/agent-manager/agent-manager.css"), "utf8")
const app = readFileSync(resolve(import.meta.dir, "../../webview-ui/agent-manager/AgentManagerApp.tsx"), "utf8")

test("xterm owns the padding used by FitAddon", () => {
  const host = css.match(/\.am-terminal-host\s*\{([^}]*)\}/)?.[1]
  const term = css.match(/\.am-terminal-host \[class~="xterm"\]\s*\{([^}]*)\}/)?.[1]

  expect(host).toBeDefined()
  expect(term).toBeDefined()
  expect(host).not.toMatch(/\bpadding\s*:/)
  expect(term).toMatch(/\bpadding\s*:\s*8px\s*;/)
})

test("uses one persisted width for the diff and terminal inspector", () => {
  expect(app).toContain("persisted?.sidePanelWidth")
  expect(app).toContain("setPanelWidth(pendingSideWidth!)")
  expect(app).not.toContain("diffWidth")
  expect(app).not.toContain("terminalWidth")
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
