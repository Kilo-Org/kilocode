import { describe, expect, it } from "bun:test"
import { closeCloudTab, openCloudTab } from "../../webview-ui/agent-manager/cloud-agent/tab-state"

describe("cloud tab state", () => {
  it("opens a cloud tab once and preserves its position when focused again", () => {
    const opened = openCloudTab(["ses_a"], "ses_b")

    expect(opened).toEqual(["ses_a", "ses_b"])
    expect(openCloudTab(opened, "ses_a")).toBe(opened)
  })

  it("selects the adjacent tab when an open cloud tab closes", () => {
    expect(closeCloudTab(["ses_a", "ses_b", "ses_c"], "ses_b")).toEqual({
      ids: ["ses_a", "ses_c"],
      selected: "ses_c",
    })
    expect(closeCloudTab(["ses_a", "ses_b"], "ses_b")).toEqual({ ids: ["ses_a"], selected: "ses_a" })
    expect(closeCloudTab(["ses_a"], "ses_a")).toEqual({ ids: [], selected: undefined })
  })

  it("leaves tabs unchanged when closing an id that is not open", () => {
    const ids = ["ses_a"]

    expect(closeCloudTab(ids, "ses_b")).toEqual({ ids, selected: undefined })
    expect(closeCloudTab(ids, "ses_b").ids).toBe(ids)
  })
})
