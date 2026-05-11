import { describe, expect, test } from "bun:test"
import { CodexAuthExpiredError, refreshCodexAuth } from "../../src/kilocode/provider/codex-refresh"
import type { PluginInput } from "@kilocode/plugin"

type Auth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

const expired = (): Auth => ({
  type: "oauth",
  access: "old-access",
  refresh: "old-refresh",
  expires: 0,
})

function plugin(persist: (auth: Auth) => void): PluginInput {
  const set = async (req: { body: Auth }) => {
    persist(req.body)
  }
  return {
    client: {
      auth: { set },
    },
  } as unknown as PluginInput
}

describe("Codex auth refresh", () => {
  test("coalesces concurrent refreshes and persists rotated tokens", async () => {
    const calls: string[] = []
    const writes: Auth[] = []
    const auth = expired()
    const refresh = async (token: string) => {
      calls.push(token)
      await new Promise((resolve) => setTimeout(resolve, 1))
      return { id_token: "", access_token: "next-access", refresh_token: "next-refresh", expires_in: 60 }
    }

    const [first, second] = await Promise.all([
      refreshCodexAuth({
        input: plugin((auth) => writes.push(auth)),
        getAuth: async () => auth,
        auth,
        refresh,
        account: () => undefined,
      }),
      refreshCodexAuth({
        input: plugin((auth) => writes.push(auth)),
        getAuth: async () => auth,
        auth,
        refresh,
        account: () => undefined,
      }),
    ])

    expect(calls).toEqual(["old-refresh"])
    expect(writes).toHaveLength(1)
    expect(first.access).toBe("next-access")
    expect(second.refresh).toBe("next-refresh")
  })

  test("uses a newer stored token after refresh 401", async () => {
    const fresh = {
      type: "oauth" as const,
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: Date.now() + 60_000,
    }
    const auth = expired()
    let count = 0
    const getAuth = async () => {
      count++
      return count === 1 ? auth : fresh
    }

    const result = await refreshCodexAuth({
      input: plugin(() => {}),
      getAuth,
      auth,
      refresh: async () => {
        throw new Error("Token refresh failed: 401")
      },
      account: () => undefined,
    })

    expect(result).toBe(fresh)
  })

  test("throws reauth error when refresh 401 has no newer stored token", async () => {
    const auth = expired()
    await expect(
      refreshCodexAuth({
        input: plugin(() => {}),
        getAuth: async () => auth,
        auth,
        refresh: async () => {
          throw new Error("Token refresh failed: 401")
        },
        account: () => undefined,
      }),
    ).rejects.toBeInstanceOf(CodexAuthExpiredError)
  })
})
