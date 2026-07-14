import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
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
})
