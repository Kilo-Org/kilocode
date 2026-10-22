import { describe, expect, it, mock } from "bun:test"
import { focusPanelPrompt, revealPanel } from "../../src/agent-manager/focus-panel"
import type { PanelContext } from "../../src/agent-manager/host"

describe("revealPanel", () => {
  it("reveals the panel without calling focus when preserve is true", () => {
    const revealed: Array<boolean | undefined> = []
    const panel = {
      reveal: (preserve?: boolean) => revealed.push(preserve),
      postMessage: mock(() => Promise.resolve(true)),
    } as unknown as PanelContext

    let focused = false
    revealPanel(panel, true, () => {
      focused = true
    })

    expect(revealed).toEqual([true])
    expect(focused).toBe(false)
  })

  it("calls the focus callback when preserve is false or undefined", () => {
    const revealed: Array<boolean | undefined> = []
    const panel = {
      reveal: (preserve?: boolean) => revealed.push(preserve),
      postMessage: mock(() => Promise.resolve(true)),
    } as unknown as PanelContext

    let focused = false
    revealPanel(panel, false, () => {
      focused = true
    })

    expect(revealed).toEqual([false])
    expect(focused).toBe(true)
  })

  it("sends focusInput message when panel is ready and active", async () => {
    const messages: unknown[] = []
    const panel = {
      postMessage: (msg: unknown) => {
        messages.push(msg)
        return Promise.resolve(true)
      },
    } as unknown as PanelContext

    focusPanelPrompt(panel, Promise.resolve(true), Promise.resolve(true))
    await new Promise((r) => setTimeout(r, 10))

    expect(messages).toEqual([{ type: "action", action: "focusInput" }])
  })
})
