import { createMemo, createSignal } from "solid-js"
import { stackApplyFailure, type Query } from "../../../client"
import { errMsg } from "../../../shared/utils"
import type {
  StackApplyError,
  StackApplyResponse,
  StackAssociation,
  StackBundle,
  StackCatalogResponse,
  StackCategory,
  StackDraft,
  StackMethod,
  StackParameter,
  StackParameterValue,
  StackPlanAction,
  StackPreviewResponse,
  StackResourceItem,
  StackStateResponse,
  StackTechnology,
} from "../stack/types"

export type StackPhase = "vertical" | "category" | "resources" | "review" | "result"
export type StackBusy = "preview" | "apply"
export type StackValidationIssue = { resource: string; parameter?: string; message: string }

export type StackPlanGroups = {
  install: StackPlanAction[]
  remove: StackPlanAction[]
  preserve: StackPlanAction[]
  blocked: StackPlanAction[]
}

type StackOps = {
  preview: (target: Query, draft: StackDraft, signal: AbortSignal) => Promise<StackPreviewResponse>
  apply: (target: Query, draft: StackDraft, hash: string, signal: AbortSignal) => Promise<StackApplyResponse>
  reload: (target: Query, signal: AbortSignal) => Promise<StackStateResponse>
}

type Override = {
  enabled: boolean
  method?: string
  parameters?: Record<string, StackParameterValue>
}

function object(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input)
}

function scalar(input: unknown): input is StackParameterValue {
  return typeof input === "string" || typeof input === "number" || typeof input === "boolean"
}

function selection(draft: StackDraft, vertical: string) {
  const item = draft.verticals[vertical]
  if (!object(item) || !Array.isArray(item.technologies)) return []
  return item.technologies.filter((id): id is string => typeof id === "string")
}

function override(draft: StackDraft, ref: string): Override | undefined {
  const item = draft.resources[ref]
  if (!object(item) || typeof item.enabled !== "boolean") return undefined
  const method = typeof item.method === "string" ? item.method : undefined
  const values = object(item.parameters)
    ? Object.fromEntries(
        Object.entries(item.parameters).filter((entry): entry is [string, StackParameterValue] => scalar(entry[1])),
      )
    : undefined
  return {
    enabled: item.enabled,
    ...(method ? { method } : {}),
    ...(values && Object.keys(values).length ? { parameters: values } : {}),
  }
}

export function emptyStackDraft(): StackDraft {
  return { verticals: {}, resources: {} }
}

export function cloneStackDraft(input: StackDraft): StackDraft {
  const verticals = Object.fromEntries(
    Object.keys(input.verticals).map((id) => [id, { technologies: [...selection(input, id)] }]),
  )
  const resources = Object.fromEntries(
    Object.keys(input.resources).flatMap((ref) => {
      const item = override(input, ref)
      return item ? [[ref, { ...item, parameters: item.parameters ? { ...item.parameters } : undefined }]] : []
    }),
  )
  return { verticals, resources }
}

export interface StackCategoryGroup {
  name: string
  technologies: StackCategory["technologies"]
}

export interface StackCategoryEntry {
  category: StackCategory
  groups: StackCategoryGroup[]
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

export function stackCategoryGroups(input: StackCategory[]): StackCategoryEntry[] {
  return input.map((category) => ({ category, groups: groupsFor(category) }))
}

export function stackTechnologySelected(draft: StackDraft, vertical: string, id: string) {
  return selection(draft, vertical).includes(id)
}

export function toggleStackTechnology(draft: StackDraft, vertical: string, id: string) {
  const ids = selection(draft, vertical)
  const technologies = ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
  const copy = cloneStackDraft(draft)
  copy.verticals[vertical] = { technologies }
  return copy
}

type CatalogParameter = NonNullable<StackResourceItem["resource"]["parameters"]>[number]

function normalize(parameters: readonly CatalogParameter[]): StackParameter[] {
  return parameters.map((item) => ({
    id: item.id,
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
    type:
      !item.sensitive && typeof item.default === "boolean"
        ? "boolean"
        : !item.sensitive && typeof item.default === "number"
          ? "integer"
          : "string",
    required: item.required,
    sensitive: item.sensitive,
    ...(item.sensitive ? { env: item.env } : {}),
    ...(!item.sensitive && item.default !== undefined ? { default: item.default } : {}),
  }))
}

function methodParameters(method: StackMethod): StackParameter[] {
  return method.parameters.map((item) => ({
    id: item.id,
    label: item.name,
    ...(item.description ? { description: item.description } : {}),
    type: item.type,
    required: item.required,
    sensitive: item.sensitive,
    ...(item.environment ? { env: item.environment } : {}),
    ...(item.default !== undefined ? { default: item.default } : {}),
    ...(item.allowed_values ? { values: [...item.allowed_values] } : {}),
  }))
}

function definitions(item: StackResourceItem, id: string) {
  if (!item.item) return item.parameters
  if (item.item.kind !== "mcp") return []
  const method = item.item.methods.find((candidate) => candidate.id === id)
  return method ? methodParameters(method) : []
}

function valid(parameter: StackParameter, input: StackParameterValue | undefined): input is StackParameterValue {
  if (input === undefined) return false
  const typed =
    parameter.type === "boolean"
      ? typeof input === "boolean"
      : parameter.type === "integer"
        ? typeof input === "number" && Number.isInteger(input)
        : typeof input === "string"
  if (!typed) return false
  if (parameter.values && !parameter.values.some((item) => item === input)) return false
  return true
}

function defaults(parameters: StackParameter[]) {
  return Object.fromEntries(
    parameters.flatMap((item) => {
      if (item.sensitive) return []
      const value = item.default
      return valid(item, value) ? [[item.id, value]] : []
    }),
  )
}

function values(parameters: StackParameter[], previous?: Record<string, StackParameterValue>) {
  const kept = Object.fromEntries(
    parameters.flatMap((item) => {
      if (item.sensitive) return []
      const value = previous?.[item.id]
      return valid(item, value) ? [[item.id, value]] : []
    }),
  )
  return { ...defaults(parameters), ...kept }
}

export function stackResourceEnabled(draft: StackDraft, item: StackResourceItem) {
  return override(draft, item.resource.ref)?.enabled ?? item.default
}

export function stackResourceMethod(draft: StackDraft, item: StackResourceItem) {
  return override(draft, item.resource.ref)?.method ?? ""
}

export function stackResourceMethods(item: StackResourceItem) {
  return item.item?.kind === "mcp" ? item.item.methods : []
}

export function stackSelectedMethod(draft: StackDraft, item: StackResourceItem) {
  const id = stackResourceMethod(draft, item)
  return stackResourceMethods(item).find((method) => method.id === id)
}

export function stackResourceParameters(draft: StackDraft, item: StackResourceItem) {
  if (!item.item) return item.parameters
  const method = stackSelectedMethod(draft, item)
  return method ? methodParameters(method) : []
}

export function setStackResource(draft: StackDraft, item: StackResourceItem, enabled: boolean) {
  if (item.availability !== "available" && enabled) return draft
  const copy = cloneStackDraft(draft)
  const before = override(copy, item.resource.ref)
  if (item.resource.kind === "skill") {
    copy.resources[item.resource.ref] = { enabled }
    return copy
  }
  const parameters = values(stackResourceParameters(copy, item), before?.parameters)
  copy.resources[item.resource.ref] = {
    enabled,
    ...(before?.method ? { method: before.method } : {}),
    ...(Object.keys(parameters).length ? { parameters } : {}),
  }
  return copy
}

export function setStackMethod(draft: StackDraft, item: StackResourceItem, id: string) {
  if (item.availability !== "available") return draft
  const copy = cloneStackDraft(draft)
  const before = override(copy, item.resource.ref)
  const method = id.trim()
  const parameters = method ? definitions(item, method) : []
  const next = values(parameters, before?.parameters)
  copy.resources[item.resource.ref] = {
    enabled: before?.enabled ?? true,
    ...(method ? { method } : {}),
    ...(Object.keys(next).length ? { parameters: next } : {}),
  }
  return copy
}

export function setStackParameter(
  draft: StackDraft,
  item: StackResourceItem,
  parameter: StackParameter,
  value: StackParameterValue | undefined,
) {
  if (item.availability !== "available" || parameter.sensitive) return draft
  if (value !== undefined && !valid(parameter, value)) return draft
  const copy = cloneStackDraft(draft)
  const before = override(copy, item.resource.ref)
  const parameters = { ...before?.parameters }
  if (value === undefined) delete parameters[parameter.id]
  if (value !== undefined) parameters[parameter.id] = value
  copy.resources[item.resource.ref] = {
    enabled: before?.enabled ?? true,
    ...(before?.method ? { method: before.method } : {}),
    ...(Object.keys(parameters).length ? { parameters } : {}),
  }
  return copy
}

export function stackParameterValue(draft: StackDraft, item: StackResourceItem, parameter: StackParameter) {
  return (
    override(draft, item.resource.ref)?.parameters?.[parameter.id] ??
    (!parameter.sensitive ? parameter.default : undefined)
  )
}

function selected(draft: StackDraft) {
  return new Set(Object.keys(draft.verticals).flatMap((id) => selection(draft, id)))
}

function fallback(association: StackAssociation, resource: StackResourceItem["resource"]) {
  return normalize(association.parameters ?? resource.parameters ?? [])
}

export function stackResourceGroups(catalog: StackCatalogResponse, draft: StackDraft) {
  const ids = selected(draft)
  const technologies = catalog.catalog.verticals
    .flatMap((vertical) => vertical.technologies)
    .filter((item) => ids.has(item.id))
  const resources = new Map(catalog.catalog.resources.map((item) => [item.ref, item]))
  const summaries = new Map(catalog.resources.map((item) => [item.resource.ref, item]))
  const enabled = new Map<string, boolean>()
  for (const technology of technologies) {
    for (const association of technology.resources) {
      enabled.set(association.ref, Boolean(enabled.get(association.ref)) || association.default)
    }
  }
  return technologies
    .map((technology) => {
      const items = technology.resources.flatMap((association): StackResourceItem[] => {
        const resource = resources.get(association.ref)
        if (!resource) return []
        const summary = summaries.get(association.ref)
        return [
          {
            resource,
            association,
            availability: summary?.availability ?? "missing",
            reason: summary?.reason,
            ...(summary?.item ? { item: summary.item } : {}),
            default: enabled.get(association.ref) ?? false,
            parameters: summary?.item ? [] : fallback(association, resource),
          },
        ]
      })
      return {
        technology,
        skills: items.filter((item) => item.resource.kind === "skill"),
        mcps: items.filter((item) => item.resource.kind === "mcp"),
      }
    })
    .filter((item) => item.skills.length || item.mcps.length)
}

export function stackCatalogReady(catalog: StackCatalogResponse) {
  if (!catalog.catalog.verticals.length || !catalog.expected_resources.length) return false
  const availability = new Map(catalog.resources.map((item) => [item.resource.ref, item.availability]))
  return catalog.expected_resources.every((ref) => availability.get(ref) === "available")
}

export function stackCatalogGapCount(catalog: StackCatalogResponse) {
  const availability = new Map(catalog.resources.map((item) => [item.resource.ref, item.availability]))
  return catalog.expected_resources.filter((ref) => availability.get(ref) !== "available").length
}

function references(catalog: StackCatalogResponse, draft: StackDraft) {
  const ids = selected(draft)
  const refs = new Map<string, number>()
  const technologies = catalog.catalog.verticals.flatMap((vertical) => vertical.technologies)
  for (const technology of technologies) {
    if (!ids.has(technology.id)) continue
    for (const association of technology.resources) {
      refs.set(association.ref, (refs.get(association.ref) ?? 0) + 1)
    }
  }
  return refs
}

export function pruneStackResources(catalog: StackCatalogResponse, before: StackDraft, draft: StackDraft) {
  const previous = references(catalog, before)
  const current = references(catalog, draft)
  const known = new Set(catalog.catalog.resources.map((resource) => resource.ref))
  const copy = cloneStackDraft(draft)
  for (const ref of Object.keys(copy.resources)) {
    if (known.has(ref) && (previous.get(ref) ?? 0) > 0 && (current.get(ref) ?? 0) === 0) {
      delete copy.resources[ref]
    }
  }
  return copy
}

function missing(input: StackParameterValue | undefined) {
  if (input === undefined) return true
  return typeof input === "string" && input.trim() === ""
}

export function validateStackDraft(catalog: StackCatalogResponse, draft: StackDraft) {
  const resources = new Map(
    stackResourceGroups(catalog, draft)
      .flatMap((group) => [...group.skills, ...group.mcps])
      .map((item) => [item.resource.ref, item]),
  )
  const issues: StackValidationIssue[] = []
  for (const item of resources.values()) {
    if (item.availability !== "available" || item.resource.kind !== "mcp" || !stackResourceEnabled(draft, item)) continue
    const method = stackResourceMethod(draft, item)
    if (!method) {
      issues.push({ resource: item.resource.ref, message: `${item.resource.name} requires an installation method.` })
      continue
    }
    if (item.item?.kind === "mcp" && !stackSelectedMethod(draft, item)) {
      issues.push({
        resource: item.resource.ref,
        message: `${item.resource.name} requires an available installation method.`,
      })
      continue
    }
    for (const parameter of stackResourceParameters(draft, item)) {
      if (parameter.sensitive) continue
      const value = stackParameterValue(draft, item, parameter)
      if (parameter.required && missing(value)) {
        issues.push({
          resource: item.resource.ref,
          parameter: parameter.id,
          message: `${parameter.label} is required for ${item.resource.name}.`,
        })
        continue
      }
      if (missing(value) || valid(parameter, value)) continue
      const allowed = parameter.values?.map((entry) => String(entry)).join(", ")
      issues.push({
        resource: item.resource.ref,
        parameter: parameter.id,
        message: allowed
          ? `${parameter.label} must be one of: ${allowed}.`
          : `${parameter.label} is invalid for ${item.resource.name}.`,
      })
    }
  }
  return issues
}

export function groupStackPlan(actions: StackPlanAction[]): StackPlanGroups {
  const groups: StackPlanGroups = { install: [], remove: [], preserve: [], blocked: [] }
  for (const item of actions) {
    if (item.action === "install") groups.install.push(item)
    else if (item.action === "remove") groups.remove.push(item)
    else if (item.action === "blocked" || item.action === "missing") groups.blocked.push(item)
    else groups.preserve.push(item)
  }
  return groups
}

function stale(input: unknown): boolean {
  if (!input || typeof input !== "object") return false
  const error = input as { status?: unknown; code?: unknown; cause?: unknown }
  if (error.status === 409 || error.code === "stale_plan") return true
  return stale(error.cause)
}

function aborted(input: unknown) {
  return input instanceof DOMException && input.name === "AbortError"
}

export function stackProjectKey(input: Query) {
  return `${input.url}\u0000${input.dir}\u0000${input.scope}`
}

export function createStackWizard(ops: StackOps) {
  const [catalog, setCatalog] = createSignal<StackCatalogResponse>()
  const [saved, setSaved] = createSignal<StackStateResponse>()
  const [draft, setDraft] = createSignal(emptyStackDraft())
  const [target, setTarget] = createSignal<Query>()
  const [project, setProject] = createSignal("")
  const [vertical, setVertical] = createSignal("")
  const [phase, setPhase] = createSignal<StackPhase>("vertical")
  const [index, setIndex] = createSignal(0)
  const [search, setSearchValue] = createSignal("")
  const [plan, setPlan] = createSignal<StackPreviewResponse>()
  const [result, setResult] = createSignal<StackApplyResponse>()
  const [hash, setHash] = createSignal<string>()
  const [busy, setBusy] = createSignal<StackBusy>()
  const [error, setError] = createSignal<string>()
  const [conflict, setConflict] = createSignal(false)
  const [failure, setFailure] = createSignal<StackApplyError>()
  const [refresh, setRefresh] = createSignal<"loading" | "complete" | "failed">()
  const [issues, setIssues] = createSignal<StackValidationIssue[]>([])
  let revision = 0
  let request: AbortController | undefined

  const currentVertical = createMemo(() => catalog()?.catalog.verticals.find((item) => item.id === vertical()))
  const categories = createMemo(() => stackCategoryGroups(currentVertical()?.categories ?? []))
  const category = createMemo(() => categories()[index()])
  const resources = createMemo(() => {
    const item = catalog()
    return item ? stackResourceGroups(item, draft()) : []
  })
  const ready = () => {
    const item = catalog()
    return item ? stackCatalogReady(item) : false
  }
  const gaps = () => {
    const item = catalog()
    return item ? stackCatalogGapCount(item) : 0
  }

  function stop() {
    request?.abort()
    request = undefined
    setBusy(undefined)
  }

  function reset() {
    setPlan(undefined)
    setResult(undefined)
    setHash(undefined)
    setError(undefined)
    setConflict(false)
    setFailure(undefined)
    setRefresh(undefined)
    setIssues([])
  }

  function touch() {
    revision += 1
    if (busy() === "preview") stop()
    setPlan(undefined)
    setError(undefined)
    setConflict(false)
    setFailure(undefined)
    setRefresh(undefined)
    setIssues([])
  }

  function clear() {
    revision += 1
    stop()
    setCatalog(undefined)
    setSaved(undefined)
    setDraft(emptyStackDraft())
    setVertical("")
    setPhase("vertical")
    setIndex(0)
    setSearchValue("")
    reset()
  }

  function selectProject(input: Query | undefined) {
    const key = input ? stackProjectKey(input) : ""
    if (key === project()) return
    clear()
    setTarget(input)
    setProject(key)
  }

  function change(next: StackDraft) {
    touch()
    setDraft(next)
  }

  function hydrate(input: StackBundle, next: Query) {
    if (stackProjectKey(next) !== project()) return false
    revision += 1
    stop()
    setTarget(next)
    setCatalog(input.catalog)
    setSaved(input.state)
    setDraft(cloneStackDraft(input.state.draft))
    const configured = Object.keys(input.state.draft.verticals).find((id) =>
      input.catalog.catalog.verticals.some((item) => item.id === id),
    )
    setVertical(configured ?? input.catalog.catalog.verticals[0]?.id ?? "")
    setPhase("vertical")
    setIndex(0)
    setSearchValue("")
    reset()
    return true
  }

  function choose(id: string) {
    if (busy() === "apply" || !catalog()?.catalog.verticals.some((item) => item.id === id)) return
    touch()
    setVertical(id)
  }

  function start() {
    if (busy() === "apply" || !currentVertical()) return
    touch()
    setIndex(0)
    setSearchValue("")
    setPhase(categories().length ? "category" : "resources")
  }

  function nextCategory() {
    if (busy() === "apply") return
    touch()
    if (index() + 1 < categories().length) {
      setIndex(index() + 1)
      setSearchValue("")
      return
    }
    setPhase("resources")
  }

  function goCategory(next: number) {
    if (busy() === "apply" || next < 0 || next >= categories().length) return
    touch()
    setIndex(next)
    setSearchValue("")
    setPhase("category")
  }

  function goVertical() {
    if (busy() === "apply") return
    touch()
    setPhase("vertical")
  }

  function goResources() {
    if (busy() === "apply") return
    touch()
    setPhase("resources")
  }

  function back() {
    if (busy() === "apply") return
    touch()
    if (phase() === "category" && index() > 0) {
      setIndex(index() - 1)
      setSearchValue("")
      return
    }
    if (phase() === "category") {
      setPhase("vertical")
      return
    }
    if (phase() === "resources") {
      if (!categories().length) setPhase("vertical")
      else {
        setIndex(categories().length - 1)
        setSearchValue("")
        setPhase("category")
      }
      return
    }
    if (phase() === "review") setPhase("resources")
  }

  function setSearch(input: string) {
    if (busy() === "apply") return
    touch()
    setSearchValue(input)
  }

  function toggle(id: string) {
    const item = catalog()
    if (busy() === "apply" || !vertical() || !item) return
    const current = draft()
    const next = toggleStackTechnology(current, vertical(), id)
    change(stackTechnologySelected(current, vertical(), id) ? pruneStackResources(item, current, next) : next)
  }

  function enable(item: StackResourceItem, enabled: boolean) {
    if (busy() === "apply" || (item.availability !== "available" && enabled)) return
    change(setStackResource(draft(), item, enabled))
  }

  function method(item: StackResourceItem, id: string) {
    if (busy() === "apply" || item.availability !== "available") return
    change(setStackMethod(draft(), item, id))
  }

  function parameter(
    item: StackResourceItem,
    definition: StackParameter,
    value: StackParameterValue | undefined,
  ) {
    if (busy() === "apply" || item.availability !== "available") return
    change(setStackParameter(draft(), item, definition, value))
  }

  async function review() {
    const item = catalog()
    const destination = target()
    if (!item || !destination || busy() === "apply") return undefined
    const validation = validateStackDraft(item, draft())
    setIssues(validation)
    if (validation.length) {
      setError("Complete the required MCP settings before reviewing this plan.")
      return undefined
    }
    stop()
    const controller = new AbortController()
    request = controller
    const version = revision
    const key = project()
    const input = cloneStackDraft(draft())
    setBusy("preview")
    setError(undefined)
    setFailure(undefined)
    setRefresh(undefined)
    try {
      const next = await ops.preview(destination, input, controller.signal)
      if (controller.signal.aborted || version !== revision || key !== project()) return undefined
      setDraft(cloneStackDraft(next.draft))
      setPlan(next)
      setConflict(false)
      setPhase("review")
      return next
    } catch (err: unknown) {
      if (controller.signal.aborted || version !== revision || key !== project() || aborted(err)) return undefined
      setError(errMsg(err))
      return undefined
    } finally {
      if (request === controller) {
        request = undefined
        setBusy(undefined)
      }
    }
  }

  async function confirm() {
    const current = plan()
    const destination = target()
    if (
      !current ||
      !destination ||
      current.conflicts.length ||
      groupStackPlan(current.actions).blocked.length ||
      busy() ||
      conflict()
    )
      return undefined
    const controller = new AbortController()
    request = controller
    const version = revision
    const key = project()
    setBusy("apply")
    setError(undefined)
    setFailure(undefined)
    setRefresh(undefined)
    try {
      const next = await ops.apply(destination, cloneStackDraft(current.draft), current.plan_hash, controller.signal)
      if (controller.signal.aborted || version !== revision || key !== project()) return undefined
      setSaved(next.state)
      setDraft(cloneStackDraft(next.state.draft))
      setResult(next)
      setHash(current.plan_hash)
      setConflict(false)
      setPhase("result")
      return next
    } catch (err: unknown) {
      if (controller.signal.aborted || version !== revision || key !== project() || aborted(err)) return undefined
      const detail = stackApplyFailure(err)
      setConflict(stale(err))
      setFailure(detail)
      setError(errMsg(err))
      if (!detail) return undefined
      setRefresh("loading")
      setPlan(undefined)
      setHash(undefined)
      setPhase("resources")
      await ops.reload(destination, controller.signal).then(
        (next) => {
          if (controller.signal.aborted || version !== revision || key !== project()) return
          setSaved(next)
          setDraft(cloneStackDraft(next.draft))
          const item = catalog()
          const configured = Object.keys(next.draft.verticals).find((id) =>
            item?.catalog.verticals.some((vertical) => vertical.id === id),
          )
          if (configured) setVertical(configured)
          setRefresh("complete")
        },
        (cause: unknown) => {
          if (controller.signal.aborted || version !== revision || key !== project() || aborted(cause)) return
          setRefresh("failed")
          setError(`State refresh failed: ${errMsg(cause)}`)
        },
      )
      return undefined
    } finally {
      if (request === controller) {
        request = undefined
        setBusy(undefined)
      }
    }
  }

  function cancel() {
    if (busy() === "apply") return
    touch()
    const item = saved()
    if (item) setDraft(cloneStackDraft(item.draft))
    setPhase("vertical")
    setIndex(0)
    setSearchValue("")
    reset()
  }

  return {
    catalog,
    saved,
    draft,
    project,
    vertical,
    currentVertical,
    phase,
    index,
    categories,
    category,
    search,
    setSearch,
    plan,
    result,
    hash,
    busy,
    error,
    conflict,
    failure,
    refresh,
    issues,
    resources,
    ready,
    gaps,
    selectProject,
    hydrate,
    choose,
    start,
    nextCategory,
    goCategory,
    goVertical,
    goResources,
    back,
    toggle,
    enable,
    method,
    parameter,
    review,
    confirm,
    cancel,
  }
}

export type StackWizard = ReturnType<typeof createStackWizard>
