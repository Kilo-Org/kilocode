import { describe, expect, it } from "bun:test"
import { createSideTerminal } from "../../webview-ui/agent-manager/terminal/side"

function scene(opts: { destination?: "vscode" | "agentManager"; visible?: boolean; focused?: boolean } = {}) {
  const calls = {
    requestSide: 0,
    closeSide: 0,
    hide: 0,
    refocus: 0,
    openVscode: 0,
    posted: [] as Array<Record<string, unknown>>,
    tracked: [] as string[],
  }
  let visible = opts.visible ?? false
  let focused = opts.focused ?? false
  const ctl = createSideTerminal({
    handlers: {
      requestSide: () => {
        calls.requestSide++
        visible = true
      },
      closeSide: () => {
        calls.closeSide++
        visible = false
        return true
      },
    },
    visible: () => visible,
    focused: () => focused,
    hide: () => {
      calls.hide++
      visible = false
    },
    refocus: () => calls.refocus++,
    postMessage: (msg) => calls.posted.push(msg as Record<string, unknown>),
    track: (button) => calls.tracked.push(button),
    openVscode: () => calls.openVscode++,
  })
  if (opts.destination) ctl.setDestination(opts.destination)
  return { ctl, calls }
}

describe("Agent Manager side terminal controller", () => {
  it("toggles the panel and hands focus to the chat only when the terminal had it", () => {
    const focused = scene({ destination: "agentManager", visible: true, focused: true })
    focused.ctl.toggle()
    expect(focused.calls.hide).toBe(1)
    expect(focused.calls.refocus).toBe(1)

    const elsewhere = scene({ destination: "agentManager", visible: true, focused: false })
    elsewhere.ctl.toggle()
    expect(elsewhere.calls.hide).toBe(1)
    expect(elsewhere.calls.refocus).toBe(0)

    const hidden = scene({ destination: "agentManager", visible: false })
    hidden.ctl.toggle()
    expect(hidden.calls.requestSide).toBe(1)
    expect(hidden.calls.hide).toBe(0)
  })

  it("refocuses the chat after killing a focused terminal, not otherwise", () => {
    const focused = scene({ focused: true })
    expect(focused.ctl.close()).toBe(true)
    expect(focused.calls.closeSide).toBe(1)
    expect(focused.calls.refocus).toBe(1)

    const elsewhere = scene({ focused: false })
    expect(elsewhere.ctl.close()).toBe(true)
    expect(elsewhere.calls.refocus).toBe(0)
  })

  it("routes the primary action by destination", () => {
    const vscodeFirst = scene({ destination: "vscode" })
    vscodeFirst.ctl.openPreferred("tab_toolbar")
    expect(vscodeFirst.calls.openVscode).toBe(1)
    expect(vscodeFirst.calls.requestSide).toBe(0)

    const panelFirst = scene({ destination: "agentManager" })
    panelFirst.ctl.openPreferred("keyboard_shortcut")
    expect(panelFirst.calls.requestSide).toBe(1)
    expect(panelFirst.calls.openVscode).toBe(0)
  })

  it("persists the picked destination with a section-relative settings key", () => {
    const item = scene()
    item.ctl.choose("agentManager")
    expect(item.ctl.destination()).toBe("agentManager")
    expect(item.calls.posted).toEqual([
      { type: "updateSetting", key: "agentManager.terminalButtonDestination", value: "agentManager" },
    ])
  })
})
