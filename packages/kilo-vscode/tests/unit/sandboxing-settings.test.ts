import { describe, expect, test } from "bun:test"
import { visible } from "../../webview-ui/src/components/settings/sandboxing"

const features = { indexing: false, sandboxControls: false }

describe("Sandboxing settings visibility", () => {
  test("requires both the internal feature flag and sandbox experiment", () => {
    expect(visible(features, {})).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, {})).toBe(false)
    expect(visible(features, { experimental: { sandbox: true } })).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, { experimental: { sandbox: false } })).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, { experimental: { sandbox: true } })).toBe(true)
  })
})
