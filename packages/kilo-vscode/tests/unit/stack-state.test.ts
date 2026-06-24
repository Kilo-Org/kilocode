import { describe, expect, it } from "bun:test"
import {
  catalogGapCount,
  catalogReady,
  cloneDraft,
  emptyDraft,
  flattenCategories,
  normalizeDraft,
  resourceEnabled,
  resourceMethod,
  resourceMethods,
  resourcesForTechnology,
  sanitizeDraft,
  setResourceEnabled,
  setResourceMethod,
  setResourceParameter,
  setTechnology,
  validateDraft,
} from "../../src/stack/model"
import type { StackCatalog, StackDraft, StackMcpItem } from "../../src/stack/types"

const skill = {
  ref: "skill:dbt",
  id: "dbt",
  kind: "skill" as const,
  name: "dbt",
  trust: "official" as const,
  maturity: "stable" as const,
  source: "source",
  warnings: [],
}
const shared = {
  ref: "skill:shared",
  id: "shared",
  kind: "skill" as const,
  name: "Shared helper",
  trust: "community" as const,
  maturity: "stable" as const,
  source: "source",
  warnings: [],
}
const mcp = {
  ref: "mcp:dbt",
  id: "dbt",
  kind: "mcp" as const,
  name: "dbt MCP",
  trust: "official" as const,
  maturity: "stable" as const,
  source: "source",
  warnings: [],
}
const mcpItem: StackMcpItem = {
  id: "dbt",
  version: "1.0.0",
  source_revision: "a".repeat(40),
  name: "dbt MCP",
  description: "dbt MCP fixture",
  publisher: { id: "dbt", name: "dbt", trust: "verified" },
  maturity: "stable",
  support: "publisher",
  source_url: "https://example.com/dbt-mcp",
  installability: { installable: true },
  tags: [],
  kind: "mcp",
  methods: [
    {
      id: "remote",
      name: "Remote",
      template: { type: "remote", url: "{param:url}", enabled: false },
      parameters: [
        {
          id: "url",
          name: "URL",
          type: "url",
          required: true,
          sensitive: false,
          default: "https://dbt.example.com",
        },
        {
          id: "region",
          name: "Region",
          type: "string",
          required: false,
          sensitive: false,
          allowed_values: ["us", "eu"],
        },
        {
          id: "token",
          name: "Token",
          type: "string",
          required: true,
          sensitive: true,
          environment: "DBT_TOKEN",
        },
      ],
      prerequisites: ["Allow network access."],
      platforms: ["darwin", "linux", "win32"],
      auth: { mode: "environment", environment: ["DBT_TOKEN"] },
      warnings: { writes: true, text: "Can modify jobs." },
    },
    {
      id: "local",
      name: "Local",
      template: { type: "local", command: ["dbt-mcp", "{param:project_dir}"], enabled: false },
      parameters: [
        {
          id: "project_dir",
          name: "Project directory",
          type: "path",
          required: true,
          sensitive: false,
        },
        {
          id: "region",
          name: "Region",
          type: "string",
          required: false,
          sensitive: false,
          allowed_values: ["us", "eu"],
        },
      ],
      prerequisites: ["Install dbt-mcp."],
      platforms: ["darwin", "linux"],
      auth: { mode: "none" },
      warnings: { writes: false },
    },
  ],
}
const association = {
  ref: skill.ref,
  default: true,
  trust: skill.trust,
  maturity: skill.maturity,
  source: skill.source,
  rationale: "Recommended",
  warnings: [],
}
const optional = { ...association, ref: shared.ref, default: false, trust: shared.trust }
const promoted = { ...optional, default: true }
const mcpAssociation = {
  ref: mcp.ref,
  default: false,
  trust: mcp.trust,
  maturity: mcp.maturity,
  source: mcp.source,
  rationale: "Optional",
  warnings: [],
}

const catalog: StackCatalog = {
  catalog: {
    revision: "one",
    verticals: [
      {
        id: "data",
        name: "Data",
        technologies: [
          { id: "dbt", name: "dbt", resources: [association, optional, mcpAssociation] },
          { id: "warehouse", name: "Warehouse", resources: [promoted] },
        ],
        categories: [
          {
            id: "consumption",
            name: "Consumption",
            technologies: [{ technology: "dbt" }],
            categories: [
              {
                id: "sharing",
                name: "Sharing",
                technologies: [{ technology: "dbt" }, { technology: "warehouse" }],
                categories: [],
              },
            ],
          },
        ],
      },
    ],
    resources: [skill, shared, mcp],
  },
  resources: [
    { resource: skill, availability: "available" },
    { resource: shared, availability: "available" },
    { resource: mcp, availability: "available", item: mcpItem },
  ],
  expected_resources: [skill.ref, shared.ref, mcp.ref],
}

function selected(technologies = ["dbt"]): StackDraft {
  return { verticals: { data: { technologies } }, resources: {} }
}

describe("Stack draft model", () => {
  it("walks actual recursive categories and synchronizes duplicate placements", () => {
    const draft = setTechnology(catalog, emptyDraft(), "data", "dbt", true)
    expect(draft.verticals.data.technologies).toEqual(["dbt"])
    const groups = flattenCategories(catalog.catalog.verticals[0].categories)
    expect(groups.map((entry) => entry.category.id)).toEqual(["consumption"])
    expect(groups[0].groups.map((group) => group.name)).toEqual(["", "Sharing"])
    expect(groups[0].groups[0].technologies.map((item) => item.technology)).toEqual(["dbt"])
    expect(groups[0].groups[1].technologies.map((item) => item.technology)).toEqual(["dbt", "warehouse"])
    expect(setTechnology(catalog, draft, "data", "dbt", false).verticals.data.technologies).toEqual([])
  })

  it("uses association defaults across every selected technology and respects explicit overrides", () => {
    expect(resourceEnabled(catalog, selected(), skill.ref)).toBe(true)
    expect(resourceEnabled(catalog, selected(), shared.ref)).toBe(false)
    expect(resourceEnabled(catalog, selected(["dbt", "warehouse"]), shared.ref)).toBe(true)
    const choice = resourcesForTechnology(catalog, "dbt").find((item) => item.resource.ref === shared.ref)!
    const disabled = setResourceEnabled(selected(["dbt", "warehouse"]), choice, false)
    expect(resourceEnabled(catalog, disabled, shared.ref)).toBe(false)
  })

  it("keeps shared and unrelated overrides while another selected technology references them", () => {
    const draft: StackDraft = {
      verticals: { data: { technologies: ["dbt", "warehouse"] } },
      resources: {
        [skill.ref]: { enabled: false },
        [shared.ref]: { enabled: false },
      },
    }

    expect(setTechnology(catalog, draft, "data", "warehouse", false).resources).toEqual(draft.resources)
    expect(setTechnology(catalog, draft, "data", "dbt", false).resources).toEqual({
      [shared.ref]: { enabled: false },
    })
  })

  it("preserves unknown manual overrides when pruning a deselected technology", () => {
    const draft: StackDraft = {
      verticals: { data: { technologies: ["dbt"] } },
      resources: {
        [mcp.ref]: { enabled: true, method: "remote" },
        "skill:manual": { enabled: true, method: "manual", parameters: { custom: "keep" } },
      },
    }

    expect(setTechnology(catalog, draft, "data", "dbt", false).resources).toEqual({
      "skill:manual": { enabled: true, method: "manual", parameters: { custom: "keep" } },
    })
  })

  it("cleans known resource overrides when technology selection reaches zero", () => {
    const draft: StackDraft = {
      verticals: { data: { technologies: ["dbt"] } },
      resources: {
        [skill.ref]: { enabled: false },
        [shared.ref]: { enabled: true },
        [mcp.ref]: { enabled: true, method: "remote" },
      },
    }
    const cleared = setTechnology(catalog, draft, "data", "dbt", false)

    expect(cleared.verticals.data.technologies).toEqual([])
    expect(cleared.resources).toEqual({})
  })

  it("preserves manual drift exactly until the affected field is explicitly edited", () => {
    const manual: StackDraft = {
      verticals: { data: { technologies: ["dbt"] }, custom: { technologies: ["manual-tech"] } },
      resources: {
        "skill:manual": { enabled: true, method: "manual", parameters: { custom: "keep" } },
        [mcp.ref]: {
          enabled: true,
          method: "removed-method",
          parameters: { url: "https://manual.example.com", custom: "keep-until-edited" },
        },
      },
    }

    expect(cloneDraft(manual)).toEqual(manual)
    expect(setTechnology(catalog, manual, "data", "warehouse", true).resources).toEqual(manual.resources)

    const choice = resourcesForTechnology(catalog, "dbt").find((item) => item.resource.ref === mcp.ref)!
    const remote = resourceMethods(choice).find((method) => method.id === "remote")!
    const edited = setResourceMethod(manual, choice, remote)
    expect(edited.resources["skill:manual"]).toEqual(manual.resources["skill:manual"])
    expect(edited.resources[mcp.ref]).toEqual({
      enabled: true,
      method: "remote",
      parameters: { url: "https://manual.example.com" },
    })
  })

  it("joins associations to Marketplace summaries without changing default metadata", () => {
    const choices = resourcesForTechnology(catalog, "dbt")
    expect(choices.map((choice) => choice.resource.ref)).toEqual([skill.ref, shared.ref, mcp.ref])
    const choice = choices.find((item) => item.resource.ref === mcp.ref)!
    expect(choice.association).toBe(mcpAssociation)
    expect(resourceMethods(choice).map((method) => method.id)).toEqual(["remote", "local"])
    expect(resourceEnabled(catalog, selected(), mcp.ref)).toBe(false)
    const unavailable: StackCatalog = {
      ...catalog,
      resources: catalog.resources.map((summary) =>
        summary.resource.ref === mcp.ref ? { ...summary, availability: "blocked" as const } : summary,
      ),
    }
    const blocked = resourcesForTechnology(unavailable, "dbt").find((item) => item.resource.ref === mcp.ref)!
    expect(setResourceEnabled(selected(), blocked, true)).toEqual(selected())

    const persisted: StackDraft = {
      ...selected(),
      resources: {
        [mcp.ref]: {
          enabled: true,
          method: "remote",
          parameters: { url: "https://dbt.example.com", region: "eu" },
        },
      },
    }
    expect(validateDraft(unavailable, persisted)).toEqual([])
    expect(setResourceEnabled(persisted, blocked, false).resources[mcp.ref]).toEqual({ enabled: false })
  })

  it("requires an explicit Marketplace method and its required non-secret parameters", () => {
    const choice = resourcesForTechnology(catalog, "dbt").find((item) => item.resource.ref === mcp.ref)!
    const enabled = setResourceEnabled(selected(), choice, true)
    expect(enabled.resources[mcp.ref]).toEqual({ enabled: true })
    expect(validateDraft(catalog, enabled)).toEqual([
      { code: "method_required", resource: mcp.ref, resourceName: "dbt MCP" },
    ])
    const local = resourceMethods(choice).find((method) => method.id === "local")!
    const configured = setResourceMethod(enabled, choice, local)
    expect(resourceMethod(configured, choice)).toBe(local)
    expect(validateDraft(catalog, configured)).toEqual([
      {
        code: "parameter_required",
        resource: mcp.ref,
        resourceName: "dbt MCP",
        parameter: "project_dir",
        parameterLabel: "Project directory",
      },
    ])
    const completed = setResourceParameter(configured, choice, local.parameters[0], ".")
    expect(validateDraft(catalog, completed)).toEqual([])
    expect(completed.resources[mcp.ref]).toEqual({
      enabled: true,
      method: "local",
      parameters: { project_dir: "." },
    })
  })

  it("normalizes method parameters, excludes secrets, and cleans stale values on method switches", () => {
    const choice = resourcesForTechnology(catalog, "dbt").find((item) => item.resource.ref === mcp.ref)!
    const remote = resourceMethods(choice).find((method) => method.id === "remote")!
    const local = resourceMethods(choice).find((method) => method.id === "local")!
    const configured = setResourceMethod(setResourceEnabled(selected(), choice, true), choice, remote)
    const region = setResourceParameter(configured, choice, remote.parameters[1], "eu")
    const secret = setResourceParameter(region, choice, remote.parameters[2], "must-not-persist")
    expect(secret).toBe(region)
    expect(region.resources[mcp.ref]?.parameters).toEqual({ url: "https://dbt.example.com", region: "eu" })
    const switched = setResourceMethod(region, choice, local)
    expect(switched.resources[mcp.ref]).toEqual({ enabled: true, method: "local", parameters: { region: "eu" } })
    expect(setResourceParameter(switched, choice, local.parameters[1], "invalid")).toEqual({
      ...switched,
      resources: { ...switched.resources, [mcp.ref]: { enabled: true, method: "local" } },
    })
  })

  it("normalizes generated records to the selected Marketplace method", () => {
    const draft = normalizeDraft({
      verticals: { data: { technologies: ["dbt", 42] }, invalid: "value" },
      resources: {
        [mcp.ref]: {
          enabled: true,
          method: "remote",
          parameters: {
            url: "https://custom.example.com",
            region: "eu",
            token: "secret",
            project_dir: ".",
            invalid: { nested: true },
          },
        },
        "skill:other": { enabled: true },
      },
    })
    expect(draft.verticals).toEqual({ data: { technologies: ["dbt"] } })
    expect(sanitizeDraft(catalog, draft).resources).toEqual({
      [mcp.ref]: {
        enabled: true,
        method: "remote",
        parameters: { url: "https://custom.example.com", region: "eu" },
      },
    })
    expect(
      sanitizeDraft(catalog, {
        ...draft,
        resources: { [mcp.ref]: { enabled: true, method: "removed", parameters: { url: "stale" } } },
      }).resources,
    ).toEqual({ [mcp.ref]: { enabled: true } })
  })

  it("reports incomplete Marketplace coverage without changing the catalog", () => {
    expect(catalogReady(catalog)).toBe(true)
    expect(catalogGapCount(catalog)).toBe(0)
    const unavailable: StackCatalog = {
      ...catalog,
      resources: catalog.resources.map((summary) =>
        summary.resource.ref === shared.ref ? { ...summary, availability: "missing" as const } : summary,
      ),
    }
    expect(catalogReady(unavailable)).toBe(false)
    expect(catalogGapCount(unavailable)).toBe(1)
  })
})
