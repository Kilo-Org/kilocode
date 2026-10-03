import { describe, expect, it, mock } from "bun:test"
import { mcpAuth } from "../../src/services/mcp-auth"

const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  handleMcpMessage(message: unknown): Promise<boolean>
  fetchAndSendMcpStatus(): Promise<void>
  fetchAndSendMcpAuthState(): void
  fetchAndSendMcpBundles(): Promise<void>
  refreshMcpAuthConsumers(): Promise<void>
  handleRemoveMcp(name: string): Promise<void>
  handleSignInMcp(name: string, notify: boolean): Promise<void>
  handleResetMcpAuth(name: string): Promise<void>
}

function actions() {
  const connection = {
    getClient: () => undefined,
    getClientAsync: async () => ({}),
  } as never
  const provider = new KiloProvider({} as never, connection)
  const internal = provider as unknown as Internals
  const calls: string[] = []
  const auth = mcpAuth(connection)
  auth.signIn = async (_dir, name) => {
    calls.push(`signIn:${name}`)
    return { status: "connected" }
  }
  auth.reset = async (_dir, name) => {
    calls.push(`reset:${name}`)
    return true
  }
  internal.refreshMcpAuthConsumers = async () => void calls.push("status")
  provider.postMessage = (message) => calls.push(`post:${(message as { type: string }).type}`)
  return { internal, calls }
}

/**
 * MCP messages are routed ahead of KiloProvider's main message switch (to keep
 * that function inside its complexity budget), so the routing table itself is
 * the contract worth locking down: every MCP message type must be claimed, and
 * nothing else may be.
 */
function setup() {
  const calls: string[] = []
  const provider = new KiloProvider(
    {} as never,
    {
      getClient: () => undefined,
      getClientAsync: async () => ({
        mcp: { auth: { cancel: async () => ({ response: { ok: true } }) } },
      }),
    } as never,
  )
  const internal = provider as unknown as Internals
  Object.assign(internal, {
    fetchAndSendMcpStatus: async () => void calls.push("status"),
    fetchAndSendMcpAuthState: async () => void calls.push("authState"),
    refreshMcpAuthConsumers: async () => void calls.push("authConsumers"),
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
    expect(calls).toEqual(["status", "authConsumers", "bundles"])
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

  it("refreshes MCP status after sign-in", async () => {
    const { internal, calls } = actions()
    await internal.handleSignInMcp("anaconda", false)
    expect(calls).toEqual(["signIn:anaconda", "post:mcpAuthResult", "status"])
  })

  it("refreshes MCP status after resetting auth", async () => {
    const { internal, calls } = actions()
    await internal.handleResetMcpAuth("anaconda")
    expect(calls).toEqual(["reset:anaconda", "status"])
  })

  it("refreshes status and invalidates Agent Behaviour after shared auth changes", async () => {
    const status = mock(async () => ({ data: { anaconda: { status: "connected" as const } } }))
    const client = { mcp: { status } }
    const connection = {
      getClient: () => client,
      getClientAsync: async () => client,
      onEvent: () => () => {},
    }
    const provider = new KiloProvider({} as never, connection as never)
    const internal = provider as unknown as Internals
    const messages: string[] = []
    ;(internal as unknown as { postMessage(message: unknown): void }).postMessage = (message) =>
      messages.push((message as { type: string }).type)

    await Promise.all([internal.refreshMcpAuthConsumers(), internal.refreshMcpAuthConsumers()])

    expect(status).toHaveBeenCalledTimes(1)
    expect(messages).toEqual(["mcpAuthState", "mcpStatusLoaded", "agentBehaviourInvalidated"])
  })
})
