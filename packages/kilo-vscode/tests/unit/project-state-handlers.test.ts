import { describe, expect, it } from "bun:test"
import path from "node:path"
import { createProjectStateHandlers } from "../../webview-ui/agent-manager/project/state-handlers"
import type { AgentManagerStateMessage } from "../../webview-ui/src/types/messages"

const state = (projectId: string): AgentManagerStateMessage => ({
  type: "agentManager.state",
  projectId,
  worktrees: [],
  sessions: [],
  sections: [],
  isGitRepo: true,
  browserAutomation: true,
})

describe("createProjectStateHandlers", () => {
  it("stores each project state before applying and routing it", () => {
    const stored: Record<string, AgentManagerStateMessage> = {}
    const applied: AgentManagerStateMessage[] = []
    const routed: AgentManagerStateMessage[] = []
    const handler = createProjectStateHandlers({
      setMulti: () => {},
      setProjects: () => {},
      setStates: (update) => Object.assign(stored, update(stored)),
      prune: () => {},
      ensure: () => ({ sections: () => [], applyState: (value) => applied.push(value) }),
      active: () => ({ sections: () => [], applyState: (value) => applied.push(value) }),
      routeCatalog: () => {},
      routeState: (value) => routed.push(value),
      isActive: () => true,
      pending: () => false,
      setPending: () => {},
      rename: () => {},
      font: () => {},
      browser: () => {},
      current: () => "session-a",
      closeBrowser: () => {},
      openBrowser: () => {},
    })
    const value = state("project-a")

    handler.state(value)

    expect(stored["project-a"]).toBe(value)
    expect(applied).toEqual([value])
    expect(routed).toEqual([value])
    expect(value.browserAutomation).toBe(true)
  })

  it("opens browser previews only for the active project and selected session", () => {
    let opened = 0
    let closed = 0
    let enabled = false
    const handler = createProjectStateHandlers({
      setMulti: () => {},
      setProjects: () => {},
      setStates: () => {},
      prune: () => {},
      ensure: () => ({ sections: () => [], applyState: () => {} }),
      active: () => ({ sections: () => [], applyState: () => {} }),
      routeCatalog: () => {},
      routeState: () => {},
      isActive: (project) => project === "project-a",
      pending: () => false,
      setPending: () => {},
      rename: () => {},
      font: () => {},
      browser: (value) => {
        enabled = value
      },
      current: () => "session-a",
      closeBrowser: () => {
        closed++
      },
      openBrowser: () => {
        opened++
      },
    })
    const browser = {
      type: "agentManager.browserState" as const,
      browserId: "browser-a",
      projectId: "project-a",
      sessionId: "session-a",
      status: "ready" as const,
      errors: 0,
    }
    handler.browser({ ...browser, projectId: "project-b" })
    handler.browser({ ...browser, sessionId: "session-b" })
    handler.browser({ ...browser, status: "closed" })
    expect(opened).toBe(0)
    handler.browser(browser)
    expect(opened).toBe(0)
    handler.browser({ ...browser, status: "loading" })
    expect(opened).toBe(1)
    handler.state({ ...state("project-a"), browserAutomation: false })
    expect(enabled).toBe(false)
    expect(closed).toBe(1)
  })

  it.each(["shared signal", "panel controller"])(
    "closes only Browser on disabled-browser refreshes with %s",
    (mode) => {
      const child = Bun.spawnSync(
        [
          process.execPath,
          "--conditions=browser",
          "-e",
          `
          import assert from "node:assert/strict"
          import { createRoot, createSignal } from "solid-js"
          import { createBrowserPanel } from "./agent-manager/BrowserPanel.tsx"
          import { createSidePanel } from "./agent-manager/side-panel-state.ts"
          import { SidePanel } from "./agent-manager/side-panel-layout.ts"
          import { createProjectStateHandlers } from "./agent-manager/project/state-handlers.ts"

          globalThis.KILO_BROWSER_AUTOMATION = false
          createRoot((dispose) => {
            const current = () => "session-a"
            const shared = ${JSON.stringify(mode === "shared signal")}
            const [panel, update] = createSignal(null)
            const [history, setHistory] = createSignal(false)
            const [review, setReview] = createSignal(false)
            const controller = createSidePanel({
              project: () => "project-a",
              selection: () => "worktree-a",
              current,
              visible: (panel) => panel !== SidePanel.Browser || browser.tabs.browserAutomation(),
            })
            const panels = shared ? { panel, selected: panel, open: update } : controller
            const browser = createBrowserPanel(
              panels.panel,
              shared ? update : (value) => {
                const current = controller.selected()
                const next = typeof value === "function" ? value(current) : value
                if (next === current) return next
                if (next) controller.open(next)
                else controller.close(SidePanel.Browser)
                return next
              },
              setHistory,
              setReview,
            )
            const binding = browser.bind(current)
            const handler = createProjectStateHandlers({
              setMulti: () => {},
              setProjects: () => {},
              setStates: () => {},
              prune: () => {},
              ensure: () => ({ sections: () => [], applyState: () => {} }),
              active: () => ({ sections: () => [], applyState: () => {} }),
              routeCatalog: () => {},
              routeState: () => {},
              isActive: (project) => project === "project-a",
              pending: () => false,
              setPending: () => {},
              rename: () => {},
              font: () => {},
              ...binding,
            })
            const state = (projectId, browserAutomation = false) => ({
              type: "agentManager.state",
              projectId,
              worktrees: [],
              sessions: [],
              sections: [],
              isGitRepo: true,
              browserAutomation,
            })

            assert.equal(browser.tabs.browserAutomation(), false)
            for (const mode of Object.values(SidePanel).filter((mode) => mode !== SidePanel.Browser)) {
              panels.open(mode)
              for (const project of ["project-a", "project-a", "project-b", undefined]) {
                handler.state(state(project))
                assert.equal(panels.panel(), mode, mode + " must stay visible")
                assert.equal(panels.selected(), mode, mode + " must stay selected")
                assert.equal(browser.tabs.browserAutomation(), false)
              }
              browser.tabs.onToggleBrowser()
              binding.closeBrowser()
              assert.equal(panels.panel(), mode)
            }

            for (const project of ["project-a", "project-b", undefined]) {
              handler.state(state("project-a", true))
              binding.openBrowser()
              assert.equal(panels.panel(), SidePanel.Browser)
              handler.state(state(project))
              assert.equal(panels.panel(), null)
              assert.equal(panels.selected(), null)
              handler.state(state("project-a", true))
              assert.equal(panels.panel(), null)
            }

            setHistory(true)
            setReview(true)
            browser.tabs.onToggleBrowser()
            assert.equal(panels.panel(), SidePanel.Browser)
            assert.equal(history(), false)
            assert.equal(review(), false)
            browser.tabs.onToggleBrowser()
            assert.equal(panels.selected(), null)
            binding.openBrowser()
            binding.closeBrowser()
            assert.equal(panels.selected(), null)
            handler.state(state("project-b"))
            assert.equal(panels.selected(), null)
            dispose()
          })
        `,
        ],
        { cwd: path.resolve(import.meta.dir, "../../webview-ui"), stdout: "pipe", stderr: "pipe" },
      )
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    },
  )
})
