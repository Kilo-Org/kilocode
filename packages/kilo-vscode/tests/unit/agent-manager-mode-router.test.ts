import { describe, expect, it } from "bun:test"
import { createModeRouter } from "../../webview-ui/agent-manager/mode-router"

describe("Agent Manager mode router", () => {
  it("dispatches to the active modal handler and reports consumption", () => {
    const router = createModeRouter()
    const directions: number[] = []

    router.register((direction) => directions.push(direction))

    expect(router.dispatch(1)).toBe(true)
    expect(router.dispatch(-1)).toBe(true)
    expect(directions).toEqual([1, -1])
  })

  it("restores normal routing after the modal unregisters", () => {
    const router = createModeRouter()
    const dispose = router.register(() => undefined)

    dispose()

    expect(router.dispatch(1)).toBe(false)
  })

  it("does not let an old modal cleanup remove a replacement handler", () => {
    const router = createModeRouter()
    const first = router.register(() => undefined)
    const directions: number[] = []

    router.register((direction) => directions.push(direction))
    first()

    expect(router.dispatch(1)).toBe(true)
    expect(directions).toEqual([1])
  })
})
