import type { RunAgent, RunInput } from "@/cli/cmd/run/types"
import { cycleVariant, resolveVariant } from "@/cli/cmd/run/variant.shared"
import { resolveConfiguredVariant, saveVariantConfig, type VariantConfig } from "./model-variant"

type Agent = Pick<RunAgent, "name" | "mode" | "model" | "variant">
type Model = RunInput["model"]

export type RunVariantModels = {
  variants(model: Model): string[]
  label(model: NonNullable<Model>, variant: string | undefined): string
  limits: Record<string, number>
}

export type RunVariantResult = {
  modelLabel?: string
  status?: string
  variant?: string | undefined
  variants?: string[]
  failed?: boolean
  stale?: boolean
}

export type RunAgentResolution = { type: "none" } | { type: "rejected" } | { type: "resolved"; agent: string }

export function resolveRunAgent(requested: string | undefined, agent: string | undefined): RunAgentResolution {
  if (agent !== undefined) {
    return { type: "resolved", agent }
  }

  return requested ? { type: "rejected" } : { type: "none" }
}

type Current = {
  agent: string | undefined
  model: Model
  display: string | undefined
  prompt: string | undefined
  variants: string[]
  limits: Record<string, number>
}

type Input = {
  agent: string | undefined
  model: Model
  cli: string | undefined
  session: string | undefined
  agents: Promise<Agent[]>
  models: Promise<RunVariantModels>
  update(config: VariantConfig): Promise<unknown>
  onVariant?(variant: string | undefined): void
}

export function createRunVariantController(input: Input) {
  const initial = resolveVariant(input.cli, input.session, undefined, [])
  const state: Current = {
    agent: input.agent,
    model: input.model,
    display: initial === "default" ? undefined : initial,
    prompt: initial,
    variants: [],
    limits: {},
  }
  let agents: Agent[] = []
  let models: RunVariantModels | undefined
  let writes: Promise<void> = Promise.resolve()

  const current = (): Current => ({
    ...state,
    variants: [...state.variants],
    limits: { ...state.limits },
  })

  const available = () => agents.filter((agent) => agent.mode !== "subagent")

  const choose = (name: string | undefined) => {
    const list = available()
    return (name ? list.find((agent) => agent.name === name) : undefined) ?? list[0]
  }

  const apply = (variant: string | undefined) => {
    state.display = variant === "default" ? undefined : variant
    state.prompt = variant
  }

  const resolve = (session: string | undefined) => {
    if (agents.length > 0) state.agent = choose(state.agent)?.name
    state.variants = models?.variants(state.model) ?? []
    state.limits = models?.limits ?? {}
    const configured = resolveConfiguredVariant({
      agents: available(),
      agent: state.agent,
      model: state.model,
      variants: state.variants,
    })
    apply(resolveVariant(input.cli, session, configured.variant, state.variants))
  }

  const ready = Promise.all([input.agents.catch(() => []), input.models]).then(([list, catalog]) => {
    agents = list
    models = catalog
    resolve(input.session)
  })

  const context = () => ({
    agent: state.agent,
    providerID: state.model?.providerID,
    modelID: state.model?.modelID,
  })

  const same = (ctx: ReturnType<typeof context>) => {
    const next = context()
    return next.agent === ctx.agent && next.providerID === ctx.providerID && next.modelID === ctx.modelID
  }

  const result = (status: string): RunVariantResult => ({
    status,
    modelLabel: state.model ? models?.label(state.model, state.display) : undefined,
    variant: state.display,
    variants: [...state.variants],
  })

  const mutate = (value: string | undefined, cycle: boolean) => {
    const origin = ready.then(context)
    const task = writes.then(async (): Promise<RunVariantResult> => {
      const ctx = await origin
      if (!same(ctx)) return { stale: true }
      if (!state.model || state.variants.length === 0) return { status: "no variants available" }
      if (!state.agent) return { status: "agent unavailable" }

      const variant = cycle ? cycleVariant(state.display, state.variants) : value
      if (variant && !state.variants.includes(variant)) return { status: `variant ${variant} unavailable` }

      const prior = current()
      const selection = await saveVariantConfig({
        agent: state.agent,
        variant,
        update: input.update,
      })
      const stale = !same(ctx)
      if (!selection) {
        if (stale) return { failed: true, stale: true, status: `failed to save variant for ${ctx.agent}` }
        return {
          failed: true,
          status: `failed to save variant for ${ctx.agent}`,
          modelLabel: prior.model && models ? models.label(prior.model, prior.display) : undefined,
          variant: prior.display,
          variants: prior.variants,
        }
      }
      agents = agents.map((agent) => (agent.name === ctx.agent ? { ...agent, variant: selection.prompt } : agent))
      if (stale) return { stale: true }

      state.display = selection.display
      state.prompt = selection.prompt
      input.onVariant?.(state.prompt)
      return result(state.display ? `variant ${state.display}` : "variant default")
    })
    writes = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  return {
    ready,
    current,
    async prepare() {
      await ready
      await writes
      return {
        agent: state.agent,
        model: state.model,
        variant: state.prompt,
      }
    },
    async switchModel(model: NonNullable<Model>) {
      await ready
      state.model = model
      resolve(undefined)
      return result(`model ${model.modelID}`)
    },
    async switchAgent(agent: string | undefined) {
      await ready
      if (agent === undefined || agent === state.agent) return current()
      state.agent = agent
      resolve(undefined)
      return current()
    },
    async resolveAgent(resolution: RunAgentResolution) {
      await ready
      if (resolution.type === "none") return current()
      if (resolution.type === "rejected") {
        if (agents.length > 0) return current()
        state.agent = undefined
        resolve(undefined)
        return current()
      }
      if (resolution.agent === state.agent) return current()
      state.agent = resolution.agent
      resolve(undefined)
      return current()
    },
    select(variant: string | undefined) {
      return mutate(variant, false)
    },
    cycle() {
      return mutate(undefined, true)
    },
  }
}

export function createRunVariantGate(input: {
  controller: ReturnType<typeof createRunVariantController>
  resolve?: () => Promise<RunAgentResolution>
}) {
  const ready = Promise.all([input.controller.ready, input.resolve?.().then(input.controller.resolveAgent)])
  return {
    ready,
    async current() {
      await ready
      return input.controller.current()
    },
    async prepare() {
      await ready
      return input.controller.prepare()
    },
  }
}

export async function resolveVariantAction(input: {
  action: () => RunVariantResult | void | Promise<RunVariantResult | void>
  stale: () => boolean
  empty: string
  failure: string
}): Promise<{ result?: RunVariantResult; status?: string }> {
  return Promise.resolve()
    .then(input.action)
    .then(
      (result) => {
        if (!result) return { status: input.empty }
        if (result.stale || input.stale()) {
          return result.failed && result.status ? { status: result.status } : {}
        }
        return { result }
      },
      () => ({ status: input.failure }),
    )
}
