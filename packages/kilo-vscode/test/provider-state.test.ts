import { describe, expect, it } from "bun:test"
import { requestState, type ProviderStateHost } from "../src/agent-manager/provider-state"

function host(calls: string[]) {
  return {
    relay: { reset: () => calls.push("relay") },
    terminalRouter: { dispose: async () => void calls.push("router") },
    scripts: { manager: { snapshot: () => void calls.push("snapshot") } },
    activity: { sync: () => void calls.push("activity") },
    stateReady: undefined,
    state: undefined,
    staleIds: new Set<string>(),
    contexts: { active: () => undefined },
    browserAutomation: () => false,
    postToWebview: () => undefined,
    log: () => undefined,
  } as unknown as ProviderStateHost
}

describe("Agent Manager requestState", () => {
  it("drops the terminal sockets of the previous webview before it pushes state", async () => {
    const calls: string[] = []
    await requestState(host(calls))
    expect(calls.slice(0, 2)).toEqual(["relay", "router"])
  })
})
