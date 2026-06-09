import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import {
  CloudAgentDisconnectedError,
  CloudAgentSignedOutError,
  isCloudAgentUnauthorized,
} from "../../src/agent-manager/cloud-agent/errors"
import { CloudAgentStaleTokenError, CloudAgentTokenManager } from "../../src/agent-manager/cloud-agent/token"

const token = {
  token: "secret",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  kiloFacadeUrl: "https://cloud.example/kilo",
  cloudAgentUrl: "https://cloud.example",
}

function client(fetch: () => Promise<{ data?: unknown; error?: unknown }>): KiloClient {
  return {
    kilo: { cloudAgent: { credentials: fetch } },
  } as unknown as KiloClient
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("CloudAgentTokenManager", () => {
  it("deduplicates concurrent localhost credential fetches and caches fresh envelopes", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        return { data: token }
      }),
    )

    const [left, right] = await Promise.all([manager.get(), manager.get()])

    expect(left).toEqual(token)
    expect(right).toBe(left)
    expect(await manager.get()).toBe(left)
    expect(calls).toBe(1)
  })

  it("clear drops the cached token so the next request refetches", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        return { data: { ...token, token: `secret-${calls}` } }
      }),
    )

    expect((await manager.get()).token).toBe("secret-1")
    manager.clear()
    expect((await manager.get()).token).toBe("secret-2")
  })

  it("rejects and does not recache an in-flight envelope cleared before completion", async () => {
    let calls = 0
    const gate = deferred<{ data: unknown }>()
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        if (calls === 1) return gate.promise
        return { data: { ...token, token: "secret-2" } }
      }),
    )

    const stale = manager.get()
    manager.clear()
    gate.resolve({ data: { ...token, token: "secret-1" } })
    await expect(stale).rejects.toBeInstanceOf(CloudAgentStaleTokenError)
    expect((await manager.get()).token).toBe("secret-2")
    expect(calls).toBe(2)
  })

  it("refetches credentials inside the five-minute freshness buffer", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        return {
          data: {
            ...token,
            token: `secret-${calls}`,
            expiresAt: new Date(Date.now() + (calls === 1 ? 4 : 60) * 60 * 1000).toISOString(),
          },
        }
      }),
    )

    expect((await manager.get()).token).toBe("secret-1")
    expect((await manager.get()).token).toBe("secret-2")
    expect(calls).toBe(2)
  })

  it("does not cool down disconnected localhost readiness", async () => {
    let current: KiloClient | null = null
    let calls = 0
    const manager = new CloudAgentTokenManager(() => current)

    await expect(manager.get()).rejects.toBeInstanceOf(CloudAgentDisconnectedError)
    current = client(async () => {
      calls += 1
      return { data: token }
    })

    expect(await manager.get()).toEqual(token)
    expect(calls).toBe(1)
  })

  it("does not cool down signed-out localhost credential responses", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        if (calls === 1) return { error: { status: 401 } }
        return { data: token }
      }),
    )

    await expect(manager.get()).rejects.toBeInstanceOf(CloudAgentSignedOutError)
    expect(await manager.get()).toEqual(token)
    expect(calls).toBe(2)
  })

  it("does not cool down rejected signed-out localhost credential responses", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        if (calls === 1) throw { response: { status: 401 } }
        return { data: token }
      }),
    )

    await expect(manager.get()).rejects.toBeInstanceOf(CloudAgentSignedOutError)
    expect(await manager.get()).toEqual(token)
    expect(calls).toBe(2)
  })

  it("does not serialize or cool down circular signed-out localhost credential responses", async () => {
    let calls = 0
    const err: Record<string, unknown> = { status: 401 }
    err.error = err
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        if (calls === 1) return { error: err }
        return { data: token }
      }),
    )

    await expect(manager.get()).rejects.toBeInstanceOf(CloudAgentSignedOutError)
    expect(await manager.get()).toEqual(token)
    expect(calls).toBe(2)
  })

  it("rejects localhost credential envelopes without an orchestration URL", async () => {
    const manager = new CloudAgentTokenManager(() =>
      client(async () => ({
        data: {
          token: token.token,
          expiresAt: token.expiresAt,
          kiloFacadeUrl: token.kiloFacadeUrl,
        },
      })),
    )

    await expect(manager.get()).rejects.toThrow("Malformed Cloud Agent credentials response: missing cloudAgentUrl")
  })

  it("applies a cooldown after malformed localhost credential envelopes", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        return { data: {} }
      }),
    )

    await expect(manager.get()).rejects.toThrow("Malformed Cloud Agent credentials response")
    await expect(manager.get()).rejects.toThrow("Cloud Agent token fetch on cooldown")
    expect(calls).toBe(1)
  })

  it("applies a cooldown after ordinary localhost credential fetch failures", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        return { error: "temporary failure" }
      }),
    )

    await expect(manager.get()).rejects.toThrow("Cloud Agent credentials fetch failed: temporary failure")
    await expect(manager.get()).rejects.toThrow("Cloud Agent token fetch on cooldown")
    expect(calls).toBe(1)
  })

  it("falls back safely when ordinary localhost credential errors cannot be serialized", async () => {
    let calls = 0
    const err: Record<string, unknown> = { status: 500 }
    err.error = err
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        return { error: err }
      }),
    )

    await expect(manager.get()).rejects.toThrow("Cloud Agent credentials fetch failed: unserializable error")
    await expect(manager.get()).rejects.toThrow("Cloud Agent token fetch on cooldown")
    expect(calls).toBe(1)
  })

  it("retry clears transient cooldown without discarding a valid cached envelope", async () => {
    let calls = 0
    const manager = new CloudAgentTokenManager(() =>
      client(async () => {
        calls += 1
        if (calls === 1) return { data: { ...token, expiresAt: new Date(Date.now() + 60 * 1000).toISOString() } }
        return { error: "temporary failure" }
      }),
    )

    const cached = await manager.get()
    await expect(manager.get()).rejects.toThrow("Cloud Agent credentials fetch failed: temporary failure")
    manager.retry()

    expect(manager.peek()).toBe(cached)
    await expect(manager.get()).rejects.toThrow("Cloud Agent credentials fetch failed: temporary failure")
    expect(calls).toBe(3)
  })
})

describe("isCloudAgentUnauthorized", () => {
  it("recognizes supported unauthorized shapes recursively", () => {
    expect(isCloudAgentUnauthorized({ status: 401 })).toBe(true)
    expect(isCloudAgentUnauthorized({ statusCode: 401 })).toBe(true)
    expect(isCloudAgentUnauthorized({ response: { status: 401 } })).toBe(true)
    expect(isCloudAgentUnauthorized({ _tag: "UnauthorizedError" })).toBe(true)
    expect(isCloudAgentUnauthorized({ name: "HTTP 401" })).toBe(true)
    expect(isCloudAgentUnauthorized({ message: "request unauthorized" })).toBe(true)
    expect(isCloudAgentUnauthorized({ error: { message: "HTTP 401" } })).toBe(true)
  })

  it("rejects ordinary errors", () => {
    expect(isCloudAgentUnauthorized({ status: 500, message: "temporary failure" })).toBe(false)
  })
})
