import { describe, expect, it } from "bun:test"
import type { KiloConnectionService } from "../../src/services/cli-backend"
import { StackClientError, StackHttpClient } from "../../src/stack/client"
import type { StackCatalog, StackDraft, StackProjectState } from "../../src/stack/types"

const draft: StackDraft = {
  verticals: { data: { technologies: ["dbt"] } },
  resources: { "skill:dbt": { enabled: true } },
}

const catalog: StackCatalog = {
  catalog: { revision: "one", verticals: [], resources: [] },
  resources: [],
  expected_resources: [],
}

const state: StackProjectState = {
  draft,
  resources: [],
  conflicts: [],
  config_revision: "config-1",
  catalog_revision: "one",
}

function response<T>(data: T) {
  return { data, error: undefined, response: new Response() }
}

function connection(stack: Record<string, (...args: never[]) => unknown>) {
  return {
    getClientAsync: async () => ({ stack }),
  } as unknown as KiloConnectionService
}

describe("Stack SDK adapter", () => {
  it("loads the generated catalog wrapper and project state with directory-scoped SDK calls", async () => {
    const calls: unknown[] = []
    const client = new StackHttpClient(
      connection({
        catalog: (input: unknown) => {
          calls.push(["catalog", input])
          return response(catalog)
        },
        get: (input: unknown) => {
          calls.push(["get", input])
          return response(state)
        },
      }),
    )

    const result = await client.load("/workspace/project")

    expect(result.catalog.catalog.revision).toBe("one")
    expect(calls).toEqual([
      ["catalog", { directory: "/workspace/project" }],
      ["get", { directory: "/workspace/project" }],
    ])
  })

  it("forwards generated preview and apply inputs with the exact plan hash", async () => {
    const calls: unknown[] = []
    const plan = {
      draft,
      plan_hash: "sha256:exact",
      config_revision: "config-1",
      catalog_revision: "one",
      actions: [],
      conflicts: [],
      warnings: [],
      prerequisites: [],
    }
    const result = { results: [], state }
    const client = new StackHttpClient(
      connection({
        preview: (input: unknown) => {
          calls.push(["preview", input])
          return response(plan)
        },
        apply: (input: unknown) => {
          calls.push(["apply", input])
          return response(result)
        },
      }),
    )

    await client.preview("/project", draft)
    await client.apply("/project", draft, "sha256:exact")

    expect(calls).toEqual([
      ["preview", { directory: "/project", stackPreviewInput: { draft } }],
      ["apply", { directory: "/project", stackApplyInput: { draft, plan_hash: "sha256:exact" } }],
    ])
  })

  it("preserves typed apply rollback and per-action failure details", async () => {
    const detail = {
      code: "apply_failed" as const,
      message: "Stack changes could not be applied.",
      rollback: false,
      results: [
        {
          resource: "skill:dbt",
          action: "install" as const,
          success: false,
          message: "Install failed.",
        },
      ],
    }
    const client = new StackHttpClient(
      connection({
        apply: () => ({
          data: undefined,
          error: detail,
          response: new Response(undefined, { status: 500 }),
        }),
      }),
    )

    const error = await client.apply("/project", draft, "exact").catch((value: unknown) => value)

    expect(error).toBeInstanceOf(StackClientError)
    expect(error).toMatchObject({ code: "apply_failed", status: 500, detail })
  })

  it("preserves generated stale-plan errors", async () => {
    const client = new StackHttpClient(
      connection({
        apply: () => ({
          data: undefined,
          error: { code: "stale_plan", message: "The project changed after preview" },
          response: new Response(undefined, { status: 409 }),
        }),
      }),
    )

    const error = await client.apply("/project", draft, "old").catch((value: unknown) => value)

    expect(error).toBeInstanceOf(StackClientError)
    expect(error).toMatchObject({ code: "stale_plan", status: 409, message: "The project changed after preview" })
  })
})
