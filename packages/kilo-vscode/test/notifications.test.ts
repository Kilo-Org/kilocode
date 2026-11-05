import { describe, expect, it } from "bun:test"
import { stripSubProviderPrefix } from "../webview-ui/src/components/shared/model-selector-filter"
import { visibleNotifications } from "../webview-ui/src/v2/notification-list"

describe("kilo notifications", () => {
  it("keeps extension notices and hides dismissed and other surfaces", () => {
    const items = [
      { id: "kilo.cli", title: "Kilo CLI", message: "Install the CLI", showIn: ["extension"] },
      { id: "kilo.dismissed", title: "Old", message: "Already read", showIn: ["extension"] },
      { id: "kilo.web", title: "Cloud", message: "Web only", showIn: ["web"] },
      { id: "kilo.everywhere", title: "All", message: "Every surface" },
    ]

    expect(visibleNotifications(items, ["kilo.dismissed"])).toEqual([items[0], items[3]])
  })

  it("shows the model name without the upstream provider prefix", () => {
    expect(stripSubProviderPrefix("MiniMax: MiniMax M2")).toBe("MiniMax M2")
    expect(stripSubProviderPrefix("Kilo: Auto")).toBe("Kilo: Auto")
    expect(stripSubProviderPrefix("Auto")).toBe("Auto")
  })
})
