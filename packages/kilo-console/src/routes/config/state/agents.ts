import { createEffect, createMemo, createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { AgentBuilderPreviewResponse, Model, Provider } from "@kilocode/sdk/v2/client"
import {
  previewAgent,
  saveAgent,
  saveAgentVariant,
  type AgentPayload,
  type Scope,
  type Snapshot,
} from "../../../client"
import { useConfig } from "../../../context/config"
import { clean, friendly, sorted, toMode, toolCapabilities, toolName } from "../../../shared/utils"
import {
  variantChoices,
  variantDirty,
  variantEdit as canVariantEdit,
  variantModel as pickVariantModel,
  variantParent,
  variantPersist,
  variantShown,
  variantState,
  variantValue,
} from "./agent-variant"
import {
  defaults,
  defs,
  ruleDefs,
  type PermissionAction,
  type PermissionDef,
  type PermissionTool,
  type RuleDef,
} from "./permissions"

type Mode = AgentPayload["mode"]
type Permission = NonNullable<AgentPayload["permission"]>
type Draft = AgentBuilderPreviewResponse
type Panel = "closed" | "model" | "tools" | "permission" | "markdown"
type Favorite = Snapshot["modelState"]["favorite"][number]
type Item = { id: string; provider: Provider; model: Model }
type AgentPermissionRule = {
  tool: string
  pattern: string
  action: PermissionAction
}
type AgentPermissionGroup = RuleDef & {
  action: PermissionAction
  rules: AgentPermissionRule[]
}
type AgentPermissionDefault = PermissionDef & {
  action: PermissionAction
}
export type AgentItem = Snapshot["agents"][number]
export type AgentEntry = Snapshot["overlay"]["collections"][string][number]

export const snippets = [
  "Review the current diff and report risks, regressions, and missing tests.",
  "Plan the work in small steps, then implement the smallest correct change.",
  "Inspect relevant files first, then summarize the root cause before editing.",
  "Run the smallest relevant validation checks and report any remaining failures.",
]

function order(a: Provider, b: Provider) {
  if (a.id === "kilo") return -1
  if (b.id === "kilo") return 1
  return a.name.localeCompare(b.name)
}

function same(item: Item, ref: Favorite) {
  if (item.provider.id === ref.providerID && item.model.id === ref.modelID) return true
  return item.model.providerID === ref.providerID && item.model.id === ref.modelID
}

function maybe(input: string) {
  const value = clean(input)
  if (value) return value
  return undefined
}

function count(input: string) {
  const value = Number(input)
  if (Number.isInteger(value) && value > 0) return value
  return undefined
}

function record(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  return {}
}

function string(input: unknown) {
  if (typeof input === "string") return input
  return ""
}

function number(input: unknown) {
  if (typeof input === "number" && Number.isFinite(input)) return input
  return undefined
}

function act(input: unknown, fallback: PermissionAction = "ask"): PermissionAction {
  if (input === "allow" || input === "deny" || input === "ask") return input
  return fallback
}

function rule(tool: string, pattern: string, input: unknown): AgentPermissionRule | undefined {
  if (input !== "allow" && input !== "deny" && input !== "ask") return undefined
  return { tool, pattern, action: input }
}

function rows(tool: string, value: unknown) {
  const obj = record(value)
  if (Object.keys(obj).length)
    return Object.entries(obj).flatMap(([pattern, input]) => rule(tool, pattern, input) ?? [])
  const item = rule(tool, "*", value)
  return item ? [item] : []
}

const ruleIDs = new Set<string>(ruleDefs.map((item) => item.id))
const knownPermissions = new Set<string>(defs.map((item) => item.id))

function source(item: AgentItem) {
  const value = item.source ?? item.options.source
  if (typeof value === "string") return value
  return undefined
}

function split(input: unknown) {
  const entries = Object.entries(perms(input))
  return {
    tools: sorted(entries.filter(([, value]) => value === "allow").map(([key]) => key)),
    permission: Object.fromEntries(entries.filter(([, value]) => value !== "allow")) as Permission,
  }
}

function perms(input: unknown): Permission {
  if (!Array.isArray(input)) return record(input) as Permission
  return input.reduce((result, item) => {
    const rule = record(item)
    const tool = string(rule.permission)
    const action = string(rule.action)
    if (!tool || !action) return result
    const pattern = string(rule.pattern) || "*"
    if (pattern === "*") return { ...result, [tool]: action }
    const cur = result[tool]
    const map = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}
    return { ...result, [tool]: { ...map, [pattern]: action } }
  }, {} as Permission)
}

export function agentMeta(data: Snapshot, id: string) {
  return (data.overlay.collections.agent ?? []).find((entry) => entry.key === id)
}

export function agentTitle(item: AgentItem) {
  return item.displayName ?? friendly(item.name)
}

export function agentModel(item: AgentItem) {
  if (!item.model) return ""
  return `${item.model.providerID}/${item.model.modelID}`
}

export function agentEditable(item: AgentItem, entry?: AgentEntry) {
  if (item.native) return false
  if (entry?.inherited) return false
  if (entry?.editable === false) return false
  if (source(item) === "organization") return false
  return true
}

export {
  variantChoices,
  variantCurrent,
  variantDirty,
  variantEdit,
  variantModel,
  variantParent,
  variantPersist,
  variantShown,
  variantState,
  variantValue,
} from "./agent-variant"

export function useAgentBuilder(agent?: Accessor<string | undefined>) {
  const ctx = useConfig()
  const snap = () => ctx.data()
  const scope = createMemo<Scope>(() => ctx.query()?.scope ?? "project")
  const [loaded, setLoaded] = createSignal<string>()
  const [ready, setReady] = createSignal(true)
  const [locked, setLocked] = createSignal(false)
  const [id, setId] = createSignal("reviewer")
  const [desc, setDesc] = createSignal("")
  const [mode, setMode] = createSignal<Mode>("subagent")
  const [model, setModel] = createSignal("")
  const [variant, setVariant] = createSignal("")
  const [saved, setSaved] = createSignal("")
  const [base, setBase] = createSignal("")
  const [stored, setStored] = createSignal("")
  const [cleared, setCleared] = createSignal(false)
  const [variantEdit, setVariantEdit] = createSignal(false)
  const [color, setColor] = createSignal("")
  const [steps, setSteps] = createSignal("")
  const [tools, setTools] = createSignal<string[]>([])
  const [prompt, setPrompt] = createSignal("")
  const [permTool, setPermTool] = createSignal<PermissionTool>("external_directory")
  const [permPattern, setPermPattern] = createSignal("")
  const [permAction, setPermAction] = createSignal<PermissionAction>("ask")
  const [permission, setPermission] = createSignal<Permission>({})
  const [draft, setDraft] = createSignal<Draft>()
  const [panel, setPanel] = createSignal<Panel>("closed")
  const [picker, setPicker] = createSignal("")
  const [choice, setChoice] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [chosen, setChosen] = createSignal<string[]>([])

  const providers = createMemo(() => {
    const data = snap()
    if (!data) return []
    const ids = new Set([...Object.keys(data.effective.provider ?? {}), ...data.providers.connected])
    return data.providers.all
      .filter((provider) => ids.has(provider.id))
      .filter((provider) => Object.keys(provider.models).length > 0)
      .sort(order)
  })

  const all = createMemo(() => {
    return providers().flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        id: `${provider.id}/${model.id}`,
        provider,
        model,
      })),
    )
  })

  const favorites = createMemo(() => snap()?.modelState.favorite ?? [])
  const fav = (item: Item) => favorites().some((ref) => same(item, ref))
  const models = createMemo(() => {
    const term = picker().trim().toLowerCase()
    return all()
      .filter((item) => {
        if (!term) return true
        return `${item.id} ${item.model.name} ${item.provider.name}`.toLowerCase().includes(term)
      })
      .sort((a, b) => {
        const ranked = Number(fav(b)) - Number(fav(a))
        if (ranked !== 0) return ranked
        const named = a.model.name.localeCompare(b.model.name)
        if (named !== 0) return named
        const provider = a.provider.name.localeCompare(b.provider.name)
        if (provider !== 0) return provider
        return a.id.localeCompare(b.id)
      })
  })
  const item = (value: unknown) => {
    if (typeof value !== "string") return undefined
    return all().find((model) => model.id === value || `${model.model.providerID}/${model.model.id}` === value)
  }
  const selected = createMemo(() => item(model()))
  const fallback = createMemo(() => item(pickVariantModel({ draft: model(), agent: saved(), workspace: snap()?.effective.model })))
  const variantModel = createMemo(() => selected() ?? fallback())
  const variants = createMemo(() => Object.keys(variantModel()?.model.variants ?? {}))
  const variantOptions = createMemo(() => variantChoices(variants()))
  const currentVariant = createMemo(() =>
    variantShown({ cleared: cleared(), current: variant(), saved: base(), variants: variants() }),
  )
  const persisted = createMemo(() =>
    variantPersist({ cleared: cleared(), current: variant(), saved: base(), variants: variants() }),
  )

  const options = createMemo(() => {
    const data = snap()
    if (!data) return []
    const term = search().trim().toLowerCase()
    const details = new Map(data.toolDetails.map((item) => [item.id, item]))
    return data.tools
      .map((id) => ({ id, detail: details.get(id) }))
      .filter((tool) => {
        if (!term) return true
        return `${tool.id} ${toolName(tool.id)} ${toolCapabilities(tool).join(" ")}`.toLowerCase().includes(term)
      })
      .sort((a, b) => toolName(a.id).localeCompare(toolName(b.id)))
  })

  const pickedDraft = createMemo(() => new Set(chosen()))
  const rules = createMemo(() => Object.entries(permission()).flatMap(([tool, value]) => rows(tool, value)))
  const permissionGroups = createMemo<AgentPermissionGroup[]>(() =>
    ruleDefs.map((def) => {
      const value = permission()[def.id]
      const obj = record(value)
      return {
        ...def,
        action: act(typeof value === "string" ? value : obj["*"]),
        rules: Object.entries(obj)
          .filter(([pattern]) => pattern !== "*")
          .flatMap(([pattern, input]) => rule(def.id, pattern, input) ?? []),
      }
    }),
  )
  const permissionDefaults = createMemo<AgentPermissionDefault[]>(() =>
    defaults.map((def) => {
      const value = permission()[def.id]
      const obj = record(value)
      return {
        ...def,
        action: act(typeof value === "string" ? value : obj["*"]),
      }
    }),
  )
  const permissionOther = createMemo(() =>
    Object.entries(permission())
      .filter(([tool]) => !knownPermissions.has(tool))
      .flatMap(([tool, value]) => rows(tool, value))
      .sort((a, b) => a.tool.localeCompare(b.tool) || a.pattern.localeCompare(b.pattern)),
  )
  const selectedPermission = createMemo(() => ruleDefs.find((def) => def.id === permTool()) ?? ruleDefs[0])

  function reset(value = "reviewer") {
    setId(value)
    setDesc("")
    setMode("subagent")
    setModel("")
    setVariant("")
    setSaved("")
    setBase("")
    setStored("")
    setCleared(false)
    setVariantEdit(false)
    setColor("")
    setSteps("")
    setTools([])
    setPrompt("")
    setPermission({})
    setDraft(undefined)
    setLocked(false)
    setPanel("closed")
    setPermTool("external_directory")
    setPermPattern("")
    setPermAction("ask")
    setPicker("")
    setChoice("")
    setSearch("")
    setChosen([])
  }

  createEffect(() => {
    const value = agent?.()
    if (value) return
    if (loaded() === "") return
    reset()
    setReady(true)
    setLoaded("")
  })

  createEffect(() => {
    const data = snap()
    const key = agent?.()
    if (!data || !key) return
    if (loaded() === key) return

    reset(key)
    setReady(false)
    setLoaded(key)

    const item = data.agents.find((item) => item.name === key)
    if (!item) {
      ctx.fail(`Agent not found: ${key}`)
      return
    }

    const entry = agentMeta(data, key)
    const edit = agentEditable(item, entry)
    const allow = canVariantEdit({
      scope: scope(),
      inherited: entry?.inherited,
      editable: entry?.editable,
      native: item.native,
      source: source(item),
    })

    ctx.fail("")
    setReady(true)
    setLocked(!edit)
    setVariantEdit(allow)
    const cfg = record(entry?.value)
    const global = record(entry?.global)
    const state = variantState({
      scope: scope(),
      global: global.variant,
      local: entry?.local && record(entry.local).variant,
      effective: item.variant,
    })
    const parts = split(cfg.permission ?? (edit ? undefined : item.permission))
    const step = number(cfg.steps) ?? item.steps

    setId(item.name)
    setDesc(string(cfg.description) || item.description || "")
    setMode(toMode(string(cfg.mode) || item.mode))
    setModel(string(cfg.model) || agentModel(item))
    setSaved(variantParent({ scope: scope(), global: global.model }))
    setStored(state.stored)
    setBase(state.shown)
    setVariant(state.shown)
    setCleared(false)
    setColor(string(cfg.color) || item.color || "")
    setSteps(step ? String(step) : "")
    setTools(parts.tools)
    setPermission(parts.permission)
    setPrompt(string(cfg.prompt) || item.prompt || "")
  })

  function close() {
    setPanel("closed")
  }

  function guard() {
    if (!locked()) return true
    ctx.fail("Inspected agents are read-only.")
    return false
  }

  function openMarkdown() {
    const payload = build()
    if (!payload) return
    setDraft(undefined)
    setPanel("markdown")
    ctx.run("Previewing agent", () => previewAgent(ctx.target(), payload).then(setDraft), { refetch: false })
  }

  function openModel() {
    if (!guard()) return
    setPicker("")
    setChoice(model())
    setPanel("model")
  }

  function selectModel(item: Item) {
    setChoice(item.id)
  }

  function saveModel() {
    if (!guard()) return
    const id = choice()
    if (!id) {
      ctx.fail("Select a model before saving the agent model field.")
      return
    }
    setModel(id)
    close()
  }

  function clearModel() {
    if (!guard()) return
    setModel("")
  }

  function pickVariant(value: string) {
    setVariant(value)
    setCleared(value === "")
  }

  function openTools() {
    if (!guard()) return
    setSearch("")
    setChosen(tools())
    setPanel("tools")
  }

  function toggleTool(id: string) {
    if (!guard()) return
    const values = new Set(chosen())
    if (values.has(id)) values.delete(id)
    else values.add(id)
    setChosen(sorted(values))
  }

  function saveTools() {
    if (!guard()) return
    setTools(chosen())
    close()
  }

  function clearTools() {
    if (!guard()) return
    setTools([])
  }

  function openPermission(tool: PermissionTool) {
    if (!guard()) return
    setPermTool(tool)
    setPermPattern("")
    setPermAction("ask")
    setPanel("permission")
  }

  function setPermissionDefault(tool: string, action: PermissionAction) {
    if (!guard()) return
    const next = { ...permission() }
    if (!ruleIDs.has(tool)) {
      next[tool] = action
      setPermission(next)
      return
    }
    const map = record(next[tool])
    next[tool] = { ...map, "*": action }
    setPermission(next)
  }

  function addPermission() {
    if (!guard()) return
    const pattern = clean(permPattern())
    if (!pattern) {
      ctx.fail(`Enter a ${selectedPermission().noun} pattern before saving.`)
      return
    }
    const tool = permTool()
    const next = { ...permission() }
    const cur = next[tool]
    const map: Record<string, unknown> = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur } : {}
    map[pattern] = permAction()
    next[tool] = map
    setPermission(next)
    close()
  }

  function removePermission(item: AgentPermissionRule) {
    if (!guard()) return
    const next = { ...permission() }
    if (item.pattern === "*") {
      const map = { ...record(next[item.tool]) }
      if (Object.keys(map).length) {
        delete map["*"]
        if (Object.keys(map).length) next[item.tool] = map
        else delete next[item.tool]
        setPermission(next)
        return
      }
      delete next[item.tool]
      setPermission(next)
      return
    }
    const map = { ...record(next[item.tool]) }
    delete map[item.pattern]
    if (Object.keys(map).length) next[item.tool] = map
    else delete next[item.tool]
    setPermission(next)
  }

  function insert(value: string) {
    if (!guard()) return
    const cur = clean(prompt())
    setPrompt(cur ? `${cur}\n\n${value}` : value)
  }

  function build(): AgentPayload | undefined {
    if (!ready()) {
      ctx.fail("Select an agent before previewing or saving.")
      return undefined
    }

    const name = clean(id())
    const body = clean(prompt())
    if (!name || !body) {
      ctx.fail("Enter an agent id and prompt before previewing or saving.")
      return undefined
    }
    const rules = permission()
    return {
      scope: scope(),
      id: name,
      description: maybe(desc()),
      mode: mode(),
      model: maybe(model()),
      color: maybe(color()),
      steps: count(steps()),
      tools: tools().length ? tools() : undefined,
      permission: Object.keys(rules).length ? rules : undefined,
      prompt: body,
    }
  }

  function save() {
    if (locked()) {
      if (!variantEdit()) {
        ctx.fail("Inspected agents are read-only.")
        return
      }
      const prev = agent?.()
      if (!prev) return
      ctx.run("Saving agent variant", async () => {
        const next = persisted()
        if (variantDirty({ next, saved: base() })) {
          await saveAgentVariant(ctx.target(), prev, next)
        }
      })
      return
    }
    const payload = build()
    if (!payload) return
    ctx.run("Saving agent", async () => {
      const prev = agent?.()
      const moved = prev && prev !== payload.id
      const output = await saveAgent(ctx.target(), payload)
      const next = persisted()
      if (variantDirty({ next, saved: base() }) || Boolean(moved && stored())) {
        await saveAgentVariant(ctx.target(), payload.id, next)
      }
      if (moved && stored()) await saveAgentVariant(ctx.target(), prev, "")
      setDraft(output)
    })
  }

  return {
    ctx,
    snap,
    scope,
    id,
    setId,
    desc,
    setDesc,
    mode,
    setMode,
    model,
    setModel,
    variant,
    setVariant: pickVariant,
    currentVariant,
    variantOptions,
    variantModel,
    variantEdit,
    color,
    setColor,
    steps,
    setSteps,
    tools,
    prompt,
    setPrompt,
    permTool,
    setPermTool,
    permPattern,
    setPermPattern,
    permAction,
    setPermAction,
    permissionGroups,
    permissionDefaults,
    permissionOther,
    selectedPermission,
    draft,
    ready,
    locked,
    panel,
    close,
    openMarkdown,
    picker,
    setPicker,
    choice,
    models,
    selected,
    fav,
    openModel,
    selectModel,
    saveModel,
    clearModel,
    search,
    setSearch,
    options,
    pickedDraft,
    openTools,
    rules,
    openPermission,
    setPermissionDefault,
    removePermission,
    toggleTool,
    saveTools,
    clearTools,
    addPermission,
    insert,
    save,
  }
}
