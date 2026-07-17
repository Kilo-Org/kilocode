import { expect, test } from "bun:test"

// client.ts binds window.fetch once at import time, so every test must share the
// same window whose fetch writes into a swappable calls array.
let calls: Array<{ url: string; method: string; body: unknown }> = []

const win = {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    calls.push({ url: req.url, method: req.method, body: await req.json() })
    return new Response(JSON.stringify({ permission: { edit: { "*": "allow" } } }), {
      headers: { "content-type": "application/json" },
    })
  },
}

function setup() {
  calls = []
  Object.defineProperty(globalThis, "window", { value: win, configurable: true })
  return calls
}

test("config writes include the selected directory", async () => {
  const calls = setup()
  const client = await import("./client")
  const query = { url: "http://kilo:secret@127.0.0.1:4097", dir: "/tmp/project", scope: "project" as const }

  await client.saveConfig(query, { permission: { edit: { "*": "allow" } } })
  await client.unsetConfig(query, [["permission", "edit"]])
  await client.patchConfig(query, { indexing: { provider: "ollama" } }, [["indexing", "model"]])

  expect(calls).toHaveLength(3)

  const save = calls[0]
  const unset = calls[1]
  const patch = calls[2]
  expect(save.method).toBe("PATCH")
  expect(new URL(save.url).searchParams.get("directory")).toBe("/tmp/project")
  expect(save.body).toEqual({ scope: "project", set: { permission: { edit: { "*": "allow" } } } })

  expect(unset.method).toBe("PATCH")
  expect(new URL(unset.url).searchParams.get("directory")).toBe("/tmp/project")
  expect(unset.body).toEqual({ scope: "project", unset: [["permission", "edit"]] })

  expect(patch.method).toBe("PATCH")
  expect(new URL(patch.url).searchParams.get("directory")).toBe("/tmp/project")
  expect(patch.body).toEqual({
    scope: "project",
    set: { indexing: { provider: "ollama" } },
    unset: [["indexing", "model"]],
  })
})

test("agent variant writes use config overlay", async () => {
  const calls = setup()
  const client = await import("./client")
  const query = { url: "http://kilo:secret@127.0.0.1:4097", dir: "/tmp/project", scope: "project" as const }

  await client.saveAgentVariant(query, "code", "high")
  await client.saveAgentVariant(query, "code", "default")
  await client.saveAgentVariant(query, "code", "")

  expect(calls).toHaveLength(3)
  expect(calls[0]?.method).toBe("PATCH")
  expect(new URL(calls[0]!.url).searchParams.get("directory")).toBe("/tmp/project")
  expect(calls[0]?.body).toEqual({ scope: "project", set: { agent: { code: { variant: "high" } } } })
  expect(calls[1]?.body).toEqual({ scope: "project", set: { agent: { code: { variant: "default" } } } })
  expect(calls[2]?.body).toEqual({ scope: "project", unset: [["agent", "code", "variant"]] })
})

test("viewed snapshots post the presence payload against the selected directory", async () => {
  const calls = setup()
  const client = await import("./client")
  const query = { url: "http://kilo:secret@127.0.0.1:4097", dir: "/tmp/project" }
  const viewer = { id: "11111111-1111-4111-8111-111111111111", active: false }

  await client.viewProjectSessions(query, viewer, ["ses_selected", "ses_terminal"], [])

  expect(calls).toHaveLength(1)

  const viewed = calls[0]
  expect(viewed.method).toBe("POST")
  expect(new URL(viewed.url).pathname).toBe("/session/viewed")
  expect(new URL(viewed.url).searchParams.get("directory")).toBe("/tmp/project")
  expect(viewed.body).toEqual({
    viewer: { id: "11111111-1111-4111-8111-111111111111", active: false },
    attached: ["ses_selected", "ses_terminal"],
    visible: [],
  })
})
