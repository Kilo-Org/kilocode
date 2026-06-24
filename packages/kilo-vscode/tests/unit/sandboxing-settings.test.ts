import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { visible } from "../../webview-ui/src/components/settings/sandboxing"

const experimental = readFileSync(
  join(__dirname, "..", "..", "webview-ui", "src", "components", "settings", "ExperimentalTab.tsx"),
  "utf8",
)
const sandboxing = readFileSync(
  join(__dirname, "..", "..", "webview-ui", "src", "components", "settings", "SandboxingTab.tsx"),
  "utf8",
)

const features = { indexing: false, sandboxControls: false }

describe("Sandboxing settings visibility", () => {
  test("requires both the internal feature flag and sandbox experiment", () => {
    expect(visible(features, {})).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, {})).toBe(false)
    expect(visible(features, { experimental: { sandbox: true } })).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, { experimental: { sandbox: false } })).toBe(false)
    expect(visible({ ...features, sandboxControls: true }, { experimental: { sandbox: true } })).toBe(true)
  })

  test("saves sandbox controls as narrow hot-update patches", () => {
    expect(experimental).toContain("experimental: { [key]: value }")
    expect(sandboxing).toContain("experimental: { sandbox_restrict_network: checked }")
    expect(experimental).not.toContain("...experimental()")
    expect(sandboxing).not.toContain("...experimental()")
  })
})
