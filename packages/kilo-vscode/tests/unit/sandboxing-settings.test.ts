import { afterEach, describe, expect, test } from "bun:test"
import { configFeatures } from "../../src/features"
import { visible } from "../../webview-ui/src/components/settings/sandboxing"

const features = { indexing: false, sandboxControls: false }
const platform = Object.getOwnPropertyDescriptor(process, "platform")

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform)
})

describe("Sandboxing settings visibility", () => {
  test("requires both sandbox control availability and the sandbox experiment", () => {
    expect(visible(features, {})).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, {})).toBe(false)
    expect(visible(features, { experimental: { sandbox: true } })).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, { experimental: { sandbox: false } })).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, { experimental: { sandbox: true } })).toBe(true)
  })

  test("enables sandbox controls by default outside Windows", () => {
    setPlatform("darwin")
    expect(configFeatures().sandboxControls).toBe(true)

    setPlatform("linux")
    expect(configFeatures().sandboxControls).toBe(true)
  })

  test("hides sandbox controls on Windows", () => {
    setPlatform("win32")
    expect(configFeatures().sandboxControls).toBe(false)
  })
})
