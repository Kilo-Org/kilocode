import { describe, expect, it } from "bun:test"
import { configMessage } from "../../webview-ui/src/utils/open-config"

describe("configMessage", () => {
  it("builds a global config request with localized labels", () => {
    const message = configMessage("global", (key, params) => `${key}:${params?.scope ?? ""}`)

    expect(message.type).toBe("openConfigFile")
    expect(message.scope).toBe("global")
    expect(message.labels.scope).toBe("settings.config.scope.global:")
    expect(message.labels.title).toBe("settings.config.title:settings.config.scope.global:")
    expect(message.labels.openFailed).toBe("settings.config.openFailed:settings.config.scope.global:")
  })
})
