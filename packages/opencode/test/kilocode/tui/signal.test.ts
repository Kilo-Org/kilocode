import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createLeadingTrailingSignal } from "@tui/feature-plugins/session/preview-pane"
import { createDebouncedSignal } from "@tui/util/signal"

describe("TUI scheduling", () => {
  test("debounces signal updates", async () => {
    await createRoot(async (dispose) => {
      const [value, schedule] = createDebouncedSignal("initial", 10)

      schedule("first")
      schedule("last")
      expect(value()).toBe("initial")

      await Bun.sleep(30)
      expect(value()).toBe("last")
      dispose()
    })
  })

  test("updates on the leading and trailing edges", async () => {
    await createRoot(async (dispose) => {
      const [value, , schedule] = createLeadingTrailingSignal("initial", 10)

      schedule("leading")
      expect(value()).toBe("leading")

      schedule("middle")
      schedule("trailing")
      expect(value()).toBe("leading")

      await Bun.sleep(30)
      expect(value()).toBe("trailing")

      schedule("next")
      expect(value()).toBe("next")
      dispose()
    })
  })
})
