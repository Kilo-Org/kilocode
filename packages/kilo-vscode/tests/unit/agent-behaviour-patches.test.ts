import { describe, expect, it } from "bun:test"
import {
  mcpConfigScope,
  mcpEnabledPatch,
  selectedAgentNumberOverrideValue,
  selectedAgentTextOverrideValue,
  selectedDefaultAgentValue,
  shouldClearDefaultAgentWhenAgentBecomesUnavailable,
} from "../../webview-ui/src/components/settings/agent-behaviour-patches"

describe("mcpEnabledPatch", () => {
  it("returns only the enabled-state patch", () => {
    expect(mcpEnabledPatch("docs", false)).toEqual({
      mcp: {
        docs: {
          enabled: false,
        },
      },
    })
  })

  it("routes project-defined servers to project config", () => {
    expect(
      mcpConfigScope("docs", {
        mcp: [{ key: "docs", source: "project" }],
      }),
    ).toBe("project")
  })

  it("routes global servers to global config", () => {
    const collections = {
      mcp: [{ key: "docs", source: "global" as const }],
    }
    expect(mcpConfigScope("docs", collections)).toBe("global")
  })

  it("keeps system, default, and unknown servers runtime-only", () => {
    const collections = {
      mcp: [
        { key: "legacy", source: "system" as const },
        { key: "builtin", source: "default" as const },
      ],
    }
    expect(mcpConfigScope("legacy", collections)).toBeUndefined()
    expect(mcpConfigScope("builtin", collections)).toBeUndefined()
    expect(mcpConfigScope("unknown", collections)).toBeUndefined()
  })
})

describe("selectedAgentTextOverrideValue", () => {
  it("maps an empty text field value to a null delete sentinel", () => {
    expect(selectedAgentTextOverrideValue("")).toBeNull()
  })

  it("preserves a non-empty text override", () => {
    expect(selectedAgentTextOverrideValue("Review code")).toBe("Review code")
  })
})

describe("selectedAgentNumberOverrideValue", () => {
  it("maps a blank numeric field value to a null delete sentinel", () => {
    expect(selectedAgentNumberOverrideValue("", parseFloat)).toBeNull()
  })

  it("preserves a valid numeric override", () => {
    expect(selectedAgentNumberOverrideValue("0.7", parseFloat)).toBe(0.7)
  })

  it("keeps invalid non-empty numeric input out of the persisted patch", () => {
    expect(selectedAgentNumberOverrideValue("abc", parseFloat)).toBeUndefined()
  })
})

describe("selectedDefaultAgentValue", () => {
  it("maps an empty dropdown value to a null delete sentinel", () => {
    expect(selectedDefaultAgentValue("")).toBeNull()
  })

  it("preserves a non-empty agent selection", () => {
    expect(selectedDefaultAgentValue("code")).toBe("code")
  })
})

describe("shouldClearDefaultAgentWhenAgentBecomesUnavailable", () => {
  it("clears when the current default agent becomes unavailable", () => {
    expect(shouldClearDefaultAgentWhenAgentBecomesUnavailable(true, "code", "code")).toBe(true)
  })

  it("does not clear when toggling a non-default agent", () => {
    expect(shouldClearDefaultAgentWhenAgentBecomesUnavailable(true, "code", "plan")).toBe(false)
  })

  it("does not clear when the agent remains available", () => {
    expect(shouldClearDefaultAgentWhenAgentBecomesUnavailable(false, "code", "code")).toBe(false)
  })
})
