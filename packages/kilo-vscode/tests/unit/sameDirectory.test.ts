import { afterEach, describe, expect, it } from "bun:test"
import { sameDirectory } from "../../src/kilo-provider-utils"

const platform = Object.getOwnPropertyDescriptor(process, "platform")

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform)
})

describe("sameDirectory", () => {
  it("matches identical paths", () => {
    expect(sameDirectory("/repo/pkg", "/repo/pkg")).toBe(true)
  })

  it("matches trailing slash differences", () => {
    expect(sameDirectory("/repo/pkg", "/repo/pkg/")).toBe(true)
  })

  it("matches Windows drive-letter case differences", () => {
    setPlatform("win32")
    expect(sameDirectory("C:/Repo/Work", "c:/repo/work")).toBe(true)
  })

  it("returns false for different directories", () => {
    expect(sameDirectory("/repo/pkg-a", "/repo/pkg-b")).toBe(false)
  })
})
