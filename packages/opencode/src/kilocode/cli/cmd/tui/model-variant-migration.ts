type Model = {
  providerID: string
  modelID: string
}

type Agent = {
  name: string
  variant?: string
}

function key(model: Model) {
  return `${model.providerID}/${model.modelID}`
}

export function variants(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter((item): item is [string, string] => typeof item[1] === "string"),
  )
}

export function migrate(input: {
  old: Record<string, string>
  model: Record<string, Model | undefined>
  agent: Agent[]
  current?: { name: string; model: Model }
}) {
  const cfg: Record<string, { variant: string }> = {}
  const override: Record<string, string> = {}
  const seen = new Set<string>()
  const agents = new Map(input.agent.map((item) => [item.name, item]))
  const used = new Set<string>()

  function apply(name: string, model: Model | undefined) {
    if (!model) return
    const id = key(model)
    const value = input.old[id]
    if (!value) return
    if (seen.has(name)) return
    seen.add(name)
    used.add(id)
    if (agents.get(name)?.variant !== undefined) return
    cfg[name] = { variant: value }
    override[name] = value
  }

  for (const [name, model] of Object.entries(input.model)) {
    apply(name, model)
  }

  if (input.current) {
    apply(input.current.name, input.current.model)
  }

  return {
    cfg,
    override,
    matched: used.size > 0,
    remaining: Object.fromEntries(Object.entries(input.old).filter(([id]) => !used.has(id))),
  }
}
