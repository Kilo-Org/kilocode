import { describe, expect, it } from "bun:test"
import { indexingEnabled, indexingEnabledInherited } from "../../webview-ui/src/components/settings/indexing-tab-state"

describe("indexing tab scope state", () => {
  it("uses the global value when project enablement is inherited", () => {
    expect(indexingEnabled("project", { enabled: true }, {})).toBe(true)
    expect(indexingEnabled("project", { enabled: false }, {})).toBe(false)
    expect(indexingEnabledInherited("project", { enabled: true }, {})).toBe(true)
    expect(indexingEnabledInherited("project", { enabled: false }, {})).toBe(true)
  })

  it("uses explicit project overrides", () => {
    expect(indexingEnabled("project", { enabled: true }, { enabled: false })).toBe(false)
    expect(indexingEnabled("project", { enabled: false }, { enabled: true })).toBe(true)
    expect(indexingEnabledInherited("project", { enabled: true }, { enabled: false })).toBe(false)
  })

  it("ignores project values in global scope", () => {
    expect(indexingEnabled("global", { enabled: false }, { enabled: true })).toBe(false)
    expect(indexingEnabledInherited("global", { enabled: false }, {})).toBe(false)
  })
})
