import type {
  OpenCodeClient,
  ProviderInfo,
  ModelInfo,
  AgentInfo,
  SkillInfo,
  CommandInfo,
} from "@opencode-ai/client/promise"
import { result, type AdapterOptions, type AdapterResult } from "./result"
import type { Provider, Model, Agent, ProviderListResponse } from "./view-types"

export interface CommandItem {
  name: string
  description?: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
    variant?: string
  }
  variant?: string
  source?: string
  hints?: string[]
}

export interface SkillItem {
  id: string
  name: string
  description?: string
  location: string
  content: string
}

export function modelView(info: ModelInfo): Model {
  // Untiered quote must be selected by absence of tier; multiple or absent means unavailable
  const untieredQuotes = (info.cost ?? []).filter((c) => !c.tier)
  const isAvailable = untieredQuotes.length === 1
  const baseCost = isAvailable ? untieredQuotes[0] : undefined

  const tieredQuotes = (info.cost ?? [])
    .filter((c): c is typeof c & { tier: { type: "context"; size: number } } => Boolean(c.tier))
    .map((c) => ({
      input: c.input,
      output: c.output,
      cache: {
        read: c.cache?.read ?? 0,
        write: c.cache?.write ?? 0,
      },
      tier: {
        type: c.tier.type,
        size: c.tier.size,
      },
    }))

  const isFree = isAvailable && baseCost ? baseCost.input === 0 && baseCost.output === 0 : false

  const inputCaps = info.capabilities?.input ?? []
  const outputCaps = info.capabilities?.output ?? []

  return {
    id: info.id,
    providerID: info.providerID,
    api: {
      id: info.modelID ?? info.id,
      url: "",
      npm: info.package ?? "",
    },
    name: info.name,
    family: info.family,
    capabilities: {
      temperature: true,
      reasoning: outputCaps.includes("reasoning") || inputCaps.includes("reasoning"),
      attachment: inputCaps.some((i) => i !== "text"),
      toolcall: info.capabilities?.tools ?? false,
      input: {
        text: inputCaps.includes("text"),
        audio: inputCaps.includes("audio"),
        image: inputCaps.includes("image"),
        video: inputCaps.includes("video"),
        pdf: inputCaps.includes("pdf"),
      },
      output: {
        text: outputCaps.includes("text"),
        audio: outputCaps.includes("audio"),
        image: outputCaps.includes("image"),
        video: outputCaps.includes("video"),
        pdf: outputCaps.includes("pdf"),
      },
      interleaved: false,
    },
    cost: {
      available: isAvailable,
      input: baseCost?.input ?? 0,
      output: baseCost?.output ?? 0,
      cache: {
        read: baseCost?.cache?.read ?? 0,
        write: baseCost?.cache?.write ?? 0,
      },
      tiers: tieredQuotes.length > 0 ? tieredQuotes : undefined,
    },
    isFree: isFree ? true : undefined,
    limit: {
      context: info.limit?.context ?? 0,
      input: info.limit?.input,
      output: info.limit?.output ?? 0,
    },
    status: info.status ?? "active",
    options: (info.settings as Record<string, unknown>) ?? {},
    headers: info.headers ?? {},
    release_date: info.time?.released ? new Date(info.time.released).toISOString() : "",
    variants: info.variants
      ? Object.fromEntries(
          info.variants.map((v) => [v.id, { ...v }]),
        )
      : undefined,
  }
}

export function providerView(info: ProviderInfo, models: Record<string, Model> = {}): Provider {
  return {
    id: info.id,
    name: info.name,
    description: undefined,
    source: info.activation === "auto" ? "api" : "config",
    env: [],
    key: undefined,
    options: (info.settings as Record<string, unknown>) ?? {},
    models,
  }
}

export function agentView(info: AgentInfo): Agent {
  return {
    name: info.id,
    displayName: info.name ?? info.id,
    description: info.description,
    mode: info.mode ?? "all",
    native: true,
    hidden: info.hidden,
    color: typeof info.color === "string" ? info.color : undefined,
    steps: info.steps,
    permission: (info.permissions ?? []).map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    model: info.model
      ? {
          modelID: info.model.id,
          providerID: info.model.providerID,
        }
      : undefined,
    prompt: info.system,
    options: (info.request?.body as Record<string, unknown>) ?? {},
  }
}

export function skillView(info: SkillInfo): SkillItem {
  return {
    id: info.id,
    name: info.name,
    description: info.description,
    location: info.location,
    content: info.content,
  }
}

export function commandView(info: CommandInfo): CommandItem {
  return {
    name: info.name,
    description: info.description,
  }
}

export interface ModelAdapterInput {
  directory?: string
  workspace?: string
}

export function createModelMethods(client: OpenCodeClient, defaultDirectory: string) {
  const resolveLocation = (input?: ModelAdapterInput) => ({
    directory: input?.directory ?? defaultDirectory,
    workspace: input?.workspace,
  })

  const providerMethods = {
    list: <Throw extends boolean = false>(
      input?: ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<ProviderListResponse, Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const [providersRes, modelsRes, defaultModelRes] = await Promise.all([
          client.provider.list({ location }, options),
          client.model.list({ location }, options),
          client.model.default({ location }, options),
        ])

        const rawProviders = providersRes.data
        const rawModels = modelsRes.data
        const rawDefault = defaultModelRes.data

        const modelsByProvider: Record<string, Record<string, Model>> = {}
        for (const m of rawModels) {
          const view = modelView(m)
          if (!modelsByProvider[m.providerID]) {
            modelsByProvider[m.providerID] = {}
          }
          modelsByProvider[m.providerID]![m.id] = view
        }

        const allProviders: Provider[] = rawProviders.map((p) =>
          providerView(p, modelsByProvider[p.id] ?? {}),
        )

        const defaultMap: Record<string, string> = {}
        if (rawDefault) {
          defaultMap[rawDefault.providerID] = rawDefault.id
        }

        const connected = rawProviders
          .filter(
            (p) =>
              p.activation !== "disabled" &&
              Object.keys(modelsByProvider[p.id] ?? {}).length > 0,
          )
          .map((p) => p.id)

        return {
          all: allProviders,
          default: defaultMap,
          connected,
          failed: [],
        }
      }, options),

    get: <Throw extends boolean = false>(
      input: { providerID: string } & ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<Provider, Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const [providerRes, modelsRes] = await Promise.all([
          client.provider.get({ providerID: input.providerID, location }, options),
          client.model.list({ location }, options),
        ])

        const providerInfo = providerRes.data
        const rawModels = modelsRes.data

        const providerModels: Record<string, Model> = {}
        for (const m of rawModels) {
          if (m.providerID === input.providerID) {
            providerModels[m.id] = modelView(m)
          }
        }

        return providerView(providerInfo, providerModels)
      }, options),
  }

  const modelMethods = {
    list: <Throw extends boolean = false>(
      input?: ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<Model[], Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const res = await client.model.list({ location }, options)
        return res.data.map(modelView)
      }, options),

    default: <Throw extends boolean = false>(
      input?: ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<Model | null, Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const res = await client.model.default({ location }, options)
        const item = res.data
        return item ? modelView(item) : null
      }, options),
  }

  const agentMethods = {
    list: <Throw extends boolean = false>(
      input?: ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<Agent[], Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const res = await client.agent.list({ location }, options)
        return res.data.map(agentView)
      }, options),

    get: <Throw extends boolean = false>(
      input: { agentID: string } & ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<Agent, Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const res = await client.agent.get({ agentID: input.agentID, location }, options)
        return agentView(res.data)
      }, options),
  }

  const skillMethods = {
    list: <Throw extends boolean = false>(
      input?: ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<SkillItem[], Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const res = await client.skill.list({ location }, options)
        return res.data.map(skillView)
      }, options),
  }

  const commandMethods = {
    list: <Throw extends boolean = false>(
      input?: ModelAdapterInput,
      options?: AdapterOptions<Throw>,
    ): Promise<AdapterResult<CommandItem[], Throw>> =>
      result(async () => {
        const location = resolveLocation(input)
        const res = await client.command.list({ location }, options)
        return res.data.map(commandView)
      }, options),
  }

  return {
    provider: providerMethods,
    model: modelMethods,
    agent: agentMethods,
    skill: skillMethods,
    command: commandMethods,
    app: {
      agents: agentMethods.list,
      skills: skillMethods.list,
    },
  }
}
