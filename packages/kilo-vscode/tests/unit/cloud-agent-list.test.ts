import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { listCloudAgentSessions } from "../../src/agent-manager/cloud-agent/list"

const ROW = {
  session_id: "ses_cloud",
  title: "Cloud run",
  created_at: "2026-06-17T10:00:00.000Z",
  updated_at: "2026-06-17T10:01:00.000Z",
  version: 1,
}

function client(run: (params: unknown, options: unknown) => Promise<unknown>): KiloClient {
  return { kilo: { cloudSessions: run } } as unknown as KiloClient
}

describe("listCloudAgentSessions", () => {
  it("uses the local Kilo SDK with a repository filter and bounded result count", async () => {
    const calls: Array<{ params: unknown; options: unknown }> = []
    const sdk = client(async (params, options) => {
      calls.push({ params, options })
      return { data: { cliSessions: [ROW], nextCursor: null } }
    })

    const sessions = await listCloudAgentSessions({
      client: sdk,
      gitUrl: "https://github.com/kilo-org/kilocode",
    })

    expect(calls).toEqual([
      {
        params: { gitUrl: "https://github.com/kilo-org/kilocode", limit: 100 },
        options: { throwOnError: true },
      },
    ])
    expect(sessions).toEqual([
      {
        id: "ses_cloud",
        title: "Cloud run",
        createdAt: "2026-06-17T10:00:00.000Z",
        updatedAt: "2026-06-17T10:01:00.000Z",
      },
    ])
  })

  it("normalizes empty titles without exposing facade response fields", async () => {
    const sdk = client(async () => ({
      data: { cliSessions: [{ ...ROW, title: "   " }], nextCursor: "ignored" },
    }))

    await expect(listCloudAgentSessions({ client: sdk, gitUrl: "https://gitlab.com/kilo/project" })).resolves.toEqual([
      {
        id: "ses_cloud",
        title: "Untitled Cloud Agent",
        createdAt: ROW.created_at,
        updatedAt: ROW.updated_at,
      },
    ])
  })

  it("rejects a malformed SDK response", async () => {
    const sdk = client(async () => ({ data: { sessions: [] } }))

    await expect(
      listCloudAgentSessions({ client: sdk, gitUrl: "https://github.com/kilo-org/kilocode" }),
    ).rejects.toThrow("invalid response")
  })
})
