import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import { ambientDecision, createAmbientSetup } from "../../webview-ui/agent-manager/terminal/ambient"
import { createTerminalState } from "../../webview-ui/agent-manager/terminal/state"

describe("ambientDecision", () => {
  it("waits while setup is still running", () => {
    expect(ambientDecision(undefined, "wt-1", "wt-1")).toBe("wait")
    expect(ambientDecision({ state: "running", kind: "setup" }, "wt-1", "wt-1")).toBe("wait")
    expect(ambientDecision({ state: "stopping", kind: "setup" }, "wt-1", "wt-1")).toBe("wait")
  })

  it("hides the panel after a clean exit in the revealed context", () => {
    expect(ambientDecision({ state: "exited", exitCode: 0, kind: "setup" }, "wt-1", "wt-1")).toBe("hide")
  })

  it("keeps the panel when setup failed", () => {
    expect(ambientDecision({ state: "exited", exitCode: 1, kind: "setup" }, "wt-1", "wt-1")).toBe("keep")
    expect(ambientDecision({ state: "failed", kind: "setup" }, "wt-1", "wt-1")).toBe("keep")
  })

  it("keeps the panel when the user switched context before settle", () => {
    expect(ambientDecision({ state: "exited", exitCode: 0, kind: "setup" }, LOCAL, "wt-1")).toBe("keep")
  })
})

describe("createAmbientSetup tracking", () => {
  function scene(panelOpen: boolean) {
    const [selection] = createSignal<string | null>("wt-1")
    const [panel] = createSignal<"diff" | "terminal" | null>(panelOpen ? "terminal" : null)
    const terms = createTerminalState(selection)
    const ambient = createAmbientSetup({ terms, selection, sidePanel: panel, setSidePanel: () => undefined })
    return ambient
  }

  it("remembers an ambient reveal only when the panel was closed", () => {
    createRoot((dispose) => {
      const closed = scene(false)
      closed.reveal("wt-1", "script:setup")
      expect(closed.pending()).toBeDefined()
      const open = scene(true)
      open.reveal("wt-1", "script:setup")
      expect(open.pending()).toBeUndefined()
      dispose()
    })
  })

  it("reveal and cancel drive the pending auto-hide", () => {
    createRoot((dispose) => {
      const ambient = scene(false)
      ambient.reveal("wt-1", "script:setup")
      expect(ambient.pending()).toEqual({ contextKey: "wt-1", terminalId: "script:setup" })
      ambient.cancel()
      expect(ambient.pending()).toBeUndefined()
      dispose()
    })
  })
})
