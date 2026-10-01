import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  handleMcpMessage(message: unknown): Promise<boolean>
  fetchAndSendMcpStatus(): Promise<void>
  fetchAndSendMcpAuthState(): Promise<void>
  fetchAndSendMcpBundles(): Promise<void>
  handleRemoveMcp(name: string): Promise<void>
  handleSignInMcp(name: string, notify: boolean): Promise<void>
  handleResetMcpAuth(name: string): Promise<void>
}

/**
 * MCP messages are routed ahead of KiloProvider's main message switch (to keep
 * that function inside its complexity budget), so the routing table itself is
 * the contract worth locking down: every MCP message type must be claimed, and
 * nothing else may be.
 */
function setup() {
  const calls: string[] = []
  const provider = new KiloProvider({} as never, { getClient: () => undefined } as never)
  const internal = provider as unknown as Internals
  Object.assign(internal, {
    fetchAndSendMcpStatus: async () => void calls.push("status"),
    fetchAndSendMcpAuthState: async () => void calls.push("authState"),
    fetchAndSendMcpBundles: async () => void calls.push("bundles"),
    handleRemoveMcp: async (name: string) => void calls.push(`remove:${name}`),
    handleSignInMcp: async (name: string, notify: boolean) => void calls.push(`signIn:${name}:${notify}`),
    handleResetMcpAuth: async (name: string) => void calls.push(`reset:${name}`),
  })
  return { internal, calls }
}

describe("KiloProvider MCP message routing", () => {
  it("claims every MCP message type", async () => {
    const { internal } = setup()
    for (const type of [
      "removeMcp",
      "requestMcpStatus",
      "connectMcp",
      "disconnectMcp",
      "requestMcpAuthState",
      "signInMcp",
      "cancelMcpSignIn",
      "resetMcpAuth",
      "requestMcpBundles",
    ]) {
      expect(await internal.handleMcpMessage({ type, name: "anaconda" }), type).toBe(true)
    }
  })

  it("does not claim unrelated or malformed messages", async () => {
    const { internal } = setup()
    expect(await internal.handleMcpMessage({ type: "requestAgents" })).toBe(false)
    expect(await internal.handleMcpMessage({ type: "sendMessage" })).toBe(false)
    expect(await internal.handleMcpMessage({})).toBe(false)
    expect(await internal.handleMcpMessage({ type: 42 })).toBe(false)
    // Guards against a prefix-matching implementation claiming too much.
    expect(await internal.handleMcpMessage({ type: "requestMcpSomethingElse" })).toBe(false)
  })

  it("routes each request message to its fetcher", async () => {
    const { internal, calls } = setup()
    await internal.handleMcpMessage({ type: "requestMcpStatus" })
    await internal.handleMcpMessage({ type: "requestMcpAuthState" })
    await internal.handleMcpMessage({ type: "requestMcpBundles" })
    expect(calls).toEqual(["status", "authState", "bundles"])
  })

  it("routes named actions and defaults signInMcp to notifying", async () => {
    const { internal, calls } = setup()
    await internal.handleMcpMessage({ type: "removeMcp", name: "anaconda" })
    await internal.handleMcpMessage({ type: "signInMcp", name: "anaconda" })
    await internal.handleMcpMessage({ type: "signInMcp", name: "anaconda", notify: false })
    await internal.handleMcpMessage({ type: "resetMcpAuth", name: "anaconda" })
    expect(calls).toEqual(["remove:anaconda", "signIn:anaconda:true", "signIn:anaconda:false", "reset:anaconda"])
  })

  it("claims but ignores named actions with no server name", async () => {
    const { internal, calls } = setup()
    expect(await internal.handleMcpMessage({ type: "signInMcp" })).toBe(true)
    expect(await internal.handleMcpMessage({ type: "removeMcp" })).toBe(true)
    expect(calls).toEqual([])
  })
})
