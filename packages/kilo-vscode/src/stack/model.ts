import type {
  StackAssociation,
  StackCatalog,
  StackCategory,
  StackDraft,
  StackMcpMethod,
  StackParameter,
  StackParameterValue,
  StackPlan,
  StackProjectState,
  StackResourceChoice,
  StackResourceConfig,
  StackResourceKey,
  StackVertical,
} from "./types"

export interface StackCategoryGroup {
  name: string
  technologies: StackCategory["technologies"]
}

export interface StackCategoryEntry {
  category: StackCategory
  path: string[]
  groups: StackCategoryGroup[]
}

export interface StackValidationIssue {
  code: "method_required" | "parameter_required"
  resource: StackResourceKey
  resourceName: string
  parameter?: string
  parameterLabel?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function primitive(value: unknown): value is StackParameterValue {
  return (
    typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
  )
}

function config(value: unknown): StackResourceConfig | undefined {
  const input = record(value)
  if (!input || typeof input.enabled !== "boolean") return
  const values = record(input.parameters)
  const parameters = values
    ? Object.fromEntries(
        Object.entries(values).filter((entry): entry is [string, StackParameterValue] => primitive(entry[1])),
      )
    : undefined
  return {
    enabled: input.enabled,
    ...(typeof input.method === "string" ? { method: input.method } : {}),
    ...(parameters && Object.keys(parameters).length > 0 ? { parameters } : {}),
  }
}

export function normalizeDraft(source: StackProjectState["draft"] | StackPlan["draft"] | StackDraft): StackDraft {
  const verticals = Object.fromEntries(
    Object.entries(source.verticals).flatMap(([id, value]) => {
      const input = record(value)
      if (!input || !Array.isArray(input.technologies)) return []
      return [[id, { technologies: input.technologies.filter((item): item is string => typeof item === "string") }]]
    }),
  )
  const resources = Object.fromEntries(
    Object.entries(source.resources).flatMap(([ref, value]) => {
      const next = config(value)
      return next ? [[ref, next]] : []
    }),
  )
  return { verticals, resources }
}

export function cloneDraft(draft: StackDraft): StackDraft {
  return {
    verticals: Object.fromEntries(
      Object.entries(draft.verticals).map(([id, value]) => [id, { technologies: [...value.technologies] }]),
    ),
    resources: Object.fromEntries(
      Object.entries(draft.resources).map(([ref, value]) => [
        ref,
        { ...value, ...(value.parameters ? { parameters: { ...value.parameters } } : {}) },
      ]),
    ),
  }
}

export function emptyDraft(): StackDraft {
  return { verticals: {}, resources: {} }
}

function groupsFor(category: StackCategory): StackCategoryGroup[] {
  if (!category.categories.length) return [{ name: "", technologies: category.technologies }]
  const groups: StackCategoryGroup[] = []
  if (category.technologies.length) groups.push({ name: "", technologies: category.technologies })
  for (const child of category.categories) {
    for (const group of groupsFor(child)) {
      groups.push({ name: group.name || child.name, technologies: group.technologies })
    }
  }
  return groups
}

export function flattenCategories(categories: readonly StackCategory[], path: string[] = []): StackCategoryEntry[] {
  return categories.map((category) => {
    const next = [...path, category.name]
    return { category, path: next, groups: groupsFor(category) }
  })
}

export function selectedTechnologyIDs(draft: StackDraft): string[] {
  return [...new Set(Object.values(draft.verticals).flatMap((vertical) => vertical.technologies))]
}

function technologies(catalog: StackCatalog) {
  return catalog.catalog.verticals.flatMap((vertical) => vertical.technologies)
}

function references(catalog: StackCatalog, draft: StackDraft): Map<string, number> {
  const selected = new Set(selectedTechnologyIDs(draft))
  const refs = new Map<string, number>()
  for (const technology of technologies(catalog)) {
    if (!selected.has(technology.id)) continue
    for (const ref of new Set(technology.resources.map((association) => association.ref))) {
      refs.set(ref, (refs.get(ref) ?? 0) + 1)
    }
  }
  return refs
}

export function setTechnology(
  catalog: StackCatalog,
  draft: StackDraft,
  vertical: string,
  technology: string,
  enabled: boolean,
): StackDraft {
  const before = references(catalog, draft)
  const copy = cloneDraft(draft)
  const current = copy.verticals[vertical]?.technologies ?? []
  copy.verticals[vertical] = {
    technologies: enabled
      ? [...new Set([...current, technology])]
      : current.filter((candidate) => candidate !== technology),
  }
  if (enabled) return copy
  const after = references(catalog, copy)
  for (const ref of Object.keys(copy.resources)) {
    if ((before.get(ref) ?? 0) > 0 && (after.get(ref) ?? 0) === 0) delete copy.resources[ref]
  }
  return copy
}

function selectedAssociations(catalog: StackCatalog, draft: StackDraft, ref?: string): StackAssociation[] {
  const ids = new Set(selectedTechnologyIDs(draft))
  return technologies(catalog)
    .filter((technology) => ids.has(technology.id))
    .flatMap((technology) => technology.resources)
    .filter((association) => ref === undefined || association.ref === ref)
}

export function resourcesForTechnology(catalog: StackCatalog, technology: string): StackResourceChoice[] {
  const item = technologies(catalog).find((candidate) => candidate.id === technology)
  if (!item) return []
  return item.resources.flatMap((association) => {
    const summary = catalog.resources.find((candidate) => candidate.resource.ref === association.ref)
    const resource =
      summary?.resource ?? catalog.catalog.resources.find((candidate) => candidate.ref === association.ref)
    if (!resource) return []
    return [
      {
        resource,
        association,
        availability: summary?.availability ?? "missing",
        ...(summary?.reason ? { reason: summary.reason } : {}),
        ...(summary?.item ? { item: summary.item } : {}),
      },
    ]
  })
}

export function resourceDefault(catalog: StackCatalog, draft: StackDraft, ref: string): boolean {
  return selectedAssociations(catalog, draft, ref).some((association) => association.default)
}

export function resourceEnabled(catalog: StackCatalog, draft: StackDraft, ref: string): boolean {
  return draft.resources[ref]?.enabled ?? resourceDefault(catalog, draft, ref)
}

export function resourceMethods(choice: StackResourceChoice): StackMcpMethod[] {
  if (choice.resource.kind !== "mcp" || choice.item?.kind !== "mcp") return []
  return choice.item.methods
}

export function resourceMethod(draft: StackDraft, choice: StackResourceChoice): StackMcpMethod | undefined {
  const id = draft.resources[choice.resource.ref]?.method
  return id ? resourceMethods(choice).find((method) => method.id === id) : undefined
}

function value(parameter: StackParameter, input: unknown): StackParameterValue | undefined {
  const typed = (() => {
    if (parameter.type === "boolean") return typeof input === "boolean" ? input : undefined
    if (parameter.type === "integer") {
      return typeof input === "number" && Number.isInteger(input) ? input : undefined
    }
    return typeof input === "string" ? input : undefined
  })()
  if (typed === undefined) return
  if (parameter.allowed_values && !parameter.allowed_values.some((allowed) => allowed === typed)) return
  return typed
}

function defaults(method: StackMcpMethod): Record<string, StackParameterValue> {
  return Object.fromEntries(
    method.parameters.flatMap((parameter) => {
      if (parameter.sensitive || parameter.default === undefined) return []
      const initial = value(parameter, parameter.default)
      return initial === undefined ? [] : [[parameter.id, initial]]
    }),
  )
}

function parameters(
  method: StackMcpMethod,
  source?: Record<string, StackParameterValue>,
): Record<string, StackParameterValue> {
  const current = Object.fromEntries(
    method.parameters.flatMap((parameter) => {
      if (parameter.sensitive) return []
      const next = value(parameter, source?.[parameter.id])
      return next === undefined ? [] : [[parameter.id, next]]
    }),
  )
  return { ...defaults(method), ...current }
}

export function setResourceEnabled(draft: StackDraft, choice: StackResourceChoice, enabled: boolean): StackDraft {
  if (choice.availability !== "available" && enabled) return draft
  const copy = cloneDraft(draft)
  const current = copy.resources[choice.resource.ref]
  if (choice.availability !== "available") {
    copy.resources[choice.resource.ref] = { enabled: false }
    return copy
  }
  if (choice.resource.kind !== "mcp") {
    copy.resources[choice.resource.ref] = { enabled }
    return copy
  }
  const method = resourceMethod(copy, choice)
  const values = method ? parameters(method, current?.parameters) : undefined
  copy.resources[choice.resource.ref] = {
    enabled,
    ...(method ? { method: method.id } : {}),
    ...(values && Object.keys(values).length > 0 ? { parameters: values } : {}),
  }
  return copy
}

export function setResourceMethod(draft: StackDraft, choice: StackResourceChoice, method: StackMcpMethod): StackDraft {
  if (choice.availability !== "available") return draft
  const selected = resourceMethods(choice).find((candidate) => candidate.id === method.id)
  if (!selected) return draft
  const copy = cloneDraft(draft)
  const current = copy.resources[choice.resource.ref]
  const values = parameters(selected, current?.parameters)
  copy.resources[choice.resource.ref] = {
    enabled: current?.enabled ?? true,
    method: selected.id,
    ...(Object.keys(values).length > 0 ? { parameters: values } : {}),
  }
  return copy
}

export function setResourceParameter(
  draft: StackDraft,
  choice: StackResourceChoice,
  parameter: StackParameter,
  input: StackParameterValue | undefined,
): StackDraft {
  if (choice.availability !== "available" || parameter.sensitive) return draft
  const method = resourceMethod(draft, choice)
  const definition = method?.parameters.find((candidate) => candidate.id === parameter.id && !candidate.sensitive)
  if (!method || !definition) return draft
  const copy = cloneDraft(draft)
  const current = copy.resources[choice.resource.ref]
  const values = parameters(method, current?.parameters)
  const next = value(definition, input)
  if (next === undefined) delete values[definition.id]
  if (next !== undefined) values[definition.id] = next
  copy.resources[choice.resource.ref] = {
    enabled: current?.enabled ?? true,
    method: method.id,
    ...(Object.keys(values).length > 0 ? { parameters: values } : {}),
  }
  return copy
}

export function resourceValue(
  draft: StackDraft,
  choice: StackResourceChoice,
  parameter: StackParameter,
): StackParameterValue | undefined {
  const current = draft.resources[choice.resource.ref]?.parameters?.[parameter.id]
  return value(parameter, current) ?? (!parameter.sensitive ? value(parameter, parameter.default) : undefined)
}

function missing(value: StackParameterValue | undefined): boolean {
  if (value === undefined) return true
  return typeof value === "string" && value.trim() === ""
}

export function validateDraft(catalog: StackCatalog, draft: StackDraft): StackValidationIssue[] {
  const choices = selectedTechnologyIDs(draft).flatMap((technology) => resourcesForTechnology(catalog, technology))
  const refs = new Set<string>()
  const issues: StackValidationIssue[] = []
  for (const choice of choices) {
    if (refs.has(choice.resource.ref)) continue
    refs.add(choice.resource.ref)
    if (
      choice.availability !== "available" ||
      !resourceEnabled(catalog, draft, choice.resource.ref) ||
      choice.resource.kind !== "mcp"
    )
      continue
    const method = resourceMethod(draft, choice)
    if (!method) {
      issues.push({
        code: "method_required",
        resource: choice.resource.ref,
        resourceName: choice.resource.name,
      })
      continue
    }
    for (const parameter of method.parameters) {
      if (parameter.sensitive || !parameter.required || !missing(resourceValue(draft, choice, parameter))) continue
      issues.push({
        code: "parameter_required",
        resource: choice.resource.ref,
        resourceName: choice.resource.name,
        parameter: parameter.id,
        parameterLabel: parameter.name,
      })
    }
  }
  return issues
}

export function sanitizeDraft(catalog: StackCatalog, draft: StackDraft): StackDraft {
  const copy = cloneDraft(draft)
  const choices = selectedTechnologyIDs(copy).flatMap((technology) => resourcesForTechnology(catalog, technology))
  const resources = new Map(choices.map((choice) => [choice.resource.ref, choice]))
  copy.resources = Object.fromEntries(
    Object.entries(copy.resources).flatMap(([ref, config]) => {
      const choice = resources.get(ref)
      if (!choice) return []
      if (choice.resource.kind !== "mcp") return [[ref, { enabled: config.enabled }]]
      const method = resourceMethod(copy, choice)
      if (!method) return [[ref, { enabled: config.enabled }]]
      const values = parameters(method, config.parameters)
      return [
        [
          ref,
          {
            enabled: config.enabled,
            method: method.id,
            ...(Object.keys(values).length > 0 ? { parameters: values } : {}),
          },
        ],
      ]
    }),
  )
  return copy
}

export function initialVertical(catalog: StackCatalog, draft: StackDraft): StackVertical | undefined {
  const selected = Object.keys(draft.verticals)[0]
  return catalog.catalog.verticals.find((vertical) => vertical.id === selected) ?? catalog.catalog.verticals[0]
}

export function catalogReady(catalog: StackCatalog): boolean {
  if (catalog.catalog.verticals.length === 0 || catalog.expected_resources.length === 0) return false
  const availability = new Map(catalog.resources.map((summary) => [summary.resource.ref, summary.availability]))
  return catalog.expected_resources.every((ref) => availability.get(ref) === "available")
}

export function catalogGapCount(catalog: StackCatalog): number {
  const availability = new Map(catalog.resources.map((summary) => [summary.resource.ref, summary.availability]))
  return catalog.expected_resources.filter((ref) => availability.get(ref) !== "available").length
}
