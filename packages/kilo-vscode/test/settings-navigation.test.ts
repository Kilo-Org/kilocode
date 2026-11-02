import { describe, expect, test } from "bun:test"
import { parseSettingsTarget } from "../src/settings-navigation"

describe("parseSettingsTarget", () => {
  test("reads a bare tab id", () => {
    expect(parseSettingsTarget(["models"])).toEqual({ tab: "models" })
    expect(parseSettingsTarget([" agentBehaviour "])).toEqual({ tab: "agentBehaviour" })
  })

  test("reads a tab, subtab and focus target", () => {
    expect(parseSettingsTarget([{ tab: "agentBehaviour", subtab: "mcpServers", focus: "my-server" }])).toEqual({
      tab: "agentBehaviour",
      subtab: "mcpServers",
      focus: "my-server",
    })
  })

  test("reads a row title key and a search request", () => {
    expect(parseSettingsTarget([{ tab: "autoApprove", titleKey: "settings.autoApprove.maxCost.title" }])).toEqual({
      tab: "autoApprove",
      titleKey: "settings.autoApprove.maxCost.title",
    })
    expect(parseSettingsTarget([{ search: true }])).toEqual({ search: true })
  })

  test("ignores values that are not a target", () => {
    expect(parseSettingsTarget([])).toEqual({})
    expect(parseSettingsTarget([undefined])).toEqual({})
    expect(parseSettingsTarget([null])).toEqual({})
    expect(parseSettingsTarget([42])).toEqual({})
    expect(parseSettingsTarget([["models"]] as unknown[])).toEqual({})
    expect(parseSettingsTarget([{ search: "yes", tab: 7, subtab: "" }])).toEqual({})
  })

  test("reads the first argument only", () => {
    expect(parseSettingsTarget([{ tab: "models" }, "agentBehaviour"])).toEqual({ tab: "models" })
  })
})
