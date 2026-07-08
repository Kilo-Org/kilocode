import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { type Item, Manifest } from "@/kilocode/marketplace/schema"
import { Planner } from "@/kilocode/stack/planner"
import { Stack } from "@/kilocode/stack/schema"

const sha = (digit: string) => Stack.Digest.make(`sha256:${digit.repeat(64)}`)
const source = "https://example.com/source"
const refs = {
  shared: Stack.ResourceRef.make("skill:shared-skill"),
  beta: Stack.ResourceRef.make("skill:beta-skill"),
  blocked: Stack.ResourceRef.make("skill:blocked-skill"),
  missing: Stack.ResourceRef.make("skill:missing-skill"),
  mcp: Stack.ResourceRef.make("mcp:example-mcp"),
}

function resource(ref: Stack.ResourceRef, kind: Stack.ResourceKind): Stack.Resource {
  return Schema.decodeUnknownSync(Stack.Resource)({
    ref,
    id: ref.slice(ref.indexOf(":") + 1),
    kind,
    name: ref,
    trust: "official",
    maturity: "stable",
    source,
    warnings: [],
  })
}

const resources = [
  resource(refs.shared, "skill"),
  resource(refs.beta, "skill"),
  resource(refs.blocked, "skill"),
  resource(refs.missing, "skill"),
  resource(refs.mcp, "mcp"),
]

function association(ref: Stack.ResourceRef, enabled: boolean, curated = true) {
  const item = resources.find((candidate) => candidate.ref === ref)
  if (!item) throw new Error(`Missing resource fixture ${ref}`)
  return {
    ref,
    default: enabled,
    curated,
    trust: item.trust,
    maturity: item.maturity,
    source: item.source,
    rationale: `Use ${ref}`,
    warnings: item.warnings,
  }
}

const catalog = Schema.decodeUnknownSync(Stack.Catalog)({
  revision: "2026-06-22.1",
  verticals: [
    {
      id: "example",
      name: "Example",
      technologies: [
        {
          id: "alpha",
          name: "Alpha",
          resources: [
            association(refs.shared, true),
            association(refs.mcp, false),
            association(refs.blocked, false),
            association(refs.missing, false),
          ],
        },
        {
          id: "beta",
          name: "Beta",
          resources: [association(refs.shared, true), association(refs.beta, true)],
        },
      ],
      categories: [],
    },
  ],
  resources,
})

function skill(id: string, digit: string, installable = true) {
  return {
    id,
    kind: "skill",
    version: "1.0.0",
    source_revision: "a".repeat(40),
    name: id,
    description: `${id} description`,
    publisher: { id: "example", name: "Example", trust: "verified" },
    maturity: installable ? "stable" : "unsupported",
    support: installable ? "publisher" : "unsupported",
    source_url: source,
    installability: installable ? { installable: true } : { installable: false, reason: "Not packaged yet." },
    tags: [],
    ...(installable
      ? {
          artifact: {
            url: `https://example.com/${id}.tar.gz`,
            digest: `sha256:${digit.repeat(64)}`,
            size: 100,
            format: "tar.gz",
          },
        }
      : {}),
  }
}

const marketplace = Schema.decodeUnknownSync(Manifest)({
  version: 1,
  revision: "2026-06-22.1",
  items: [
    skill("shared-skill", "1"),
    skill("beta-skill", "2"),
    skill("blocked-skill", "3", false),
    {
      id: "example-mcp",
      kind: "mcp",
      version: "1.0.0",
      source_revision: "b".repeat(40),
      name: "Example MCP",
      description: "Example MCP description",
      publisher: { id: "example", name: "Example", trust: "verified" },
      maturity: "stable",
      support: "publisher",
      source_url: source,
      installability: { installable: true },
      tags: [],
      methods: [
        {
          id: "local",
          name: "Local",
          template: {
            type: "local",
            command: ["example-mcp", "--root", "{param:root}"],
            environment: { API_TOKEN: "{env:API_TOKEN}" },
            enabled: false,
          },
          parameters: [
            {
              id: "root",
              name: "Root",
              type: "path",
              required: true,
              sensitive: false,
            },
            {
              id: "token",
              name: "Token",
              type: "string",
              required: true,
              sensitive: true,
              environment: "API_TOKEN",
            },
          ],
          prerequisites: ["Install example-mcp."],
          platforms: ["linux", "darwin", "win32"],
          auth: { mode: "environment", environment: ["API_TOKEN"] },
          warnings: { writes: true, text: "Can update Example data." },
        },
      ],
    },
  ],
})

function draft(input: unknown) {
  return Schema.decodeUnknownSync(Stack.Draft)(input)
}

const empty = draft({ verticals: { example: { technologies: [] } }, resources: {} })
const revision = sha("0")

function input(value: Stack.Draft, changes: Partial<Planner.Input> = {}): Planner.Input {
  return {
    catalog,
    marketplace,
    draft: value,
    inventory: { project: {}, inherited: [] },
    receipts: {},
    config_revision: revision,
    platform: "linux",
    ...changes,
  }
}

function receipt(id: string, digest: Stack.Digest, fingerprint: Stack.Digest) {
  return Schema.decodeUnknownSync(Stack.Receipt)({
    marketplace_id: id,
    version: "1.0.0",
    digest,
    fingerprint,
  })
}

function item(ref: Stack.ResourceRef): Item {
  const found = marketplace.items.find((candidate) => `${candidate.kind}:${candidate.id}` === ref)
  if (!found) throw new Error(`Missing Marketplace fixture ${ref}`)
  return found
}

function actions(plan: Stack.Plan) {
  return Object.fromEntries(plan.actions.map((entry) => [entry.resource, entry.action]))
}

describe("Stack planner resolution", () => {
  test("normalizes empty and unordered drafts deterministically", () => {
    expect(Planner.normalize(empty)).toEqual(empty)
    const value = draft({
      verticals: { example: { technologies: ["beta", "alpha", "beta"] } },
      resources: {
        [refs.mcp]: { enabled: true, method: "local", parameters: { root: "." } },
        [refs.shared]: { enabled: false, parameters: {} },
      },
    })
    const normalized = Planner.normalize(value)
    expect(normalized.verticals[Stack.VerticalID.make("example")].technologies).toEqual(["alpha", "beta"])
    expect(Object.keys(normalized.resources)).toEqual([refs.mcp, refs.shared])
    expect(normalized.resources[refs.shared]).toEqual({ enabled: false })
    expect(Planner.canonical({ z: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"z":1}')
  })

  test("unions multi-select defaults, applies overrides, and deduplicates shared refs", () => {
    const value = draft({
      verticals: { example: { technologies: ["beta", "alpha"] } },
      resources: {
        [refs.shared]: { enabled: false },
        [refs.mcp]: { enabled: true, method: "local", parameters: { root: "." } },
      },
    })
    const resolved = Planner.resolve(catalog, value)
    expect(resolved.technologies.map((id) => String(id))).toEqual(["alpha", "beta"])
    expect(resolved.conflicts).toEqual([])
    const shared = resolved.resources.find((entry) => entry.ref === refs.shared)
    expect(shared).toMatchObject({ default: true, enabled: false })
    expect(shared?.technologies.map((id) => String(id))).toEqual(["alpha", "beta"])
    expect(resolved.resources.filter((entry) => entry.ref === refs.shared)).toHaveLength(1)
    expect(resolved.resources.find((entry) => entry.ref === refs.beta)?.enabled).toBeTrue()
    expect(resolved.resources.find((entry) => entry.ref === refs.mcp)?.enabled).toBeTrue()
  })

  test("reports selections and overrides outside the catalog association", () => {
    const value = draft({
      verticals: { example: { technologies: ["unknown"] } },
      resources: { [refs.beta]: { enabled: true } },
    })
    expect(Planner.resolve(catalog, value).conflicts.map((entry) => entry.code)).toEqual([
      "invalid_draft",
      "invalid_draft",
    ])
  })
})

describe("Stack planner ownership", () => {
  test("plans no work for an empty unmanaged stack", () => {
    const plan = Planner.plan(input(empty))
    expect(plan.actions).toEqual([])
    expect(Schema.decodeUnknownSync(Stack.Plan)(plan)).toEqual(plan)
  })

  test("removes unchanged managed resources, relinquishes modified ones, and cleans missing receipts", () => {
    const shared = sha("a")
    const beta = sha("b")
    const plan = Planner.plan(
      input(empty, {
        inventory: { project: { [refs.shared]: shared, [refs.beta]: sha("c") }, inherited: [] },
        receipts: {
          [refs.shared]: receipt("shared-skill", sha("1"), shared),
          [refs.beta]: receipt("beta-skill", sha("2"), beta),
          [refs.blocked]: receipt("blocked-skill", sha("3"), sha("d")),
        },
      }),
    )
    expect(actions(plan)).toEqual({
      [refs.blocked]: "remove",
      [refs.beta]: "relinquish_modified",
      [refs.shared]: "remove",
    })
    expect(plan.actions.find((entry) => entry.resource === refs.blocked)?.reason).toContain("receipt")
  })

  test("preserves project and inherited resources as unmanaged", () => {
    const value = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: { [refs.mcp]: { enabled: true, method: "local", parameters: { root: "." } } },
    })
    const plan = Planner.plan(
      input(value, {
        inventory: { project: { [refs.shared]: sha("a") }, inherited: [refs.mcp, refs.mcp] },
      }),
    )
    expect(actions(plan)).toMatchObject({
      [refs.shared]: "already_available_unmanaged",
      [refs.mcp]: "already_available_unmanaged",
    })
  })

  test("keeps unchanged managed resources, relinquishes edits, and reinstalls missing resources", () => {
    const value = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: { [refs.mcp]: { enabled: true, method: "local", parameters: { root: "." } } },
    })
    const current = Planner.fingerprintMcp({
      type: "local",
      command: ["example-mcp", "--root", "."],
      environment: { API_TOKEN: "{env:API_TOKEN}" },
      enabled: false,
    })
    const mcp = item(refs.mcp)
    const base = {
      [refs.shared]: receipt("shared-skill", sha("1"), sha("a")),
      [refs.mcp]: receipt("example-mcp", Planner.hash(mcp), current),
    }
    const kept = Planner.plan(
      input(value, {
        inventory: { project: { [refs.shared]: sha("a"), [refs.mcp]: current }, inherited: [] },
        receipts: base,
      }),
    )
    expect(actions(kept)).toEqual({ [refs.mcp]: "keep", [refs.shared]: "keep" })

    const drift = Planner.plan(
      input(value, {
        inventory: { project: { [refs.shared]: sha("b") }, inherited: [] },
        receipts: base,
      }),
    )
    expect(actions(drift)).toEqual({ [refs.mcp]: "install", [refs.shared]: "relinquish_modified" })
  })

  test("keeps unchanged managed legacy resources without Marketplace versions", () => {
    const value = draft({ verticals: { example: { technologies: ["alpha"] } }, resources: {} })
    const item = Object.fromEntries(
      Object.entries(skill("shared-skill", "1")).filter(([key]) => key !== "version" && key !== "source_revision"),
    )
    const legacy = Schema.decodeUnknownSync(Manifest)({
      version: 1,
      revision: `sha256:${"9".repeat(64)}`,
      items: [item],
    })
    const current = sha("a")
    const plan = Planner.plan(
      input(value, {
        marketplace: legacy,
        inventory: { project: { [refs.shared]: current }, inherited: [] },
        receipts: { [refs.shared]: receipt("shared-skill", sha("1"), current) },
      }),
    )

    expect(actions(plan)).toEqual({ [refs.shared]: "keep" })
  })

  test("reconfigures an unchanged managed MCP when desired parameters change", () => {
    const current = Planner.fingerprintMcp({
      type: "local",
      command: ["example-mcp", "--root", "."],
      environment: { API_TOKEN: "{env:API_TOKEN}" },
      enabled: false,
    })
    const value = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: {
        [refs.shared]: { enabled: false },
        [refs.mcp]: { enabled: true, method: "local", parameters: { root: "warehouse" } },
      },
    })
    const plan = Planner.plan(
      input(value, {
        inventory: { project: { [refs.mcp]: current }, inherited: [] },
        receipts: { [refs.mcp]: receipt("example-mcp", Planner.hash(item(refs.mcp)), current) },
      }),
    )
    expect(actions(plan)).toEqual({ [refs.mcp]: "install" })
    expect(plan.actions[0].reason).toContain("update")
  })
})

describe("Stack planner Marketplace validation", () => {
  test("classifies blocked and missing Marketplace resources", () => {
    const value = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: {
        [refs.shared]: { enabled: false },
        [refs.blocked]: { enabled: true },
        [refs.missing]: { enabled: true },
      },
    })
    const plan = Planner.plan(input(value))
    expect(actions(plan)).toEqual({ [refs.blocked]: "blocked", [refs.missing]: "missing" })
    expect(plan.conflicts).toContainEqual({
      code: "missing_marketplace_resource",
      message: `Marketplace resource ${refs.missing} is missing.`,
      resource: refs.missing,
      action: "missing",
    })
  })

  test("redacts unvalidated settings without relying on secret-shaped keys", () => {
    const value = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: {
        [refs.missing]: {
          enabled: true,
          method: "custom",
          parameters: { workspace: "innocent-key-raw-secret" },
        },
        [refs.beta]: {
          enabled: true,
          method: "custom",
          parameters: { workspace: "unassociated-raw-secret" },
        },
      },
    })
    const plan = Planner.plan(input(value))

    expect(plan.draft.resources[refs.missing]).toEqual({ enabled: true })
    expect(plan.draft.resources[refs.beta]).toEqual({ enabled: true })
    expect(JSON.stringify(plan)).not.toContain("raw-secret")
    expect(plan.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_marketplace_resource", resource: refs.missing }),
        expect.objectContaining({ code: "invalid_draft", resource: refs.beta }),
      ]),
    )
  })

  test("redacts unavailable settings while preserving unmanaged classification", () => {
    const value = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: {
        [refs.shared]: { enabled: false },
        [refs.mcp]: {
          enabled: true,
          method: "local",
          parameters: { workspace: "innocent-key-raw-secret" },
        },
      },
    })
    const plan = Planner.plan(
      input(value, {
        marketplace: undefined,
        inventory: { project: { [refs.mcp]: sha("a") }, inherited: [] },
      }),
    )

    expect(actions(plan)[refs.mcp]).toBe("already_available_unmanaged")
    expect(plan.draft.resources[refs.mcp]).toEqual({ enabled: true })
    expect(JSON.stringify(plan)).not.toContain("raw-secret")
    expect(plan.conflicts.map((entry) => entry.code)).toContain("marketplace_unavailable")
    expect(plan.conflicts.map((entry) => entry.code)).not.toContain("invalid_draft")
  })

  test("blocks absent methods, missing required values, and sensitive parameter values", () => {
    const values = [
      { enabled: true },
      { enabled: true, method: "local" },
      { enabled: true, method: "local", parameters: { root: ".", token: "secret" } },
    ]
    for (const override of values) {
      const value = draft({
        verticals: { example: { technologies: ["alpha"] } },
        resources: { [refs.shared]: { enabled: false }, [refs.mcp]: override },
      })
      const plan = Planner.plan(input(value))
      expect(actions(plan)).toEqual({ [refs.mcp]: "blocked" })
      expect(plan.conflicts.map((entry) => entry.code)).toContain("invalid_draft")
    }
  })

  test("validates supplied overrides even when resources are disabled", () => {
    const cases = [
      { [refs.mcp]: { enabled: false, method: "missing" } },
      { [refs.mcp]: { enabled: false, method: "local", parameters: { token: "raw-secret" } } },
      { [refs.shared]: { enabled: false, method: "local" } },
    ]
    for (const resources of cases) {
      const value = draft({ verticals: { example: { technologies: ["alpha"] } }, resources })
      const plan = Planner.plan(input(value))
      expect(plan.conflicts.map((entry) => entry.code)).toContain("invalid_draft")
    }

    const safe = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: {
        [refs.shared]: { enabled: false },
        [refs.mcp]: { enabled: false, method: "local" },
      },
    })
    expect(Planner.plan(input(safe)).conflicts).toEqual([])
  })

  test("classifies ownership before unavailable Marketplace metadata", () => {
    const value = draft({ verticals: { example: { technologies: ["alpha"] } }, resources: {} })
    const unmanaged = Planner.plan(
      input(value, { marketplace: undefined, inventory: { project: { [refs.shared]: sha("a") }, inherited: [] } }),
    )
    expect(actions(unmanaged)[refs.shared]).toBe("already_available_unmanaged")

    const modified = Planner.plan(
      input(value, {
        marketplace: undefined,
        inventory: { project: { [refs.shared]: sha("b") }, inherited: [] },
        receipts: { [refs.shared]: receipt("shared-skill", sha("1"), sha("a")) },
      }),
    )
    expect(actions(modified)[refs.shared]).toBe("relinquish_modified")
  })

  test("accepts non-secret parameters and returns method prerequisites and warnings", () => {
    const value = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: {
        [refs.shared]: { enabled: false },
        [refs.mcp]: { enabled: true, method: "local", parameters: { root: "." } },
      },
    })
    const plan = Planner.plan(input(value))
    expect(actions(plan)).toEqual({ [refs.mcp]: "install" })
    expect(plan.prerequisites).toEqual(["Install example-mcp.", "Set environment variable API_TOKEN."])
    expect(plan.warnings).toEqual(["Can update Example data."])
  })

  test("blocks desired installs when Marketplace is unavailable", () => {
    const value = draft({ verticals: { example: { technologies: ["alpha"] } }, resources: {} })
    const plan = Planner.plan(input(value, { marketplace: undefined }))
    expect(actions(plan)).toEqual({ [refs.shared]: "blocked" })
    expect(plan.conflicts.map((entry) => entry.code)).toContain("marketplace_unavailable")
  })
})

describe("Stack planner hashes", () => {
  test("is canonical across draft, inventory, and manifest ordering", () => {
    const left = draft({
      verticals: { example: { technologies: ["alpha", "alpha"] } },
      resources: {
        [refs.mcp]: { enabled: false, parameters: {} },
        [refs.shared]: { enabled: true },
      },
    })
    const right = draft({
      verticals: { example: { technologies: ["alpha"] } },
      resources: {
        [refs.shared]: { enabled: true },
        [refs.mcp]: { enabled: false },
      },
    })
    const reversed = Schema.decodeUnknownSync(Manifest)({ ...marketplace, items: [...marketplace.items].reverse() })
    const first = Planner.plan(
      input(left, { inventory: { project: { [refs.shared]: sha("a") }, inherited: [refs.mcp, refs.mcp] } }),
    )
    const second = Planner.plan(
      input(right, {
        marketplace: reversed,
        inventory: { project: { [refs.shared]: sha("a") }, inherited: [refs.mcp] },
      }),
    )
    expect(first).toEqual(second)
  })

  test("changes for stale config, catalog, Marketplace, and relevant inventory inputs", () => {
    const value = draft({ verticals: { example: { technologies: ["alpha"] } }, resources: {} })
    const base = input(value, { inventory: { project: { [refs.shared]: sha("a") }, inherited: [] } })
    const original = Planner.plan(base).plan_hash
    const nextCatalog = Schema.decodeUnknownSync(Stack.Catalog)({ ...catalog, revision: "2026-06-22.2" })
    const nextMarketplace = Schema.decodeUnknownSync(Manifest)({ ...marketplace, revision: "2026-06-22.2" })

    expect(Planner.plan({ ...base, config_revision: sha("f") }).plan_hash).not.toBe(original)
    expect(Planner.plan({ ...base, catalog: nextCatalog }).plan_hash).not.toBe(original)
    expect(Planner.plan({ ...base, marketplace: nextMarketplace }).plan_hash).not.toBe(original)
    expect(
      Planner.plan({ ...base, inventory: { project: { [refs.shared]: sha("b") }, inherited: [] } }).plan_hash,
    ).not.toBe(original)
  })
})
