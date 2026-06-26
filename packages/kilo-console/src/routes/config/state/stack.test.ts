import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  cloneStackDraft,
  createStackWizard,
  stackCatalogGapCount,
  stackCatalogReady,
  emptyStackDraft,
  groupStackPlan,
  pruneStackResources,
  setStackMethod,
  setStackParameter,
  setStackResource,
  stackCategoryGroups,
  stackResourceEnabled,
  stackResourceGroups,
  stackResourceMethods,
  stackResourceParameters,
  stackSelectedMethod,
  stackTechnologySelected,
  toggleStackTechnology,
  validateStackDraft,
} from "./stack"
import { StackRequestError, type Query } from "../../../client"
import { position } from "../stack/StackProgress"
import type {
  StackApplyError,
  StackApplyResponse,
  StackBundle,
  StackCatalogResponse,
  StackDraft,
  StackMarketplaceMcp,
  StackPlanAction,
  StackPreviewResponse,
  StackResource,
} from "../stack/types"

const skill: StackResource = {
  ref: "skill:dbt",
  id: "dbt",
  kind: "skill",
  name: "dbt Analytics",
  maturity: "stable",
  trust: "official",
  source: "https://example.com/dbt",
  warnings: [],
}

const community: StackResource = {
  ref: "skill:community",
  id: "community",
  kind: "skill",
  name: "Community helper",
  maturity: "stable",
  trust: "community",
  source: "https://example.com/community",
  warnings: [],
}

const mcp: StackResource = {
  ref: "mcp:dbt",
  id: "dbt",
  kind: "mcp",
  name: "dbt MCP",
  maturity: "stable",
  trust: "official",
  source: "https://example.com/dbt-mcp",
  warnings: [],
  parameters: [
    { id: "project_dir", label: "Legacy project directory", required: true, sensitive: false },
    { id: "token", label: "Legacy API token", required: true, sensitive: true, env: "LEGACY_DBT_TOKEN" },
  ],
}

const detail: StackMarketplaceMcp = {
  id: "dbt",
  version: "2.0.0",
  source_revision: "b".repeat(40),
  name: "dbt MCP",
  description: "Run dbt through MCP.",
  publisher: { id: "dbt", name: "dbt Labs", trust: "first-party" },
  maturity: "stable",
  support: "publisher",
  source_url: "https://example.com/dbt-mcp",
  installability: { installable: true },
  tags: ["data"],
  kind: "mcp",
  methods: [
    {
      id: "local-uvx",
      name: "Local uvx",
      template: {
        type: "local",
        command: ["uvx", "dbt-mcp", "--project-dir", "{param:project_dir}"],
        environment: { DBT_TOKEN: "{env:DBT_TOKEN}" },
        enabled: false,
      },
      parameters: [
        {
          id: "project_dir",
          name: "Project directory",
          description: "Path relative to the project.",
          type: "path",
          required: true,
          sensitive: false,
          allowed_values: [".", "analytics"],
        },
        {
          id: "token",
          name: "API token",
          type: "string",
          required: true,
          sensitive: true,
          environment: "DBT_TOKEN",
        },
      ],
      prerequisites: ["Install uvx."],
      platforms: ["darwin", "linux", "win32"],
      auth: { mode: "environment", environment: ["DBT_TOKEN"] },
      warnings: { writes: true, text: "Can update dbt resources." },
    },
    {
      id: "remote-http",
      name: "Remote HTTP",
      template: { type: "remote", url: "http://localhost:{param:port}", enabled: false },
      parameters: [
        {
          id: "port",
          name: "Port",
          type: "integer",
          required: true,
          sensitive: false,
          default: 3000,
        },
      ],
      prerequisites: [],
      platforms: ["linux"],
      auth: { mode: "oauth" },
      warnings: { writes: false },
    },
  ],
}

const catalog: StackCatalogResponse = {
  catalog: {
    revision: "2026-06-22.1",
    verticals: [
      {
        id: "data",
        name: "Data Engineering",
        technologies: [
          {
            id: "dbt",
            name: "dbt",
            resources: [
              {
                ref: skill.ref,
                default: true,
                trust: skill.trust,
                maturity: skill.maturity,
                source: skill.source,
                rationale: "Official default",
                warnings: [],
              },
              {
                ref: community.ref,
                default: false,
                trust: community.trust,
                maturity: community.maturity,
                source: community.source,
                rationale: "Optional community resource",
                warnings: [],
              },
              {
                ref: mcp.ref,
                default: false,
                trust: mcp.trust,
                maturity: mcp.maturity,
                source: mcp.source,
                rationale: "Optional MCP",
                warnings: [],
                parameters: mcp.parameters,
              },
            ],
          },
          { id: "snowflake", name: "Snowflake", resources: [] },
        ],
        categories: [
          {
            id: "transform",
            name: "Transform",
            technologies: [{ technology: "dbt" }],
            categories: [
              {
                id: "warehouse",
                name: "Warehouse",
                technologies: [{ technology: "dbt" }, { technology: "snowflake" }],
                categories: [],
              },
            ],
          },
        ],
      },
    ],
    resources: [skill, community, mcp],
  },
  resources: [skill, community, mcp].map((resource) => ({
    resource,
    availability: "available" as const,
    ...(resource.ref === mcp.ref ? { item: detail } : {}),
  })),
  expected_resources: [skill.ref, community.ref, mcp.ref],
}

const first: Query = { url: "http://127.0.0.1:4097", dir: "/tmp/first", scope: "project" }
const second: Query = { url: "http://127.0.0.1:4097", dir: "/tmp/second", scope: "project" }

function draft(ids: string[] = ["dbt"]): StackDraft {
  return { verticals: { data: { technologies: ids } }, resources: {} }
}

function bundle(input = draft(), source = catalog): StackBundle {
  return {
    catalog: source,
    state: {
      draft: input,
      resources: [],
      conflicts: [],
      config_revision: "sha256:config-1",
      catalog_revision: "2026-06-22.1",
    },
  }
}

function preview(input: StackDraft, hash = "sha256:plan-1"): StackPreviewResponse {
  return {
    draft: cloneStackDraft(input),
    plan_hash: hash,
    config_revision: "sha256:config-1",
    catalog_revision: "2026-06-22.1",
    actions: [],
    conflicts: [],
    warnings: [],
    prerequisites: [],
  }
}

function applied(input: StackDraft): StackApplyResponse {
  return {
    results: [{ resource: "skill:dbt", action: "install", success: true, message: "Installed" }],
    state: {
      draft: cloneStackDraft(input),
      resources: [],
      conflicts: [],
      config_revision: "sha256:config-2",
      catalog_revision: "2026-06-22.1",
    },
  }
}

function deferred<T>() {
  const state = {} as { resolve: (value: T) => void }
  const promise = new Promise<T>((resolve) => (state.resolve = resolve))
  return { promise, resolve: state.resolve }
}

type WizardOps = Parameters<typeof createStackWizard>[0]

function wizard(
  ops: Omit<WizardOps, "reload" | "detect"> & Partial<Pick<WizardOps, "reload" | "detect">>,
) {
  let dispose = () => {}
  const state = createRoot((cleanup) => {
    dispose = cleanup
    return createStackWizard({
      reload: async () => bundle().state,
      detect: async () => ({ detections: [] }),
      ...ops,
    })
  })
  return { state, dispose }
}

function load(state: ReturnType<typeof createStackWizard>, data = bundle(), target = first) {
  state.selectProject(target)
  expect(state.hydrate(data, target)).toBe(true)
}

describe("Stack wizard state", () => {
  test("advances progress across technology categories", () => {
    expect(position("vertical", 0, 4)).toBe(0)
    expect(position("category", 0, 4)).toBe(1)
    expect(position("category", 1, 4)).toBe(1.25)
    expect(position("category", 3, 4)).toBe(1.75)
    expect(position("category", 4, 4)).toBe(1.75)
    expect(position("resources", 3, 4)).toBe(2)
    expect(position("review", 3, 4)).toBe(3)
    expect(position("result", 3, 4)).toBe(4)
  })

  test("groups recursive category fields under parent categories and synchronizes duplicate technology placements", () => {
    const groups = stackCategoryGroups(catalog.catalog.verticals[0].categories)
    expect(groups.map((item) => item.category.id)).toEqual(["transform"])
    expect(groups[0].groups.map((group) => group.name)).toEqual(["", "Warehouse"])
    expect(groups[0].groups[0].technologies.map((item) => item.technology)).toEqual(["dbt"])
    expect(groups[0].groups[1].technologies.map((item) => item.technology)).toEqual(["dbt", "snowflake"])

    const selected = toggleStackTechnology(emptyStackDraft(), "data", "dbt")
    expect(stackTechnologySelected(selected, "data", "dbt")).toBe(true)
    expect(catalog.catalog.verticals[0].categories[0].technologies[0].technology).toBe("dbt")
    expect(catalog.catalog.verticals[0].categories[0].categories[0].technologies[0].technology).toBe("dbt")

    const cleared = toggleStackTechnology(selected, "data", "dbt")
    expect((cleared.verticals.data as { technologies: string[] }).technologies).toEqual([])
  })

  test("keeps a shared resource override until its last selected technology reference is removed", () => {
    const association = catalog.catalog.verticals[0].technologies[0].resources.find(
      (item) => item.ref === community.ref,
    )!
    const source: StackCatalogResponse = {
      ...catalog,
      catalog: {
        ...catalog.catalog,
        verticals: catalog.catalog.verticals.map((vertical) => ({
          ...vertical,
          technologies: vertical.technologies.map((technology) =>
            technology.id === "snowflake" ? { ...technology, resources: [association] } : technology,
          ),
        })),
      },
    }
    const input: StackDraft = {
      ...draft(["dbt", "snowflake"]),
      resources: { [community.ref]: { enabled: true } },
    }
    const deselected = toggleStackTechnology(input, "data", "dbt")
    const shared = pruneStackResources(source, input, deselected)

    expect(shared.resources).toEqual({ [community.ref]: { enabled: true } })

    const cleared = toggleStackTechnology(shared, "data", "snowflake")
    expect(pruneStackResources(source, shared, cleared).resources).toEqual({})
  })

  test("preserves unknown resource overrides for core conflict review", async () => {
    const manual = { enabled: true, method: "manual", parameters: { source: "user" } }
    const input: StackDraft = {
      ...draft(),
      resources: { [skill.ref]: { enabled: false }, "skill:manual": manual },
    }
    let reviewed: StackDraft | undefined
    const root = wizard({
      preview: async (_target, next) => {
        reviewed = cloneStackDraft(next)
        const response = preview(next)
        response.conflicts.push({
          code: "invalid_draft",
          message: "Resource override skill:manual is not associated with a selected technology.",
          resource: "skill:manual",
        })
        return response
      },
      apply: async (_target, next) => applied(next),
    })
    load(root.state, bundle(input))

    root.state.toggle("dbt")
    await root.state.review()

    expect(root.state.draft().resources).toEqual({ "skill:manual": manual })
    expect(reviewed?.resources).toEqual({ "skill:manual": manual })
    expect(root.state.plan()?.conflicts.map((item) => item.resource)).toEqual(["skill:manual"])
    root.dispose()
  })

  test("removes known resource overrides when the final technology is deselected", () => {
    const input: StackDraft = {
      ...draft(),
      resources: {
        [skill.ref]: { enabled: false },
        [community.ref]: { enabled: true },
        [mcp.ref]: { enabled: true, method: "local-uvx", parameters: { project_dir: "." } },
      },
    }
    const cleared = toggleStackTechnology(input, "data", "dbt")

    expect(pruneStackResources(catalog, input, cleared).resources).toEqual({})
  })

  test("preserves known manual overrides that were unrelated before deselection", () => {
    const source: StackCatalogResponse = {
      ...catalog,
      catalog: {
        ...catalog.catalog,
        verticals: catalog.catalog.verticals.map((vertical) => ({
          ...vertical,
          technologies: vertical.technologies.map((technology) =>
            technology.id === "dbt"
              ? { ...technology, resources: technology.resources.filter((item) => item.ref !== community.ref) }
              : technology,
          ),
        })),
      },
    }
    const input: StackDraft = {
      ...draft(),
      resources: { [skill.ref]: { enabled: false }, [community.ref]: { enabled: true } },
    }
    const cleared = toggleStackTechnology(input, "data", "dbt")

    expect(pruneStackResources(source, input, cleared).resources).toEqual({
      [community.ref]: { enabled: true },
    })
  })

  test("uses Marketplace methods and normalized method parameters", () => {
    const input = draft()
    const groups = stackResourceGroups(catalog, input)
    const dbt = groups[0]
    const skillItem = dbt.skills.find((item) => item.resource.ref === skill.ref)!
    const communityItem = dbt.skills.find((item) => item.resource.ref === community.ref)!
    const mcpItem = dbt.mcps[0]

    expect(stackResourceEnabled(input, skillItem)).toBe(true)
    expect(stackResourceEnabled(input, communityItem)).toBe(false)
    expect(stackResourceEnabled(input, mcpItem)).toBe(false)
    expect(mcpItem.parameters).toEqual([])
    expect(stackResourceMethods(mcpItem).map((item) => item.id)).toEqual(["local-uvx", "remote-http"])

    const disabled = setStackResource(input, skillItem, false)
    expect(stackResourceEnabled(disabled, skillItem)).toBe(false)
    const missing = { ...skillItem, availability: "missing" as const }
    expect(setStackResource(input, missing, false).resources[skill.ref]).toEqual({ enabled: false })
    expect(setStackResource(input, missing, true)).toBe(input)

    const enabled = setStackResource(input, mcpItem, true)
    expect(enabled.resources[mcp.ref]).toEqual({ enabled: true })
    expect(validateStackDraft(catalog, enabled)[0].message).toContain("installation method")
    const unavailable: StackCatalogResponse = {
      ...catalog,
      resources: catalog.resources.map((item) =>
        item.resource.ref === mcp.ref ? { ...item, availability: "missing" as const } : item,
      ),
    }
    expect(validateStackDraft(unavailable, enabled)).toEqual([])

    const selected = setStackMethod(enabled, mcpItem, "local-uvx")
    const parameters = stackResourceParameters(selected, mcpItem)
    expect(parameters).toEqual([
      {
        id: "project_dir",
        label: "Project directory",
        description: "Path relative to the project.",
        type: "path",
        required: true,
        sensitive: false,
        values: [".", "analytics"],
      },
      {
        id: "token",
        label: "API token",
        type: "string",
        required: true,
        sensitive: true,
        env: "DBT_TOKEN",
      },
    ])
    expect(stackSelectedMethod(selected, mcpItem)).toMatchObject({
      prerequisites: ["Install uvx."],
      platforms: ["darwin", "linux", "win32"],
      auth: { mode: "environment", environment: ["DBT_TOKEN"] },
      warnings: { writes: true, text: "Can update dbt resources." },
    })
    expect(validateStackDraft(catalog, selected).map((item) => item.parameter)).toEqual(["project_dir"])
    expect(setStackParameter(selected, mcpItem, parameters[0], "outside")).toBe(selected)
    const invalid: StackDraft = {
      ...selected,
      resources: {
        [mcp.ref]: { enabled: true, method: "local-uvx", parameters: { project_dir: "outside" } },
      },
    }
    expect(validateStackDraft(catalog, invalid)[0].message).toBe("Project directory must be one of: ., analytics.")

    const secret = parameters[1]
    expect(setStackParameter(selected, mcpItem, secret, "must-not-persist")).toBe(selected)
    const completed = setStackParameter(selected, mcpItem, parameters[0], ".")
    expect(completed.resources[mcp.ref]).toEqual({
      enabled: true,
      method: "local-uvx",
      parameters: { project_dir: "." },
    })
    expect(validateStackDraft(catalog, completed)).toEqual([])

    const deselected = toggleStackTechnology(completed, "data", "dbt")
    expect(pruneStackResources(catalog, completed, deselected).resources).toEqual({})
  })

  test("preserves resource and parameter identities while editing resource settings", () => {
    const root = wizard({
      preview: async (_target, input) => preview(input),
      apply: async (_target, input) => applied(input),
    })
    load(root.state)
    const groups = root.state.resources()
    const group = groups[0]
    const item = group.mcps[0]

    root.state.enable(item, true)
    expect(root.state.resources()).toBe(groups)
    expect(root.state.resources()[0]).toBe(group)
    expect(root.state.resources()[0].mcps[0]).toBe(item)

    root.state.method(item, "local-uvx")
    const parameters = stackResourceParameters(root.state.draft(), item)
    expect(root.state.resources()).toBe(groups)

    root.state.parameter(item, parameters[0], ".")
    expect(root.state.resources()).toBe(groups)
    expect(stackResourceParameters(root.state.draft(), item)).toBe(parameters)
    expect(stackResourceParameters(root.state.draft(), item)[0]).toBe(parameters[0])

    root.state.toggle("snowflake")
    expect(root.state.resources()).not.toBe(groups)
    root.dispose()
  })

  test("clears old parameters when the Marketplace method changes", () => {
    const item = stackResourceGroups(catalog, draft())[0].mcps[0]
    const enabled = setStackResource(draft(), item, true)
    const selected = setStackMethod(enabled, item, "local-uvx")
    const configured = setStackParameter(selected, item, stackResourceParameters(selected, item)[0], ".")
    const changed = setStackMethod(configured, item, "remote-http")

    expect(changed.resources[mcp.ref]).toEqual({
      enabled: true,
      method: "remote-http",
      parameters: { port: 3000 },
    })
    expect(stackResourceParameters(changed, item).map((parameter) => parameter.label)).toEqual(["Port"])
    expect(setStackMethod(changed, item, "").resources[mcp.ref]).toEqual({ enabled: true })
  })

  test("uses association parameters only when Marketplace detail is absent", () => {
    const fallback: StackCatalogResponse = {
      ...catalog,
      resources: catalog.resources.map((item) =>
        item.resource.ref === mcp.ref ? { resource: item.resource, availability: item.availability } : item,
      ),
    }
    const item = stackResourceGroups(fallback, draft())[0].mcps[0]
    const selected: StackDraft = {
      ...draft(),
      resources: { [mcp.ref]: { enabled: true, method: "saved", parameters: { project_dir: "." } } },
    }

    expect(stackResourceMethods(item)).toEqual([])
    expect(stackResourceParameters(selected, item).map((parameter) => [parameter.label, parameter.type])).toEqual([
      ["Legacy project directory", "string"],
      ["Legacy API token", "string"],
    ])
    expect(validateStackDraft(fallback, selected)).toEqual([])
  })

  test("groups Action objects and treats plan conflicts as separate blockers", () => {
    const action = (value: StackPlanAction["action"]): StackPlanAction => ({
      action: value,
      resource: `skill:${value}`,
      reason: value,
      technologies: [],
      warnings: [],
      prerequisites: [],
    })
    const groups = groupStackPlan([
      action("install"),
      action("remove"),
      action("keep"),
      action("already_available_unmanaged"),
      action("relinquish_modified"),
      action("blocked"),
      action("missing"),
    ])

    expect(groups.install.map((item) => item.action)).toEqual(["install"])
    expect(groups.remove.map((item) => item.action)).toEqual(["remove"])
    expect(groups.preserve.map((item) => item.action)).toEqual([
      "keep",
      "already_available_unmanaged",
      "relinquish_modified",
    ])
    expect(groups.blocked.map((item) => item.action)).toEqual(["blocked", "missing"])
  })

  test("allows available-only plans while Marketplace coverage is incomplete", async () => {
    const incomplete: StackCatalogResponse = {
      ...catalog,
      resources: catalog.resources.map((item) =>
        item.resource.ref === community.ref ? { ...item, availability: "missing" as const } : item,
      ),
    }
    let previews = 0
    let applies = 0
    const root = wizard({
      preview: async (_target, input) => {
        previews += 1
        return preview(input)
      },
      apply: async (_target, input) => {
        applies += 1
        return applied(input)
      },
    })
    load(root.state, bundle(draft(), incomplete))

    expect(stackCatalogReady(incomplete)).toBe(false)
    expect(stackCatalogGapCount(incomplete)).toBe(1)
    expect(stackCatalogReady({ ...catalog, expected_resources: [] })).toBe(false)
    expect(root.state.ready()).toBe(false)
    expect(root.state.gaps()).toBe(1)
    root.state.start()
    expect(root.state.phase()).toBe("category")
    root.state.nextCategory()
    root.state.nextCategory()
    expect(root.state.phase()).toBe("resources")
    await root.state.review()
    expect(root.state.phase()).toBe("review")
    expect(previews).toBe(1)
    await root.state.confirm()
    expect(root.state.phase()).toBe("result")
    expect(applies).toBe(1)
    root.dispose()

    const blocked = wizard({
      preview: async (_target, input) => ({
        ...preview(input),
        actions: [
          {
            action: "missing",
            resource: community.ref,
            reason: "Resource is absent from Marketplace.",
            technologies: ["dbt"],
            warnings: [],
            prerequisites: [],
          },
        ],
      }),
      apply: async (_target, input) => {
        applies += 1
        return applied(input)
      },
    })
    load(blocked.state, bundle(draft(), incomplete))
    await blocked.state.review()
    await blocked.state.confirm()

    expect(blocked.state.phase()).toBe("review")
    expect(applies).toBe(1)
    blocked.dispose()
  })

  test("cancel restores hydrated state without previewing or applying", () => {
    let previews = 0
    let applies = 0
    const root = wizard({
      preview: async (_target, input) => {
        previews += 1
        return preview(input)
      },
      apply: async (_target, input) => {
        applies += 1
        return applied(input)
      },
    })
    load(root.state)
    root.state.toggle("snowflake")
    root.state.cancel()

    expect(root.state.draft()).toEqual(draft())
    expect(previews).toBe(0)
    expect(applies).toBe(0)
    root.dispose()
  })

  test("blocks preview until an explicit method and required parameters are selected", async () => {
    let previews = 0
    const root = wizard({
      preview: async (_target, input) => {
        previews += 1
        return preview(input)
      },
      apply: async (_target, input) => applied(input),
    })
    load(root.state)
    const item = stackResourceGroups(catalog, root.state.draft())[0].mcps[0]
    root.state.enable(item, true)

    await root.state.review()
    expect(previews).toBe(0)
    expect(root.state.issues().map((issue) => issue.message)).toEqual(["dbt MCP requires an installation method."])

    root.state.method(item, "local-uvx")
    await root.state.review()
    expect(previews).toBe(0)
    expect(root.state.issues().map((issue) => issue.parameter)).toEqual(["project_dir"])

    root.state.parameter(item, stackResourceParameters(root.state.draft(), item)[0], ".")
    await root.state.review()
    expect(previews).toBe(1)
    expect(root.state.phase()).toBe("review")
    root.dispose()
  })

  test("confirms the exact preview draft and plan_hash", async () => {
    const calls: Array<{ target: Query; draft: StackDraft; hash: string }> = []
    const root = wizard({
      preview: async (_target, input) => preview(input, "sha256:exact"),
      apply: async (target, input, hash) => {
        calls.push({ target, draft: cloneStackDraft(input), hash })
        return applied(input)
      },
    })
    load(root.state)

    await root.state.review()
    await root.state.confirm()

    expect(calls).toEqual([{ target: first, draft: draft(), hash: "sha256:exact" }])
    expect(root.state.phase()).toBe("result")
    expect(root.state.result()?.results[0].success).toBe(true)
    expect(root.state.hash()).toBe("sha256:exact")
    root.dispose()
  })

  test("preserves apply rollback details and reloads project state after failure", async () => {
    const detail: StackApplyError = {
      code: "apply_failed",
      message: "Stack changes could not be applied.",
      rollback: false,
      results: [
        { resource: skill.ref, action: "install", success: true, message: "Installed before failure" },
        { resource: mcp.ref, action: "install", success: false, message: "Config write failed" },
      ],
    }
    const refreshed = bundle(draft(["snowflake"])).state
    const reloads: Query[] = []
    const root = wizard({
      preview: async (_target, input) => preview(input),
      apply: async () => {
        throw new StackRequestError(detail.message, 500, detail.code, detail)
      },
      reload: async (target) => {
        reloads.push(target)
        return refreshed
      },
    })
    load(root.state)

    await root.state.review()
    await root.state.confirm()

    expect(root.state.failure()).toEqual(detail)
    expect(root.state.refresh()).toBe("complete")
    expect(reloads).toEqual([first])
    expect(root.state.saved()).toBe(refreshed)
    expect(root.state.draft()).toEqual(refreshed.draft)
    expect(root.state.plan()).toBeUndefined()
    expect(root.state.phase()).toBe("resources")
    expect(root.state.error()).toBe(detail.message)
    root.dispose()
  })

  test("discards and aborts preview responses after an edit", async () => {
    const pending = deferred<StackPreviewResponse>()
    let signal: AbortSignal | undefined
    const root = wizard({
      preview: async (_target, _input, next) => {
        signal = next
        return pending.promise
      },
      apply: async (_target, input) => applied(input),
    })
    load(root.state)

    const reviewing = root.state.review()
    root.state.toggle("snowflake")
    pending.resolve(preview(draft(), "sha256:old"))
    await reviewing

    expect(signal?.aborted).toBe(true)
    expect(stackTechnologySelected(root.state.draft(), "data", "snowflake")).toBe(true)
    expect(root.state.plan()).toBeUndefined()
    root.dispose()
  })

  test("clears stale state and ignores old project responses when the route project changes", async () => {
    const pending = deferred<StackPreviewResponse>()
    const targets: Query[] = []
    const root = wizard({
      preview: async (target) => {
        targets.push(target)
        return pending.promise
      },
      apply: async (_target, input) => applied(input),
    })
    load(root.state)

    const reviewing = root.state.review()
    root.state.selectProject(second)
    expect(root.state.catalog()).toBeUndefined()
    expect(root.state.plan()).toBeUndefined()
    expect(root.state.hydrate(bundle(draft(["snowflake"])), second)).toBe(true)
    pending.resolve(preview(draft(), "sha256:first-project"))
    await reviewing

    expect(targets).toEqual([first])
    expect(root.state.project()).toContain("/tmp/second")
    expect(stackTechnologySelected(root.state.draft(), "data", "snowflake")).toBe(true)
    expect(root.state.plan()).toBeUndefined()
    expect(root.state.phase()).toBe("intro")
    root.dispose()
  })

  test("keeps a stale conflict blocking when its refresh fails", async () => {
    let previews = 0
    const root = wizard({
      preview: async (_target, input) => {
        previews += 1
        if (previews === 1) return preview(input, "sha256:stale")
        throw new Error("Marketplace refresh failed")
      },
      apply: async () => {
        const error = new Error("The plan changed") as Error & { status: number; code: string }
        error.status = 409
        error.code = "stale_plan"
        throw error
      },
    })
    load(root.state)

    await root.state.review()
    await root.state.confirm()
    await root.state.review()

    expect(root.state.conflict()).toBe(true)
    expect(root.state.plan()?.plan_hash).toBe("sha256:stale")
    expect(root.state.error()).toBe("Marketplace refresh failed")
    expect(previews).toBe(2)
    root.dispose()
  })

  test("keeps stale plans read-only until a refreshed preview is reviewed", async () => {
    let previews = 0
    const root = wizard({
      preview: async (_target, input) => {
        previews += 1
        return preview(input, `sha256:plan-${previews}`)
      },
      apply: async () => {
        const error = new Error("The plan changed") as Error & { status: number; code: string }
        error.status = 409
        error.code = "stale_plan"
        throw error
      },
    })
    load(root.state)

    await root.state.review()
    await root.state.confirm()
    expect(root.state.conflict()).toBe(true)
    expect(root.state.plan()?.plan_hash).toBe("sha256:plan-1")

    await root.state.review()
    expect(root.state.conflict()).toBe(false)
    expect(root.state.plan()?.plan_hash).toBe("sha256:plan-2")
    expect(previews).toBe(2)
    root.dispose()
  })
})

describe("Stack wizard auto-detect", () => {
  test("starts at the intro phase for an unconfigured project", () => {
    const root = wizard({ preview: async () => preview(draft()), apply: async () => applied(draft()) })
    load(root.state, bundle(emptyStackDraft()))
    expect(root.state.phase()).toBe("intro")
  })

  test("starts at the vertical phase for a configured project", () => {
    const root = wizard({ preview: async () => preview(draft()), apply: async () => applied(draft()) })
    const configured: StackBundle = {
      ...bundle(),
      state: {
        ...bundle().state,
        config: {
          version: 1,
          catalog_revision: "2026-06-22.1",
          verticals: { data: { technologies: ["dbt"] } },
          resources: {},
          managed: {},
        },
      },
    }
    load(root.state, configured)
    expect(root.state.phase()).toBe("vertical")
  })

  test("manual choice keeps the empty draft and opens the vertical step", () => {
    const root = wizard({ preview: async () => preview(draft()), apply: async () => applied(draft()) })
    load(root.state, bundle(emptyStackDraft()))
    root.state.goManual()
    expect(root.state.phase()).toBe("vertical")
    expect(root.state.draft().verticals.data?.technologies ?? []).toEqual([])
  })

  test("detect folds detections into the draft and moves to detected", async () => {
    const root = wizard({
      preview: async () => preview(draft()),
      apply: async () => applied(draft()),
      detect: async () => ({
        detections: [
          { technology: "dbt", vertical: "data", evidence: "Found dbt_project.yml." },
          { technology: "snowflake", vertical: "data", evidence: "Found npm dependency `snowflake-sdk`." },
        ],
      }),
    })
    load(root.state, bundle(emptyStackDraft()))
    await root.state.detect()
    expect(root.state.phase()).toBe("detected")
    expect(root.state.detections()).toHaveLength(2)
    expect(stackTechnologySelected(root.state.draft(), "data", "dbt")).toBe(true)
    expect(stackTechnologySelected(root.state.draft(), "data", "snowflake")).toBe(true)
  })

  test("deselecting a false positive on the detected step keeps the others and continues", async () => {
    const root = wizard({
      preview: async () => preview(draft()),
      apply: async () => applied(draft()),
      detect: async () => ({
        detections: [
          { technology: "dbt", vertical: "data", evidence: "Found dbt_project.yml." },
          { technology: "snowflake", vertical: "data", evidence: "Found npm dependency `snowflake-sdk`." },
        ],
      }),
    })
    load(root.state, bundle(emptyStackDraft()))
    await root.state.detect()
    root.state.toggleDetection("data", "snowflake")
    expect(stackTechnologySelected(root.state.draft(), "data", "snowflake")).toBe(false)
    expect(stackTechnologySelected(root.state.draft(), "data", "dbt")).toBe(true)
    root.state.applyDetection()
    expect(root.state.phase()).toBe("resources")
  })
})
