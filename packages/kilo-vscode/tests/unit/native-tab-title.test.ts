import { describe, expect, it } from "bun:test"
import type { Session } from "@kilocode/sdk/v2/client"
import { nativeTitle } from "../../src/kilo-provider/native-tab-title"

const session = (title: string | null) => ({ title }) as Session

describe("nativeTitle", () => {
  it("uses the default title without a useful session title", () => {
    expect(nativeTitle(null)).toBe("Kilo Code")
    expect(nativeTitle(session(""))).toBe("Kilo Code")
    expect(nativeTitle(session("New session - 2026-05-06T10:39:00.000Z"))).toBe("Kilo Code")
  })

  it("keeps short session titles", () => {
    expect(nativeTitle(session("Greeting"))).toBe("Greeting")
  })

  it("truncates long session titles", () => {
    expect(nativeTitle(session("Dynamic VS Code tab titles for Kilo sessions"))).toBe("Dynamic VS Code tab...")
  })

  it("updates the native panel only from valid webview activity reports", async () => {
    const { KiloProvider } = await import("../../src/KiloProvider")
    const titles: string[] = []
    const listener: { current?: (message: { type: string; state: unknown }) => Promise<void> } = {}
    const provider = new KiloProvider(
      { fsPath: "/extension" } as never,
      {
        unregisterVisible: () => {},
        unregisterAttached: () => {},
        onSessionAcknowledged: () => () => {},
      } as never,
      undefined,
      { tabTitle: (title) => titles.push(title) },
    )
    const internal = provider as unknown as { setupWebviewMessageHandler: (webview: unknown) => void }
    internal.setupWebviewMessageHandler({
      onDidReceiveMessage: (handler: NonNullable<typeof listener.current>) => {
        listener.current = handler
        return { dispose: () => {} }
      },
    })
    for (const state of ["busy", "waiting", "done", "error", "idle", "idle", "invalid", null]) {
      await listener.current?.({ type: "sessionActivity", state })
    }
    expect(titles).toEqual(["◔ Kilo Code", "⚠ Kilo Code", "✓ Kilo Code", "⚠ Kilo Code", "Kilo Code"])
    provider.dispose()
  })

  it("renders the same activity values used by webview tabs and worktrees", () => {
    expect(nativeTitle(session("Greeting"), "busy")).toBe("◔ Greeting")
    expect(nativeTitle(session("Greeting"), "retry")).toBe("◔ Greeting")
    expect(nativeTitle(session("Greeting"), "waiting")).toBe("⚠ Greeting")
    expect(nativeTitle(session("Greeting"), "error")).toBe("⚠ Greeting")
    expect(nativeTitle(session("Greeting"), "done")).toBe("✓ Greeting")
    expect(nativeTitle(session("Greeting"), "idle")).toBe("Greeting")
    expect(nativeTitle(session("Greeting"), "waiting", "Agent Manager")).toBe("⚠ Agent Manager")
  })
})
