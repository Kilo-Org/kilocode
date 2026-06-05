import { expect, test } from "bun:test"

let current: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined

if (!("window" in globalThis)) {
  Object.defineProperty(globalThis, "window", {
    value: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        if (!current) throw new Error("fetch stub not installed")
        return current(input, init)
      },
    },
    configurable: true,
  })
}

function setup() {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  current = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    calls.push({ url: req.url, method: req.method, body: await req.json() })
    return new Response(JSON.stringify({ permission: { edit: { "*": "allow" } } }), {
      headers: { "content-type": "application/json" },
    })
  }
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
