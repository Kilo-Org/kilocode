import { expect, test } from "bun:test"
import { Effect } from "effect"
import { McpOAuthProvider } from "../../../src/mcp/oauth-provider"
import type { McpAuth } from "../../../src/mcp/auth"

// Covers the Kilo-specific conditional credential invalidation added to McpOAuthProvider:
// automatic invalidation must clear only the credential the failed request presented and must
// never delete a value blindly.

function recordingAuth() {
  const calls: Array<{ name: string; type: string; expected: unknown }> = []
  const auth = {
    invalidate: (name: string, type: string, expected: unknown) => {
      calls.push({ name, type, expected })
      return Effect.succeed({ _tag: "cleared", entry: {} } as const)
    },
  } as unknown as McpAuth.Interface
  return { auth, calls }
}

const provider = (auth: McpAuth.Interface) =>
  new McpOAuthProvider("test-server", "https://mcp.example.com/mcp", {}, { onRedirect: async () => {} }, auth)

test("does nothing destructive without a recorded rejected credential", async () => {
  const { auth, calls } = recordingAuth()
  await provider(auth).invalidateCredentials("tokens")
  expect(calls).toEqual([])
})

test("maps tokens to a tokens-scoped conditional clear", async () => {
  const { auth, calls } = recordingAuth()
  const p = provider(auth)
  p.markRejected({ serverUrl: "https://mcp.example.com/mcp", refreshToken: "R1" })
  await p.invalidateCredentials("tokens")
  expect(calls).toHaveLength(1)
  expect(calls[0].type).toBe("tokens")
  expect(calls[0].expected).toMatchObject({ refreshToken: "R1" })
})

test("maps all to a client-scoped conditional clear using the recorded fingerprint", async () => {
  const { auth, calls } = recordingAuth()
  const p = provider(auth)
  // "all" is raised for a rejected client registration; it must not clear an entry blindly.
  p.markRejected({ serverUrl: "https://mcp.example.com/mcp", clientId: "c1" })
  await p.invalidateCredentials("all")
  expect(calls).toHaveLength(1)
  expect(calls[0].type).toBe("client")
  expect(calls[0].expected).toMatchObject({ clientId: "c1" })
})

test("falls back to the URL-bound client when all is raised without a recorded fingerprint", async () => {
  const { auth, calls } = recordingAuth()
  // A rejected client that the guard could not fingerprint must still be cleared, otherwise a
  // stale client (for example an expired secret) would be retried forever.
  await provider(auth).invalidateCredentials("all")
  expect(calls).toHaveLength(1)
  expect(calls[0].type).toBe("client")
  expect(calls[0].expected).toEqual({ serverUrl: "https://mcp.example.com/mcp" })
})

test("clears the recorded fingerprint after use", async () => {
  const { auth, calls } = recordingAuth()
  const p = provider(auth)
  p.markRejected({ serverUrl: "https://mcp.example.com/mcp", refreshToken: "R1" })
  await p.invalidateCredentials("tokens")
  await p.invalidateCredentials("tokens")
  expect(calls).toHaveLength(1)
})
