import { describe, expect, it } from "bun:test"
import { createHostedBridge } from "../../webview-ui/src/context/hosted-session-bridge"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages"

type Loaded = Extract<ExtensionMessage, { type: "hostedSessionLoaded" }>

function loaded(key: string): Loaded {
  return {
    type: "hostedSessionLoaded",
    key,
    providerID: "kilo-cloud",
    sessionID: key,
    session: { id: key, title: key, time: { created: 1, updated: 2 } },
    title: key,
    messages: [],
  }
}

function bridge(current: string | undefined, calls: string[]) {
  return createHostedBridge({
    store: (() => undefined) as never,
    loaded: () => calls.push("loaded"),
    page: () => calls,
    toolParts: () => calls,
    isolate: (part) => part,
    current: () => current,
    focus: (key) => calls.push(`focus:${key}`),
    draft: (key) => calls.push(`draft:${key}`),
    loading: (value) => calls.push(`loading:${value}`),
    clearDraft: () => calls.push("clearDraft"),
    connected: () => true,
    post: (message) => calls.push(`post:${message.type}`),
    batch: (run) => run(),
  })
}

describe("hosted session bridge", () => {
  it("does not pull the user back when a late load is no longer the current session", () => {
    const key = "host:kilo-cloud:ses_a"
    const calls: string[] = []
    bridge("ses_other", calls).handle(loaded(key))

    // Data is still written so a later selection is warm, but focus and the
    // loading state belong to the session the user is actually on.
    expect(calls).toContain("loaded")
    expect(calls).not.toContain(`focus:${key}`)
    expect(calls.some((call) => call.startsWith("loading:"))).toBe(false)
  })

  it("clears loading when the loaded session is still current", () => {
    const key = "host:kilo-cloud:ses_a"
    const calls: string[] = []
    bridge(key, calls).handle(loaded(key))

    expect(calls).toContain("loading:false")
  })
})
