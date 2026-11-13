import { describe, expect, it } from "bun:test"
import { createSideTerminal } from "../webview-ui/agent-manager/terminal/side"

function scene(
  opts: {
    visible?: boolean
    focusedId?: string
    count?: number
    script?: boolean
    mac?: boolean
  } = {},
) {
  const calls = {
    requestSide: 0,
    ensureSide: 0,
    closed: [] as string[],
    hide: 0,
    refocus: 0,
  }
  let visible = opts.visible ?? false
  let focusedId = opts.focusedId as string | undefined
  const ctl = createSideTerminal({
    handlers: {
      requestSide: () => {
        calls.requestSide++
        visible = true
        focusedId ??= "terminal:side"
      },
      ensureSide: () => calls.ensureSide++,
      closeSide: (terminalId) => {
        calls.closed.push(terminalId)
        focusedId = undefined
        return true
      },
    },
    visible: () => visible,
    focusedId: () => focusedId,
    count: () => opts.count ?? 2,
    isScript: () => opts.script ?? false,
    hide: () => {
      calls.hide++
      visible = false
    },
    refocus: () => calls.refocus++,
    mac: opts.mac,
  })
  return { ctl, calls }
}

describe("Agent Manager side terminal controller", () => {
  it("toggles the panel, focusing a visible terminal before hiding it", () => {
    const focused = scene({ visible: true, focusedId: "terminal:side" })
    focused.ctl.toggle()
    expect(focused.calls.hide).toBe(1)
    expect(focused.calls.refocus).toBe(1)

    const elsewhere = scene({ visible: true })
    elsewhere.ctl.toggle()
    expect(elsewhere.calls.requestSide).toBe(1)
    expect(elsewhere.calls.hide).toBe(0)
    expect(elsewhere.calls.refocus).toBe(0)

    const hidden = scene({ visible: false })
    hidden.ctl.toggle()
    expect(hidden.calls.requestSide).toBe(1)
    expect(hidden.calls.hide).toBe(0)
  })

  it("toggles panel visibility from toolbar button without requiring focus", () => {
    const visibleUnfocused = scene({ visible: true })
    visibleUnfocused.ctl.toggle("tab_toolbar")
    expect(visibleUnfocused.calls.hide).toBe(1)
    expect(visibleUnfocused.calls.requestSide).toBe(0)

    const visibleFocused = scene({ visible: true, focusedId: "terminal:side" })
    visibleFocused.ctl.toggle("tab_toolbar")
    expect(visibleFocused.calls.hide).toBe(1)
    expect(visibleFocused.calls.requestSide).toBe(0)

    const hidden = scene({ visible: false })
    hidden.ctl.toggle("tab_toolbar")
    expect(hidden.calls.requestSide).toBe(1)
    expect(hidden.calls.hide).toBe(0)
  })

  it("ensures an open terminal panel has a terminal after switching contexts", async () => {
    const visible = scene({ visible: true })
    visible.ctl.syncContext("wt-2", "wt-1")
    await Promise.resolve()
    expect(visible.calls.ensureSide).toBe(1)

    visible.ctl.syncContext("wt-2", "wt-2")
    visible.ctl.syncContext("wt-2", undefined)
    await Promise.resolve()
    expect(visible.calls.ensureSide).toBe(2)
    expect(visible.calls.requestSide).toBe(0)

    const hidden = scene()
    hidden.ctl.syncContext("wt-2", "wt-1")
    expect(hidden.calls.ensureSide).toBe(0)

    const closed = scene({ visible: true, focusedId: "terminal:side" })
    closed.ctl.syncContext("wt-2", "wt-1")
    closed.ctl.toggle()
    await Promise.resolve()
    expect(closed.calls.ensureSide).toBe(0)
  })

  it("closes the focused terminal without stealing focus from its survivor", () => {
    const focused = scene({ focusedId: "terminal:two" })
    expect(focused.ctl.close()).toBe(true)
    expect(focused.calls.closed).toEqual(["terminal:two"])
    expect(focused.calls.refocus).toBe(0)
  })

  it("hides instead of killing the last or provider-owned terminal", () => {
    const last = scene({ focusedId: "terminal:last", count: 1 })
    expect(last.ctl.close()).toBe(true)
    expect(last.calls.closed).toEqual([])
    expect(last.calls.hide).toBe(1)
    expect(last.calls.refocus).toBe(1)

    const script = scene({ focusedId: "script:run", script: true, count: 2 })
    expect(script.ctl.close()).toBe(true)
    expect(script.calls.closed).toEqual([])
    expect(script.calls.hide).toBe(1)
    expect(script.calls.refocus).toBe(1)
  })

  it("does nothing on close without a focused terminal", () => {
    const item = scene()
    expect(item.ctl.close()).toBe(false)
    expect(item.calls.closed).toEqual([])
    expect(item.calls.refocus).toBe(0)
  })

  it.each(["tab_toolbar", "keyboard_shortcut"] as const)("opens the Agent Manager panel from %s", (trigger) => {
    const item = scene()
    item.ctl.toggle(trigger)
    expect(item.calls.requestSide).toBe(1)
  })

  it("handles the platform terminal shortcut locally", () => {
    const press = (opts: Partial<KeyboardEvent> = {}) =>
      ({
        key: "/",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
        ...opts,
      }) as KeyboardEvent

    // macOS: the workbench binding is Cmd+/, so only Cmd is accepted.
    const mac = scene({ mac: true })
    expect(mac.ctl.press(press({ metaKey: true }))).toBe(true)
    expect(mac.calls.requestSide).toBe(1)
    expect(mac.ctl.press(press({ ctrlKey: true }))).toBe(false)
    expect(mac.ctl.press(press({ metaKey: true, ctrlKey: true }))).toBe(false)
    expect(mac.calls.requestSide).toBe(1)

    // Windows/Linux: the workbench binding is Ctrl+/, so only Ctrl is accepted.
    const win = scene({ mac: false })
    expect(win.ctl.press(press({ ctrlKey: true }))).toBe(true)
    expect(win.calls.requestSide).toBe(1)
    expect(win.ctl.press(press({ metaKey: true }))).toBe(false)
    expect(win.calls.requestSide).toBe(1)

    // Unrelated keys and modifier combinations are not the shortcut.
    expect(win.ctl.press(press({ key: "?" }))).toBe(false)
    expect(win.ctl.press(press({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(win.ctl.press(press({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(win.calls.requestSide).toBe(1)
  })

  it("stops a handled press so the workbench keybinding cannot toggle a second time", () => {
    const item = scene({ mac: true })
    const stopped: string[] = []
    const press = (opts: Partial<KeyboardEvent>) =>
      item.ctl.press({
        key: "/",
        metaKey: true,
        preventDefault: () => stopped.push("default"),
        stopPropagation: () => stopped.push("propagation"),
        ...opts,
      } as KeyboardEvent)

    press({ key: "?" })
    expect(stopped).toEqual([])
    press({})
    expect(stopped).toEqual(["default", "propagation"])
    expect(item.calls.requestSide).toBe(1)
    // A held key repeats the keydown; it is stopped but toggles only once.
    press({ repeat: true })
    expect(stopped).toHaveLength(4)
    expect(item.calls.requestSide).toBe(1)
    expect(item.calls.hide).toBe(0)
  })
})
