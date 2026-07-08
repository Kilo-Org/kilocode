import { Schema } from "effect"
import { Stack } from "../schema"
import { data, expected, expectedMarketplaceResources, resources, revision } from "./data"

export const IssueCode = Schema.Literals([
  "vertical_id_collision",
  "category_id_collision",
  "technology_id_collision",
  "resource_id_collision",
  "duplicate_placement",
  "duplicate_association",
  "missing_technology",
  "missing_resource",
  "resource_identity_mismatch",
  "resource_metadata_mismatch",
  "unsafe_default",
  "unplaced_technology",
  "unreferenced_resource",
  "expected_resource_collision",
  "expected_resource_missing",
  "unexpected_resource",
])
export type IssueCode = Schema.Schema.Type<typeof IssueCode>

export const Issue = Schema.Struct({
  code: IssueCode,
  path: Schema.String,
  message: Schema.String,
})
export type Issue = Schema.Schema.Type<typeof Issue>

export interface Entry {
  readonly vertical: Stack.Vertical
  readonly resources: ReadonlyArray<Stack.Resource>
}

export function walk(categories: ReadonlyArray<Stack.Category>): Stack.Category[] {
  return categories.flatMap((category) => [category, ...walk(category.categories)])
}

export function placements(vertical: Stack.Vertical): Stack.Placement[] {
  return walk(vertical.categories).flatMap((category) => category.technologies)
}

export function technologies(source: Stack.Catalog): Map<Stack.TechnologyID, Stack.Technology> {
  return new Map(
    source.verticals.flatMap((vertical) => vertical.technologies).map((technology) => [technology.id, technology]),
  )
}

export function resourcesByRef(source: Stack.Catalog): Map<Stack.ResourceRef, Stack.Resource> {
  return new Map(source.resources.map((resource) => [resource.ref, resource]))
}

export function defaultable(resource: Stack.Resource): boolean {
  return resource.kind === "mcp" || (resource.kind === "skill" && resource.trust === "official" && resource.maturity === "stable")
}

export function defaults(source: Stack.Catalog, ids: Iterable<Stack.TechnologyID>): Stack.ResourceRef[] {
  const items = technologies(source)
  const refs = new Set<Stack.ResourceRef>()
  for (const id of ids) {
    const item = items.get(id)
    if (!item) continue
    for (const association of item.resources) {
      if (association.default) refs.add(association.ref)
    }
  }
  return [...refs].toSorted()
}

export function validate(source: Stack.Catalog, manifest: ReadonlyArray<Stack.ResourceRef>): Issue[] {
  const issues: Issue[] = []
  const verticals = new Set<Stack.VerticalID>()
  const categories = new Set<Stack.CategoryID>()
  const tech = new Map<Stack.TechnologyID, Stack.Technology>()
  const registered = new Map<Stack.ResourceRef, Stack.Resource>()
  const associated = new Set<Stack.ResourceRef>()

  for (const resource of source.resources) {
    const path = `resources.${resource.ref}`
    const previous = registered.get(resource.ref)
    if (previous) {
      issues.push({
        code: "resource_id_collision",
        path,
        message: `Resource ID ${resource.ref} is registered more than once.`,
      })
      continue
    }
    registered.set(resource.ref, resource)
    if (resource.ref !== `${resource.kind}:${resource.id}`) {
      issues.push({
        code: "resource_identity_mismatch",
        path,
        message: `Resource ref ${resource.ref} does not match its kind and ID.`,
      })
    }
  }

  for (const vertical of source.verticals) {
    const base = `verticals.${vertical.id}`
    const local = new Map<Stack.TechnologyID, Stack.Technology>()
    const counts = new Map<Stack.TechnologyID, number>()
    if (verticals.has(vertical.id)) {
      issues.push({
        code: "vertical_id_collision",
        path: base,
        message: `Vertical ID ${vertical.id} is registered more than once.`,
      })
    }
    verticals.add(vertical.id)

    for (const technology of vertical.technologies) {
      const path = `${base}.technologies.${technology.id}`
      if (tech.has(technology.id)) {
        issues.push({
          code: "technology_id_collision",
          path,
          message: `Technology ID ${technology.id} is registered more than once.`,
        })
      }
      tech.set(technology.id, technology)
      local.set(technology.id, technology)
      const refs = new Set<Stack.ResourceRef>()
      for (const association of technology.resources) {
        const target = `${path}.resources.${association.ref}`
        associated.add(association.ref)
        if (refs.has(association.ref)) {
          issues.push({
            code: "duplicate_association",
            path: target,
            message: `Technology ${technology.id} repeats ${association.ref}.`,
          })
        }
        refs.add(association.ref)
        const resource = registered.get(association.ref)
        if (!resource) {
          issues.push({
            code: "missing_resource",
            path: target,
            message: `Resource ${association.ref} is not registered.`,
          })
          continue
        }
        if (
          association.trust !== resource.trust ||
          association.maturity !== resource.maturity ||
          association.source !== resource.source
        ) {
          issues.push({
            code: "resource_metadata_mismatch",
            path: target,
            message: `Association metadata for ${association.ref} is stale.`,
          })
        }
        if (association.default && (!defaultable(resource) || !association.curated)) {
          issues.push({
            code: "unsafe_default",
            path: target,
            message: `Only stable first-party Skills and MCP servers in Kilo-curated associations may be enabled by default.`,
          })
        }
      }
    }

    for (const category of walk(vertical.categories)) {
      const path = `${base}.categories.${category.id}`
      if (categories.has(category.id)) {
        issues.push({
          code: "category_id_collision",
          path,
          message: `Category ID ${category.id} is registered more than once.`,
        })
      }
      categories.add(category.id)
      const placed = new Set<Stack.TechnologyID>()
      for (const placement of category.technologies) {
        const target = `${path}.technologies.${placement.technology}`
        counts.set(placement.technology, (counts.get(placement.technology) ?? 0) + 1)
        if (placed.has(placement.technology)) {
          issues.push({
            code: "duplicate_placement",
            path: target,
            message: `Category ${category.id} repeats ${placement.technology}.`,
          })
        }
        placed.add(placement.technology)
        if (!local.has(placement.technology)) {
          issues.push({
            code: "missing_technology",
            path: target,
            message: `Technology ${placement.technology} is not registered in vertical ${vertical.id}.`,
          })
        }
      }
    }

    for (const id of local.keys()) {
      if (counts.has(id)) continue
      issues.push({
        code: "unplaced_technology",
        path: `${base}.technologies.${id}`,
        message: `Technology ${id} has no category placement.`,
      })
    }

  }

  for (const resource of source.resources) {
    if (associated.has(resource.ref)) continue
    issues.push({
      code: "unreferenced_resource",
      path: `resources.${resource.ref}`,
      message: `Resource ${resource.ref} is not associated with a technology.`,
    })
  }

  const wanted = new Set<Stack.ResourceRef>()
  for (const ref of manifest) {
    if (wanted.has(ref)) {
      issues.push({
        code: "expected_resource_collision",
        path: `resources.${ref}`,
        message: `Expected Marketplace resource ${ref} is listed more than once.`,
      })
    }
    wanted.add(ref)
    if (!registered.has(ref)) {
      issues.push({
        code: "expected_resource_missing",
        path: `resources.${ref}`,
        message: `Expected Marketplace resource ${ref} is missing.`,
      })
    }
  }
  for (const ref of registered.keys()) {
    if (wanted.has(ref)) continue
    issues.push({
      code: "unexpected_resource",
      path: `resources.${ref}`,
      message: `Resource ${ref} is absent from the expected Marketplace manifest.`,
    })
  }
  return issues
}

export function register(
  next: Stack.Revision,
  entries: ReadonlyArray<Entry>,
  manifest: ReadonlyArray<Stack.ResourceRef>,
): Stack.Catalog {
  const seen = new Map<Stack.ResourceRef, Stack.Resource>()
  const unique: Stack.Resource[] = []
  for (const resource of entries.flatMap((entry) => entry.resources)) {
    const previous = seen.get(resource.ref)
    if (!previous) {
      seen.set(resource.ref, resource)
      unique.push(resource)
      continue
    }
    if (JSON.stringify(previous) === JSON.stringify(resource)) continue
    unique.push(resource)
  }
  const source = Schema.decodeUnknownSync(Stack.Catalog)({
    revision: next,
    verticals: entries.map((entry) => entry.vertical),
    resources: unique,
  })
  const issues = validate(source, manifest)
  if (issues.length > 0) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"))
  return source
}

export const builtin = register(revision, [{ vertical: data, resources }], expected)
export { data, expected, expectedMarketplaceResources, resources, revision }
