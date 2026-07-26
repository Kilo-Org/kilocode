import { describe, expect, it } from "bun:test"
import {
  removable,
  selectedAgentNumberOverrideValue,
  selectedAgentTextOverrideValue,
  selectedDefaultAgentValue,
  shouldClearDefaultAgentWhenAgentBecomesUnavailable,
} from "../../webview-ui/src/components/settings/agent-behaviour-patches"

describe("removable", () => {
  it("only allows user-managed custom agents", () => {
    expect(removable({ name: "reviewer", mode: "primary", native: false })).toBe(true)
    expect(removable({ name: "code", mode: "primary", native: true })).toBe(false)
    expect(removable({ name: "managed", mode: "primary", source: "organization" })).toBe(false)
    expect(removable(undefined)).toBe(false)
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
