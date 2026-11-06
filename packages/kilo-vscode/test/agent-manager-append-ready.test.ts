import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { registerAppend, type AppendHandler } from "../webview-ui/src/v2/append-ready"

describe("composer append registration", () => {
  it("gives the caller the append function and clears it on unmount", () => {
    const seen: Array<AppendHandler | undefined> = []
    const append: AppendHandler = () => undefined

    createRoot((dispose) => {
      registerAppend((value) => seen.push(value), append)
      expect(seen.at(-1)).toBe(append)
      dispose()
    })

    expect(seen.at(-1)).toBeUndefined()
  })

  it("does not require a caller", () => {
    const append: AppendHandler = () => undefined

    createRoot((dispose) => {
      registerAppend(undefined, append)
      dispose()
    })
  })
})
