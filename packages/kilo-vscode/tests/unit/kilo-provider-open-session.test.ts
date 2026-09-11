import { describe, expect, test } from "bun:test"
import { KiloProvider } from "../../src/KiloProvider"

describe("KiloProvider.openSession", () => {
  test("waits for the webview before selecting a session", async () => {
    const provider = new KiloProvider({} as never, {} as never)
    const messages: unknown[] = []
    const state = provider as unknown as {
      webview: { postMessage: (message: unknown) => Promise<boolean> }
      isWebviewReady: boolean
      readyResolvers: Array<() => void>
      sessionDirectories: Map<string, string>
    }
    state.webview = {
      postMessage: async (message) => {
        messages.push(message)
        return true
      },
    }

    const pending = provider.openSession("s1", "C:\\repo")
    expect(messages).toEqual([])
    expect(state.sessionDirectories.get("s1")).toBe("C:\\repo")

    state.isWebviewReady = true
    state.readyResolvers.splice(0).forEach((resolve) => resolve())
    await pending

    expect(messages).toEqual([{ type: "openSession", sessionID: "s1" }])
  })
})
