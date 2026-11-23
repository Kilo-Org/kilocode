import { expect, test } from "bun:test"
import { pullSyncedSession } from "../src/session-target"

const directory = "/workspace"

// A cold Location lists no plugins and answers `rpc.unavailable` until its first activation. The pull must wait
// for readiness first; otherwise it silently skips the import and the turn reuses the remote log's seq numbers.
const client = (input: { pulls: unknown[]; synced?: boolean }) => {
  const order: string[] = []
  let pluginReads = 0
  let pullCalls = 0
  return {
    order,
    get pullCalls() {
      return pullCalls
    },
    client: {
      plugin: {
        list: async () => {
          order.push("plugins")
          pluginReads++
          return { data: pluginReads >= 2 ? [{ id: "kilocode.session-sync" }] : [] }
        },
      },
      rpc: () => ({
        get: async () => {
          order.push("handshake")
          return {}
        },
        pull: async () => {
          order.push("pull")
          const next = input.pulls[pullCalls++]
          // The RPC client rejects with the service's error payload (`{type, data:{code}}`), not an Error.
          if (next !== null && typeof next === "object" && !("sessionID" in next)) throw next
          return next
        },
        synced: async () => {
          order.push("synced")
          return { sessionID: "ses_cold", synced: input.synced ?? false }
        },
      }),
    } as never,
  }
}

test("the implicit pull waits for the cold Location's plugins before it runs", async () => {
  const fake = client({ pulls: [{ sessionID: "ses_cold", outcome: "imported" }] })
  const result = await pullSyncedSession({ client: fake.client, sessionID: "ses_cold", directory })
  expect(result).toEqual({ type: "pulled", sessionID: "ses_cold", outcome: "imported" })
  expect(fake.order.slice(0, 2)).toEqual(["plugins", "plugins"])
  expect(fake.order.at(-1)).toBe("pull")
  expect(fake.order.indexOf("handshake")).toBeLessThan(fake.order.indexOf("pull"))
})

test("a transport failure for a known synced session is reported instead of continuing on a stale log", async () => {
  const fake = client({ pulls: [{ type: "failed", message: "rpc.unavailable (400)" }], synced: true })
  expect(await pullSyncedSession({ client: fake.client, sessionID: "ses_cold", directory })).toEqual({
    type: "failed",
    retryable: true,
    message: expect.stringContaining("not ready"),
  })
})

test("a transport failure for an unknown session stays a create-new path", async () => {
  const fake = client({ pulls: [{ type: "failed", message: "rpc.unavailable (400)" }], synced: false })
  expect(await pullSyncedSession({ client: fake.client, sessionID: "ses_cold", directory })).toEqual({ type: "absent" })
})

test("a rejected pull keeps its machine-readable code and does not claim to be retryable", async () => {
  const fake = client({
    pulls: [{ type: "failed", message: "rejected", data: { code: "diverged", message: "diverged" } }],
  })
  expect(await pullSyncedSession({ client: fake.client, sessionID: "ses_cold", directory })).toEqual({
    type: "failed",
    retryable: false,
    message: expect.stringContaining("diverged"),
  })
})

test("an unknown or unsynced session stays a create-new path", async () => {
  for (const code of ["session_not_found", "sync_disabled"]) {
    const fake = client({ pulls: [{ type: "failed", message: "absent", data: { code, message: "absent" } }] })
    expect(await pullSyncedSession({ client: fake.client, sessionID: "ses_cold", directory })).toEqual({ type: "absent" })
  }
})

test("a tombstone is its own outcome so the caller can refuse and offer --as-new", async () => {
  const fake = client({
    pulls: [{ type: "failed", message: "deleted", data: { code: "session_deleted", message: "deleted" } }],
  })
  expect(await pullSyncedSession({ client: fake.client, sessionID: "ses_cold", directory })).toEqual({ type: "deleted" })
})
