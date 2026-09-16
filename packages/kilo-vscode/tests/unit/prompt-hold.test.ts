import { describe, expect, it } from "bun:test"
import { createHold } from "../../webview-ui/src/utils/focus"

describe("createHold", () => {
  it("reclaims the prompt when the webview window is focused and nothing else is active", () => {
    const focused: string[] = []
    const node = { focus: () => focused.push("prompt") } as unknown as HTMLElement
    const hold = createHold({
      target: () => node,
      focused: () => true,
      active: () => null,
      defer: (fn) => fn(),
    })
    hold.claim()
    hold.reclaim()
    expect(focused).toEqual(["prompt"])
  })

  it("does not steal focus from another control", () => {
    const focused: string[] = []
    const node = { focus: () => focused.push("prompt") } as unknown as HTMLElement
    const other = { tagName: "BUTTON" } as unknown as Element
    const hold = createHold({
      target: () => node,
      focused: () => true,
      active: () => other,
      idle: (el) => !el,
      defer: (fn) => fn(),
    })
    hold.claim()
    hold.reclaim()
    expect(focused).toEqual([])
  })

  it("drops the hold when focus moves to another control", () => {
    const focused: string[] = []
    const node = { focus: () => focused.push("prompt") } as unknown as HTMLElement
    const other = { tagName: "BUTTON" } as unknown as Element
    const hold = createHold({
      target: () => node,
      focused: () => true,
      active: () => other,
      idle: (el) => !el,
      defer: (fn) => fn(),
    })
    hold.claim()
    hold.release()
    hold.reclaim()
    expect(focused).toEqual([])
  })

  it("keeps the hold when the prompt blurs to idle while the webview stays focused", () => {
    const focused: string[] = []
    const node = { focus: () => focused.push("prompt") } as unknown as HTMLElement
    const hold = createHold({
      target: () => node,
      focused: () => true,
      active: () => null,
      idle: (el) => !el,
      defer: (fn) => fn(),
    })
    hold.claim()
    hold.release()
    hold.reclaim()
    expect(focused).toEqual(["prompt"])
  })

  it("keeps the hold when the prompt blurs because the window deactivated", () => {
    const focused: string[] = []
    const node = { focus: () => focused.push("prompt") } as unknown as HTMLElement
    const hold = createHold({
      target: () => node,
      focused: () => false,
      active: () => null,
      defer: (fn) => fn(),
    })
    hold.claim()
    hold.release()
    hold.reclaim()
    expect(focused).toEqual(["prompt"])
  })
})
