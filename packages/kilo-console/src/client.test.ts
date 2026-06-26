import { beforeAll, beforeEach, describe, expect, test } from "bun:test"

const calls: Array<{ url: string; method: string; body: unknown; directory: string | null }> = []
let failed: { status: number; body: unknown } | undefined
let client: typeof import("./client")

function response(req: Request, body: unknown) {
  const path = new URL(req.url).pathname
  if (path === "/kilocode/stack/catalog") {
    return {
      catalog: { revision: "2026-06-22.1", verticals: [], resources: [] },
      resources: [],
      expected_resources: [],
    }
  }
  if (path === "/kilocode/stack") {
    return {
      draft: { verticals: {}, resources: {} },
      resources: [],
      conflicts: [],
      config_revision: "sha256:config",
      catalog_revision: "2026-06-22.1",
    }
  }
  if (path === "/kilocode/stack/preview") {
    const input = body as { draft: unknown }
    return {
      draft: input.draft,
      actions: [],
      conflicts: [],
      warnings: [],
      prerequisites: [],
      config_revision: "sha256:config",
      catalog_revision: "2026-06-22.1",
      plan_hash: "sha256:exact",
    }
  }
  if (path === "/kilocode/stack/apply") {
    const input = body as { draft: unknown }
    return {
      results: [],
      state: {
        draft: input.draft,
        resources: [],
        conflicts: [],
        config_revision: "sha256:next",
        catalog_revision: "2026-06-22.1",
      },
    }
  }
  return { permission: { edit: { "*": "allow" } } }
}

beforeAll(async () => {
  const win = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      const text = await req.clone().text()
      const body = text ? JSON.parse(text) : undefined
      calls.push({
        url: req.url,
        method: req.method,
        body,
        directory: req.headers.get("x-kilo-directory"),
      })
      const error = new URL(req.url).pathname === "/kilocode/stack/apply" ? failed : undefined
      return new Response(JSON.stringify(error?.body ?? response(req, body)), {
        status: error?.status ?? 200,
        headers: { "content-type": "application/json" },
      })
    },
  }
  Object.defineProperty(globalThis, "window", { value: win, configurable: true })
  client = await import("./client")
})

beforeEach(() => {
  calls.length = 0
  failed = undefined
})

describe("Kilo Console SDK transport", () => {
  test("config writes include the selected directory", async () => {
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

  test("preserves typed Stack apply rollback details from the generated SDK", async () => {
    const detail = {
      code: "apply_failed" as const,
      message: "Stack changes could not be applied.",
      rollback: true,
      results: [{ resource: "skill:dbt", action: "install" as const, success: false, message: "Artifact move failed" }],
    }
    failed = { status: 500, body: detail }
    const query = { url: "http://kilo:secret@127.0.0.1:4097", dir: "/tmp/project", scope: "project" as const }
    const draft = { verticals: { data: { technologies: ["dbt"] } }, resources: {} }
    const error = await client.applyStack(query, draft, "sha256:exact").then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(error).toBeInstanceOf(client.StackRequestError)
    expect(client.stackApplyFailure(error)).toEqual(detail)
    expect((error as InstanceType<typeof client.StackRequestError>).status).toBe(500)
  })

  test("maps Stack catalog, get, preview, and exact-hash apply through the generated SDK", async () => {
    const query = { url: "http://kilo:secret@127.0.0.1:4097", dir: "/tmp/project", scope: "project" as const }
    const draft = { verticals: { data: { technologies: ["dbt"] } }, resources: {} }

    const bundle = await client.loadStack(query)
    const plan = await client.previewStack(query, draft)
    const result = await client.applyStack(query, plan.draft, plan.plan_hash)

    expect(bundle.catalog.catalog.revision).toBe("2026-06-22.1")
    expect(result.state.draft).toEqual(draft)
    expect(calls.map((item) => [item.method, new URL(item.url).pathname])).toEqual([
      ["GET", "/kilocode/stack/catalog"],
      ["GET", "/kilocode/stack"],
      ["POST", "/kilocode/stack/preview"],
      ["POST", "/kilocode/stack/apply"],
    ])
    expect(new URL(calls[0].url).searchParams.get("directory")).toBe("/tmp/project")
    expect(new URL(calls[1].url).searchParams.get("directory")).toBe("/tmp/project")
    expect(calls[2].directory).toBe("%2Ftmp%2Fproject")
    expect(calls[2].body).toEqual({ draft })
    expect(calls[3].body).toEqual({ draft, plan_hash: "sha256:exact" })
  })
})
