import { createMemo, createResource, createSignal } from "solid-js"
import type { McpLocalConfig, McpRemoteConfig, McpStatus } from "@kilocode/sdk/v2/client"
import { parse as parseYaml } from "yaml"
import type { Snapshot } from "../../../client"
import { authenticateMcp, connectMcp, disconnectMcp } from "../../../client"
import { useConfig } from "../../../context/config"
import { clean, errMsg, text, words, type McpMap } from "../../../shared/utils"

const market = "https://api.kilo.ai/api/marketplace/mcps"
const pattern = /^[\w\-@.]+$/

type Resolved = Snapshot["overlay"]["collections"][string][number]
type Dict = Record<string, unknown>
type Config = McpLocalConfig | McpRemoteConfig | { enabled: boolean }
type Mode = "closed" | "market" | "install" | "config"
type Filter = "all" | "installed" | "notInstalled"

export type McpParameter = {
  name: string
  key: string
  placeholder?: string
  optional?: boolean
}

export type McpMethod = {
  name: string
  content: string
  parameters?: McpParameter[]
  prerequisites?: string[]
}

export type McpMarket = {
  type: "mcp"
  id: string
  name: string
  description: string
  author?: string
  authorUrl?: string
  tags?: string[]
  prerequisites?: string[]
  url?: string
  content: string | McpMethod[]
  parameters?: McpParameter[]
}

export type McpRow = {
  id: string
  name: string
  summary: string
  kind: string
  enabled: boolean
  config?: Config
  status?: McpStatus
  source: string
  inherited?: boolean
  overridden?: boolean
  editable?: boolean
  revert?: boolean
  path?: string[]
  market?: McpMarket
}

function record(input: unknown): Dict {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Dict
  return {}
}

function str(input: unknown) {
  return typeof input === "string" ? input : ""
}

function strs(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is string => typeof item === "string")
}

function json(input: unknown) {
  if (input === undefined || input === null) return ""
  return JSON.stringify(input, null, 2)
}

function strings(input: unknown) {
  const data = record(input)
  const rows = Object.entries(data).flatMap(([key, value]) =>
    typeof value === "string" ? [[key, value] as const] : [],
  )
  if (!rows.length) return undefined
  return Object.fromEntries(rows) as Record<string, string>
}

function object(input: string, label: string, fail: (message: string) => void) {
  const raw = clean(input)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${label} must be a JSON object.`)
      return undefined
    }
    for (const [key, value] of Object.entries(parsed as Dict)) {
      if (typeof value === "string") continue
      fail(`${label}.${key} must be a string.`)
      return undefined
    }
    return parsed as Record<string, string>
  } catch (err) {
    fail(`${label}: ${errMsg(err)}`)
    return undefined
  }
}

function oauth(input: string, fail: (message: string) => void) {
  const raw = clean(input)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed === false) return false
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("OAuth must be a JSON object or false.")
      return undefined
    }
    for (const [key, value] of Object.entries(parsed as Dict)) {
      if (typeof value === "string") continue
      fail(`OAuth.${key} must be a string.`)
      return undefined
    }
    return parsed as NonNullable<McpRemoteConfig["oauth"]>
  } catch (err) {
    fail(`OAuth: ${errMsg(err)}`)
    return undefined
  }
}

function timeout(input: string, fail: (message: string) => void) {
  const raw = clean(input)
  if (!raw) return undefined
  const value = Number(raw)
  if (Number.isFinite(value) && value > 0) return value
  fail("Timeout must be a positive number of milliseconds.")
  return undefined
}

function method(input: unknown) {
  const data = record(input)
  const name = str(data.name)
  const content = str(data.content)
  if (!name || !content) return undefined
  const params = paramsList(data.parameters)
  const prereq = strs(data.prerequisites)
  return {
    name,
    content,
    ...(params.length ? { parameters: params } : {}),
    ...(prereq.length ? { prerequisites: prereq } : {}),
  }
}

function param(input: unknown) {
  const data = record(input)
  const key = str(data.key)
  const name = str(data.name) || key
  if (!key || !name) return undefined
  const placeholder = str(data.placeholder)
  return {
    name,
    key,
    ...(placeholder ? { placeholder } : {}),
    ...(data.optional === true ? { optional: true } : {}),
  }
}

function paramsList(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const next = param(item)
    return next ? [next] : []
  })
}

function methodsList(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const next = method(item)
    return next ? [next] : []
  })
}

function item(input: unknown) {
  const data = record(input)
  const id = str(data.id)
  const name = str(data.name) || id
  const description = str(data.description)
  const methods = methodsList(data.content)
  const content = typeof data.content === "string" ? data.content : methods
  if (!id || !name || !description) return []
  if (Array.isArray(content) && !content.length) return []
  const tags = strs(data.tags)
  const params = paramsList(data.parameters)
  const prereq = strs(data.prerequisites)
  const author = str(data.author)
  const authorUrl = str(data.authorUrl)
  const url = str(data.url)
  return [
    {
      type: "mcp" as const,
      id,
      name,
      description,
      content,
      ...(author ? { author } : {}),
      ...(authorUrl ? { authorUrl } : {}),
      ...(url ? { url } : {}),
      ...(tags.length ? { tags } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(prereq.length ? { prerequisites: prereq } : {}),
    },
  ]
}

async function fetchMarket() {
  const response = await fetch(market)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  const body = await response.text()
  const parsed = (() => {
    try {
      return JSON.parse(body) as { items?: unknown[] }
    } catch {
      return parseYaml(body) as { items?: unknown[] }
    }
  })()
  const items = Array.isArray(parsed.items) ? parsed.items : []
  return items.flatMap(item).sort((a, b) => a.name.localeCompare(b.name))
}

function escape(input: string) {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

function substitute(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((result, [key, value]) => {
    const escaped = escape(String(value ?? ""))
    return result.replaceAll(`{{${key}}}`, escaped).replaceAll(`\${${key}}`, escaped)
  }, template)
}

function normalized(input: Dict): Config {
  if (input.type === "local" && Array.isArray(input.command)) {
    const command = strs(input.command)
    const cfg: McpLocalConfig = { type: "local", command }
    const env = strings(input.environment ?? input.env)
    if (env) cfg.environment = env
    if (input.enabled === false) cfg.enabled = false
    if (typeof input.timeout === "number") cfg.timeout = input.timeout
    return cfg
  }
  if (input.type === "remote" && typeof input.url === "string") {
    const cfg: McpRemoteConfig = { type: "remote", url: input.url }
    const headers = strings(input.headers)
    const auth = input.oauth === false || record(input.oauth) === input.oauth ? input.oauth : undefined
    if (headers) cfg.headers = headers
    if (auth === false || (auth && typeof auth === "object")) cfg.oauth = auth as McpRemoteConfig["oauth"]
    if (input.enabled === false) cfg.enabled = false
    if (typeof input.timeout === "number") cfg.timeout = input.timeout
    return cfg
  }
  if (typeof input.url === "string") {
    const cfg: McpRemoteConfig = { type: "remote", url: input.url }
    const headers = strings(input.headers)
    const auth = input.oauth === false || record(input.oauth) === input.oauth ? input.oauth : undefined
    if (headers) cfg.headers = headers
    if (auth === false || (auth && typeof auth === "object")) cfg.oauth = auth as McpRemoteConfig["oauth"]
    if (input.enabled === false) cfg.enabled = false
    if (typeof input.timeout === "number") cfg.timeout = input.timeout
    return cfg
  }
  if (typeof input.command === "string") {
    const cfg: McpLocalConfig = { type: "local", command: [input.command, ...strs(input.args)] }
    const env = strings(input.env)
    if (env) cfg.environment = env
    if (input.enabled === false) cfg.enabled = false
    if (typeof input.timeout === "number") cfg.timeout = input.timeout
    return cfg
  }
  return input as Config
}

function build(content: string, values: Record<string, string>, fail: (message: string) => void) {
  try {
    const parsed = JSON.parse(substitute(content, values))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("Marketplace MCP content must resolve to a JSON object.")
      return undefined
    }
    return normalized(parsed as Dict)
  } catch (err) {
    fail(`Invalid MCP marketplace config: ${errMsg(err)}`)
    return undefined
  }
}

function describe(input: unknown) {
  const cfg = record(input)
  if (cfg.type === "remote" && typeof cfg.url === "string") return cfg.url
  if (Array.isArray(cfg.command)) return strs(cfg.command).join(" ")
  if (cfg.enabled === false) return "Disabled override"
  return text(input)
}

function kind(input: unknown) {
  const cfg = record(input)
  if (cfg.type === "remote" || typeof cfg.url === "string") return "remote"
  if (cfg.type === "local" || Array.isArray(cfg.command) || typeof cfg.command === "string") return "local"
  return "override"
}

function current(input: Config | undefined) {
  const cfg = record(input)
  return cfg.enabled !== false
}

function config(input: Resolved | undefined, value: Config | undefined) {
  return (input?.local ?? value ?? input?.value) as Config | undefined
}

function source(input: Resolved | undefined) {
  return input?.source ?? "system"
}

function values(input: Record<string, string>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => clean(value) !== ""))
}

export function useMcpSettings() {
  const ctx = useConfig()
  const snap = () => ctx.data()
  const [mode, setMode] = createSignal<Mode>("closed")
  const [search, setSearch] = createSignal("")
  const [filter, setFilter] = createSignal("")
  const [status, setStatus] = createSignal<Filter>("all")
  const [picked, setPicked] = createSignal<string[]>([])
  const [choice, setChoice] = createSignal<McpMarket | undefined>()
  const [methodName, setMethodName] = createSignal("")
  const [params, setParams] = createSignal<Record<string, string>>({})
  const [editing, setEditing] = createSignal<string | undefined>()
  const [pending, setPending] = createSignal<McpRow | undefined>()
  const [id, setId] = createSignal("")
  const [type, setType] = createSignal<"local" | "remote">("local")
  const [command, setCommand] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [env, setEnv] = createSignal("")
  const [headers, setHeaders] = createSignal("")
  const [auth, setAuth] = createSignal("")
  const [limit, setLimit] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)
  const [catalog, catalogActions] = createResource(fetchMarket)

  const rows = createMemo<McpRow[]>(() => {
    const data = snap()
    if (!data) return []
    const meta = new Map(data.overlay.collections.mcp.map((entry) => [entry.key, entry]))
    const market = new Map((catalog() ?? []).map((entry) => [entry.id, entry]))
    const configs = data.effective.mcp ?? {}
    const names = new Set([...Object.keys(configs), ...Object.keys(data.mcp), ...meta.keys()])
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const hit = meta.get(name)
        const cfg = config(hit, configs[name])
        const item = market.get(name)
        return {
          id: name,
          name: item?.name ?? name,
          summary: describe(cfg),
          kind: kind(cfg),
          enabled: current(cfg),
          config: cfg,
          status: data.mcp[name],
          source: source(hit),
          inherited: hit?.inherited,
          overridden: hit?.overridden,
          editable: hit?.editable,
          revert: data.overlay.scope === "project" && hit?.local !== undefined && hit.global !== undefined,
          path: hit?.path,
          market: item,
        }
      })
  })

  const visible = createMemo(() => {
    const term = search().trim().toLowerCase()
    if (!term) return rows()
    return rows().filter((row) =>
      `${row.name} ${row.id} ${row.summary} ${row.status?.status ?? ""}`.toLowerCase().includes(term),
    )
  })

  const installed = createMemo(() => new Set(rows().map((row) => row.id)))
  const tags = createMemo(() => {
    const counts = new Map<string, number>()
    for (const item of catalog() ?? []) {
      for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.keys()].sort((a, b) => a.localeCompare(b))
  })
  const marketError = createMemo(() => (catalog.error ? errMsg(catalog.error) : ""))
  const marketVisible = createMemo(() => {
    const term = filter().trim().toLowerCase()
    const selected = picked()
    const mode = status()
    return (catalog() ?? []).filter((item) => {
      const exists = installed().has(item.id)
      if (mode === "installed" && !exists) return false
      if (mode === "notInstalled" && exists) return false
      if (selected.length && !selected.some((tag) => item.tags?.includes(tag))) return false
      if (!term) return true
      return `${item.name} ${item.id} ${item.description} ${item.author ?? ""}`.toLowerCase().includes(term)
    })
  })

  const methods = createMemo(() => {
    const item = choice()
    if (!item || typeof item.content === "string") return []
    return item.content
  })
  const method = createMemo(() => methods().find((item) => item.name === methodName()) ?? methods()[0])
  const parameters = createMemo(() => method()?.parameters ?? choice()?.parameters ?? [])
  const prerequisites = createMemo(() => method()?.prerequisites ?? choice()?.prerequisites ?? [])
  const valid = createMemo(() => parameters().every((item) => item.optional || clean(params()[item.key] ?? "")))

  function close() {
    setMode("closed")
  }

  function openMarket() {
    setMode("market")
  }

  function openManual() {
    setEditing(undefined)
    setId("")
    setType("local")
    setCommand("")
    setUrl("")
    setEnv("")
    setHeaders("")
    setAuth("")
    setLimit("")
    setEnabled(true)
    setMode("config")
  }

  function openInstall(item: McpMarket) {
    setChoice(item)
    const list = Array.isArray(item.content) ? item.content : []
    setMethodName(list[0]?.name ?? "")
    setParams({})
    setMode("install")
  }

  function edit(row: McpRow) {
    const cfg = record(row.config)
    setEditing(row.id)
    setId(row.id)
    setType(kind(row.config) === "remote" ? "remote" : "local")
    setCommand(Array.isArray(cfg.command) ? strs(cfg.command).join(" ") : "")
    setUrl(str(cfg.url))
    setEnv(json(cfg.environment ?? cfg.env))
    setHeaders(json(cfg.headers))
    setAuth(json(cfg.oauth))
    setLimit(typeof cfg.timeout === "number" ? String(cfg.timeout) : "")
    setEnabled(cfg.enabled !== false)
    setMode("config")
  }

  function setParam(key: string, value: string) {
    setParams({ ...params(), [key]: value })
  }

  function toggleTag(tag: string) {
    const current = picked()
    setPicked(current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])
  }

  function install() {
    const item = choice()
    if (!item) return
    if (installed().has(item.id)) {
      ctx.fail("MCP server is already installed. Remove it before installing again.")
      return
    }
    if (!valid()) {
      ctx.fail("Fill all required MCP installation parameters before installing.")
      return
    }
    const content = typeof item.content === "string" ? item.content : method()?.content
    if (!content) {
      ctx.fail("Marketplace item does not include MCP installation content.")
      return
    }
    const cfg = build(content, values(params()), ctx.fail)
    if (!cfg) return
    ctx.save({ mcp: { [item.id]: cfg } as McpMap })
    close()
  }

  function save() {
    const key = clean(id())
    if (!key || !pattern.test(key) || key.includes("..") || key.includes("/") || key.includes("\\")) {
      ctx.fail("MCP server ID must contain only letters, numbers, underscores, dashes, dots, or @.")
      return
    }
    if (!editing() && installed().has(key)) {
      ctx.fail("MCP server ID is already configured.")
      return
    }
    const ms = timeout(limit(), ctx.fail)
    if (clean(limit()) && ms === undefined) return
    const cfg = (() => {
      if (type() === "remote") {
        const endpoint = clean(url())
        if (!endpoint) {
          ctx.fail("Enter the remote MCP server URL before saving.")
          return undefined
        }
        const head = object(headers(), "Headers", ctx.fail)
        const oauthCfg = oauth(auth(), ctx.fail)
        if (!head || (clean(auth()) && oauthCfg === undefined)) return undefined
        const next: Dict = {
          type: "remote",
          url: endpoint,
          enabled: enabled(),
          command: null,
          environment: null,
          env: null,
        }
        next.headers = Object.keys(head).length ? head : null
        next.oauth = oauthCfg !== undefined ? oauthCfg : null
        next.timeout = ms !== undefined ? ms : null
        return next as McpRemoteConfig
      }
      const cmd = words(command())
      if (!cmd.length) {
        ctx.fail("Enter the local MCP command before saving.")
        return undefined
      }
      const vars = object(env(), "Environment", ctx.fail)
      if (!vars) return undefined
      const next: Dict = {
        type: "local",
        command: cmd,
        enabled: enabled(),
        url: null,
        headers: null,
        oauth: null,
        env: null,
      }
      next.environment = Object.keys(vars).length ? vars : null
      next.timeout = ms !== undefined ? ms : null
      return next as McpLocalConfig
    })()
    if (!cfg) return
    ctx.save({ mcp: { [key]: cfg } as McpMap })
    close()
  }

  function toggle(row: McpRow) {
    const cfg = record(row.config)
    const next = { ...cfg, enabled: !row.enabled } as Config
    ctx.save({ mcp: { [row.id]: next } as McpMap })
  }

  function connect(row: McpRow) {
    ctx.run("Connecting MCP server", () => connectMcp(ctx.target(), row.id))
  }

  function disconnect(row: McpRow) {
    ctx.run("Disconnecting MCP server", () => disconnectMcp(ctx.target(), row.id))
  }

  function authenticate(row: McpRow) {
    ctx.run("Authenticating MCP server", () => authenticateMcp(ctx.target(), row.id))
  }

  function ask(row: McpRow) {
    setPending(row)
  }

  function cancel() {
    setPending(undefined)
  }

  function confirm() {
    const row = pending()
    if (!row?.path) return
    ctx.unset([row.path])
    setPending(undefined)
  }

  return {
    ctx,
    snap,
    mode,
    search,
    setSearch,
    filter,
    setFilter,
    status,
    setStatus,
    picked,
    catalog,
    catalogActions,
    rows,
    visible,
    installed,
    tags,
    marketError,
    marketVisible,
    choice,
    methods,
    method,
    methodName,
    setMethodName,
    parameters,
    prerequisites,
    params,
    setParam,
    valid,
    editing,
    pending,
    id,
    setId,
    type,
    setType,
    command,
    setCommand,
    url,
    setUrl,
    env,
    setEnv,
    headers,
    setHeaders,
    auth,
    setAuth,
    limit,
    setLimit,
    enabled,
    setEnabled,
    close,
    openMarket,
    openManual,
    openInstall,
    edit,
    toggleTag,
    install,
    save,
    toggle,
    connect,
    disconnect,
    authenticate,
    ask,
    cancel,
    confirm,
  }
}
