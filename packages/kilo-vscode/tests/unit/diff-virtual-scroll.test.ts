import { describe, expect, test } from "bun:test"
import { resetScroll } from "../../webview-ui/diff-virtual/scroll"

describe("diff virtual scroll", () => {
  test("resets the scroll position immediately and across render frames", () => {
    const el = { scrollTop: 250, scrollLeft: 30 }
    const frames: FrameRequestCallback[] = []
    const frame = (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    }

    resetScroll(el, frame)

    expect(el).toEqual({ scrollTop: 0, scrollLeft: 0 })

    el.scrollTop = 180
    el.scrollLeft = 12
    frames.shift()?.(0)
    expect(el).toEqual({ scrollTop: 0, scrollLeft: 0 })

    el.scrollTop = 90
    el.scrollLeft = 6
    frames.shift()?.(0)
    expect(el).toEqual({ scrollTop: 0, scrollLeft: 0 })
  })
})
