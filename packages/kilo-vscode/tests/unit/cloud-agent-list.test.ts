import { describe, expect, it } from "bun:test"
import { isCloudAgentUnauthorized } from "../../src/agent-manager/cloud-agent/errors"
import { CloudAgentSessionListError, listCloudAgentSessions } from "../../src/agent-manager/cloud-agent/list"

const SESSION = {
  id: "ses_cloud",
  slug: "ses_cloud",
  projectID: "cloud-agent",
  directory: "/cloud-agent/sessions/ses_cloud",
  title: "Cloud run",
  version: "cloud-agent",
  time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
}

describe("listCloudAgentSessions", () => {
  it("requests repository-filtered facade sessions without exposing credentials", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const sessions = await listCloudAgentSessions({
      url: "https://cloud.example/kilo",
      token: "secret",
      gitUrl: "https://github.com/Kilo-Org/kilocode",
      fetch: async (input, init) => {
        calls.push({ url: String(input), init })
        return Response.json([SESSION])
      },
    })

    expect(sessions).toEqual([SESSION])
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!.url)
    expect(url.origin + url.pathname).toBe("https://cloud.example/kilo/session")
    expect(url.searchParams.get("gitUrl")).toBe("https://github.com/Kilo-Org/kilocode")
    expect(url.searchParams.get("limit")).toBe("100")
    expect(calls[0]!.init).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer secret" },
      redirect: "error",
    })
  })

  it("preserves unauthorized status without returning response details", async () => {
    const error = await listCloudAgentSessions({
      url: "https://cloud.example/kilo",
      token: "secret",
      gitUrl: "https://github.com/Kilo-Org/kilocode",
      fetch: async () => new Response("raw secret", { status: 401 }),
    }).catch((err) => err)

    expect(error).toBeInstanceOf(CloudAgentSessionListError)
    expect(isCloudAgentUnauthorized(error)).toBe(true)
    expect(error.message).not.toContain("raw secret")
  })

  it("rejects malformed responses and unsafe facade URLs", async () => {
    await expect(
      listCloudAgentSessions({
        url: "https://cloud.example/kilo",
        token: "secret",
        gitUrl: "https://github.com/Kilo-Org/kilocode",
        fetch: async () => Response.json([{ ...SESSION, time: { created: "bad", updated: 1 } }]),
      }),
    ).rejects.toThrow("invalid response")

    for (const url of [
      "http://cloud.example/kilo",
      "https://user:secret@cloud.example/kilo",
      "https://cloud.example/kilo?token=secret",
      "https://cloud.example/kilo#secret",
    ]) {
      await expect(
        listCloudAgentSessions({
          url,
          token: "secret",
          gitUrl: "https://github.com/Kilo-Org/kilocode",
          fetch: async () => Response.json([]),
        }),
        url,
      ).rejects.toThrow("secure origin")
    }
  })
})
