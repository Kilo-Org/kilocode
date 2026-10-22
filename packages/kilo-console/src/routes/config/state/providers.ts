import { createMemo, createSignal } from "solid-js"
import type { Provider, ProviderAuthAuthorization, ProviderAuthMethod, ProviderConfig } from "@kilocode/sdk/v2/client"
import { useConfig } from "../../../context/config"
import { clean, csv, errMsg } from "../../../shared/utils"
import { authorizeProvider, completeProvider, connectProvider } from "../../../client"

const priority = ["kilo", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]
const pattern = /^[a-z0-9][a-z0-9-_]*$/

type Dict = Record<string, unknown>
type Prompt = NonNullable<ProviderAuthMethod["prompts"]>[number]

export type ConfiguredProvider = {
  id: string
  name: string
  source: string
  models: number
  config: ProviderConfig
  provider?: Provider
  inherited?: boolean
  overridden?: boolean
  editable?: boolean
}

function rank(id: string) {
  const index = priority.indexOf(id.toLowerCase())
  return index >= 0 ? index : priority.length
}

function sort<T extends { id: string; name: string }>(items: T[]) {
  return items.slice().sort((a, b) => {
    const diff = rank(a.id) - rank(b.id)
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name)
  })
}

function json(input: unknown) {
  if (!input || (typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0)) return ""
  return JSON.stringify(input, null, 2)
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
    return parsed as Dict
  } catch (err) {
    fail(`${label}: ${errMsg(err)}`)
    return undefined
  }
}

function rest(input: ProviderConfig["options"]) {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => key !== "apiKey" && key !== "baseURL"))
}

function shown(prompt: Prompt, values: Record<string, string>) {
  const rule = prompt.when
  if (!rule) return true
  const value = values[rule.key] ?? ""
  if (rule.op === "eq") return value === rule.value
  return value !== rule.value
}

export function useProviderSettings() {
  const ctx = useConfig()
  const snap = () => ctx.data()
  const [mode, setMode] = createSignal<"closed" | "select" | "form">("closed")
  const [filter, setFilter] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [choice, setChoice] = createSignal("")
  const [editing, setEditing] = createSignal<string | undefined>()
  const [id, setId] = createSignal("")
  const [name, setName] = createSignal("")
  const [env, setEnv] = createSignal("")
  const [api, setApi] = createSignal("")
  const [npm, setNpm] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [baseURL, setBaseURL] = createSignal("")
  const [whitelist, setWhitelist] = createSignal("")
  const [blacklist, setBlacklist] = createSignal("")
  const [options, setOptions] = createSignal("")
  const [models, setModels] = createSignal("")
  const [pending, setPending] = createSignal<ConfiguredProvider | undefined>()
  const [methodIndex, setMethodIndex] = createSignal<number | undefined>()
  const [authorization, setAuthorization] = createSignal<ProviderAuthAuthorization | undefined>()
  const [phase, setPhase] = createSignal<"authorizing" | "connecting" | undefined>()
  const [authKey, setAuthKey] = createSignal("")
  const [authCode, setAuthCode] = createSignal("")
  const [fields, setFields] = createSignal<Record<string, string>>({})
  const [authError, setAuthError] = createSignal("")
  const [authField, setAuthField] = createSignal("")

  const configured = createMemo<ConfiguredProvider[]>(() => {
    const data = snap()
    if (!data) return []
    const configs = data.effective.provider ?? {}
    const meta = new Map(data.overlay.collections.provider.map((item) => [item.key, item]))
    const rows = Object.entries(configs).flatMap(([key, cfg]) => {
      if (!cfg) return []
      const provider = data.providers.all.find((item) => item.id === key)
      const hit = meta.get(key)
      const model = Object.keys(provider?.models ?? cfg.models ?? {}).length
      return [
        {
          id: key,
          name: cfg.name ?? provider?.name ?? key,
          source: hit?.source ?? provider?.source ?? "config",
          models: model,
          config: cfg,
          provider,
          inherited: hit?.inherited,
          overridden: hit?.overridden,
          editable: hit?.editable,
        },
      ]
    })
    const ids = new Set(rows.map((item) => item.id))
    const loaded = data.providers.all.flatMap((provider) => {
      if (ids.has(provider.id)) return []
      if (!data.providers.connected.includes(provider.id)) return []
      return [
        {
          id: provider.id,
          name: provider.name,
          source: provider.source,
          models: Object.keys(provider.models).length,
          config: {},
          provider,
          editable: true,
        },
      ]
    })
    return sort([...rows, ...loaded])
  })

  const visible = createMemo(() => {
    const term = search().trim().toLowerCase()
    if (!term) return configured()
    return configured().filter((provider) => `${provider.name} ${provider.id}`.toLowerCase().includes(term))
  })

  const available = createMemo(() => {
    const data = snap()
    if (!data) return []
    const ids = new Set(configured().map((item) => item.id))
    const term = filter().trim().toLowerCase()
    return sort(data.providers.all)
      .filter((provider) => !ids.has(provider.id))
      .filter((provider) => {
        if (!term) return true
        return `${provider.name} ${provider.id}`.toLowerCase().includes(term)
      })
  })

  const selected = createMemo(() => {
    const key = id()
    return snap()?.providers.all.find((provider) => provider.id === key)
  })
  const target = createMemo(() => available().find((provider) => provider.id === choice()) ?? available()[0])

  const methods = createMemo(() => snap()?.authMethods[id()] ?? [])
  const method = createMemo(() => {
    const index = methodIndex()
    return index === undefined ? undefined : methods()[index]
  })
  const prompts = createMemo(() => method()?.prompts?.filter((prompt) => shown(prompt, fields())) ?? [])
  const auth = createMemo(() => methods().length > 0)

  function resetAuth() {
    setMethodIndex(undefined)
    setAuthorization(undefined)
    setPhase(undefined)
    setAuthKey("")
    setAuthCode("")
    setFields({})
    setAuthError("")
    setAuthField("")
  }

  function fill(provider: Provider | undefined, cfg: ProviderConfig | undefined, key: string) {
    const opts = cfg?.options ?? {}
    setId(key || provider?.id || cfg?.id || "")
    setName(cfg?.name ?? provider?.name ?? "")
    setEnv((cfg?.env ?? provider?.env ?? []).join(", "))
    setApi(cfg?.api ?? "")
    setNpm(cfg?.npm ?? "")
    setApiKey(typeof opts.apiKey === "string" ? opts.apiKey : "")
    setBaseURL(typeof opts.baseURL === "string" ? opts.baseURL : "")
    setWhitelist((cfg?.whitelist ?? []).join(", "))
    setBlacklist((cfg?.blacklist ?? []).join(", "))
    setOptions(json(rest(opts)))
    setModels(json(cfg?.models))
    resetAuth()
  }

  function selectMethod(index: number, providerID = id()) {
    setMethodIndex(index)
    setAuthorization(undefined)
    setAuthError("")
    setAuthField("")
    const current = (snap()?.authMethods[providerID] ?? [])[index]
    if (current?.type !== "oauth") return
    setPhase("authorizing")
    ctx.run(
      "Authorizing provider",
      async () => {
        const data = await authorizeProvider(ctx.target(), providerID, index, fields())
        setAuthorization(data)
        setPhase(undefined)
        if (data.url) window.open(data.url, "_blank", "noopener,noreferrer")
        if (data.method === "auto") completeOAuth(index)
      },
      { refetch: false },
    )
  }

  function setField(key: string, value: string) {
    setFields({ ...fields(), [key]: value })
  }

  function prepare(providerID: string) {
    const list = snap()?.authMethods[providerID] ?? []
    if (list.length === 1) selectMethod(0, providerID)
  }

  function add() {
    setEditing(undefined)
    setFilter("")
    setChoice("")
    setMode("select")
  }

  function close() {
    setMode("closed")
  }

  function pick(provider: Provider) {
    setEditing(undefined)
    fill(provider, undefined, provider.id)
    setMode("form")
    prepare(provider.id)
  }

  function choose(provider: Provider) {
    setChoice(provider.id)
  }

  function next() {
    const provider = target()
    if (!provider) return
    pick(provider)
  }

  function edit(item: ConfiguredProvider) {
    setEditing(item.id)
    fill(item.provider, item.config, item.id)
    setMode("form")
    prepare(item.id)
  }

  function connectAuth() {
    const key = clean(authKey())
    if (!key) {
      setAuthError("Enter an API key before saving.")
      setAuthField("apiKey")
      return
    }
    const meta: Record<string, string> = {}
    for (const prompt of prompts()) {
      const value = clean(fields()[prompt.key] ?? "")
      if (!value) {
        setAuthError(`${prompt.message} is required.`)
        setAuthField(prompt.key)
        return
      }
      meta[prompt.key] = value
    }
    setPhase("connecting")
    ctx.run("Connecting provider", async () =>
      connectProvider(ctx.target(), id(), key, Object.keys(meta).length ? meta : undefined),
    )
    close()
  }

  function completeOAuth(index = methodIndex()) {
    if (index === undefined) return
    const code = clean(authCode())
    if (authorization()?.method === "code" && !code) {
      setAuthError("Enter the authorization code before saving.")
      setAuthField("code")
      return
    }
    setPhase("connecting")
    ctx.run("Connecting provider", async () =>
      completeProvider(ctx.target(), id(), index, authorization()?.method === "code" ? code : undefined),
    )
    if (authorization()?.method === "code") close()
  }

  function save() {
    const key = clean(id())
    if (!key || !pattern.test(key)) {
      ctx.fail(
        "Provider ID must start with a lowercase letter or number and contain only lowercase letters, numbers, dashes, or underscores.",
      )
      return
    }
    const opts = object(options(), "Extra options", ctx.fail)
    const model = object(models(), "Model overrides", ctx.fail)
    if (!opts || !model) return
    const token = clean(apiKey())
    const url = clean(baseURL())
    if (token) opts.apiKey = token
    if (url) opts.baseURL = url
    const cfg: ProviderConfig = {}
    const label = clean(name())
    const vars = csv(env())
    const allow = csv(whitelist())
    const deny = csv(blacklist())
    const apiID = clean(api())
    const pkg = clean(npm())
    if (label) cfg.name = label
    if (vars.length) cfg.env = vars
    if (apiID) cfg.api = apiID
    if (pkg) cfg.npm = pkg
    if (allow.length) cfg.whitelist = allow
    if (deny.length) cfg.blacklist = deny
    if (Object.keys(opts).length) cfg.options = opts as ProviderConfig["options"]
    if (Object.keys(model).length) cfg.models = model as ProviderConfig["models"]
    const data = snap()
    if (!data) return
    const configs = { ...(data.effective.provider ?? {}) }
    const current = editing()
    if (current && current !== key) configs[current] = null
    configs[key] = cfg
    ctx.save({
      provider: configs,
      disabled_providers: (data.effective.disabled_providers ?? []).filter((item) => item !== key),
    })
    close()
  }

  function ask(item: ConfiguredProvider) {
    setPending(item)
  }

  function cancel() {
    setPending(undefined)
  }

  function confirm() {
    const item = pending()
    if (!item) return
    const data = snap()
    if (!data) return
    ctx.save({ provider: { ...(data.effective.provider ?? {}), [item.id]: null } })
    setPending(undefined)
  }

  return {
    ctx,
    snap,
    mode,
    filter,
    setFilter,
    search,
    setSearch,
    configured,
    visible,
    available,
    selected,
    target,
    auth,
    methods,
    method,
    prompts,
    methodIndex,
    authorization,
    phase,
    authKey,
    setAuthKey,
    authCode,
    setAuthCode,
    fields,
    setField,
    authError,
    authField,
    id,
    setId,
    name,
    setName,
    env,
    setEnv,
    api,
    setApi,
    npm,
    setNpm,
    apiKey,
    setApiKey,
    baseURL,
    setBaseURL,
    whitelist,
    setWhitelist,
    blacklist,
    setBlacklist,
    options,
    setOptions,
    models,
    setModels,
    pending,
    add,
    close,
    pick,
    choose,
    next,
    edit,
    selectMethod,
    connectAuth,
    completeOAuth,
    save,
    ask,
    cancel,
    confirm,
  }
}
