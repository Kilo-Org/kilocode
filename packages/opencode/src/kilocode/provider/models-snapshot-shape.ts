export type ModelsSnapshot = Record<string, unknown>

export interface ModelsSnapshotStats {
  providers: number
  models: number
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  throw new Error(`${name} must be an object`)
}

function text(value: unknown, name: string) {
  if (typeof value === "string" && value.length > 0) return
  throw new Error(`${name} must be a non-empty string`)
}

function finite(value: unknown, name: string) {
  if (typeof value === "number" && Number.isFinite(value)) return
  throw new Error(`${name} must be a finite number`)
}

function optionalText(value: unknown, name: string) {
  if (value === undefined || typeof value === "string") return
  throw new Error(`${name} must be a string when present`)
}

function optionalBoolean(value: unknown, name: string) {
  if (value === undefined || typeof value === "boolean") return
  throw new Error(`${name} must be a boolean when present`)
}

function optionalFinite(value: unknown, name: string) {
  if (value === undefined || (typeof value === "number" && Number.isFinite(value))) return
  throw new Error(`${name} must be a finite number when present`)
}

function env(value: unknown, name: string) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  for (const [i, item] of value.entries()) {
    text(item, `${name}[${i}]`)
  }
}

function cost(value: unknown, name: string) {
  if (value === undefined) return
  const obj = record(value, name)
  optionalFinite(obj.input, `${name}.input`)
  optionalFinite(obj.output, `${name}.output`)
  optionalFinite(obj.cache_read, `${name}.cache_read`)
  optionalFinite(obj.cache_write, `${name}.cache_write`)
  if (obj.context_over_200k === undefined) return
  cost(obj.context_over_200k, `${name}.context_over_200k`)
}

function modalities(value: unknown, name: string) {
  if (value === undefined) return
  const obj = record(value, name)
  for (const key of ["input", "output"] as const) {
    const list = obj[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) throw new Error(`${name}.${key} must be an array when present`)
    for (const [i, item] of list.entries()) {
      text(item, `${name}.${key}[${i}]`)
    }
  }
}

function model(value: unknown, name: string) {
  const obj = record(value, name)
  text(obj.id, `${name}.id`)
  text(obj.name, `${name}.name`)
  optionalText(obj.family, `${name}.family`)
  optionalText(obj.release_date, `${name}.release_date`)
  optionalText(obj.knowledge, `${name}.knowledge`)
  optionalText(obj.last_updated, `${name}.last_updated`)
  optionalBoolean(obj.attachment, `${name}.attachment`)
  optionalBoolean(obj.reasoning, `${name}.reasoning`)
  optionalBoolean(obj.temperature, `${name}.temperature`)
  optionalBoolean(obj.tool_call, `${name}.tool_call`)
  cost(obj.cost, `${name}.cost`)
  modalities(obj.modalities, `${name}.modalities`)

  const limit = record(obj.limit, `${name}.limit`)
  finite(limit.context, `${name}.limit.context`)
  optionalFinite(limit.input, `${name}.limit.input`)
  finite(limit.output, `${name}.limit.output`)
}

function provider(value: unknown, name: string) {
  const obj = record(value, name)
  text(obj.id, `${name}.id`)
  text(obj.name, `${name}.name`)
  optionalText(obj.api, `${name}.api`)
  optionalText(obj.npm, `${name}.npm`)
  env(obj.env, `${name}.env`)

  const models = Object.entries(record(obj.models, `${name}.models`))
  if (models.length === 0) throw new Error(`${name}.models must contain at least one model`)
  for (const [id, item] of models) {
    model(item, `${name}.models.${id}`)
  }
  return models.length
}

export function validateModelsSnapshot(value: unknown, source = "models snapshot"): ModelsSnapshotStats {
  const data = Object.entries(record(value, source))
  if (data.length === 0) throw new Error(`${source} must contain at least one provider`)
  return {
    providers: data.length,
    models: data.reduce((sum, [id, item]) => sum + provider(item, `${source}.${id}`), 0),
  }
}

export function parseModelsSnapshot(text: string, source = "models snapshot") {
  if (text.trim().length === 0) throw new Error(`${source} is empty`)
  const data = (() => {
    try {
      return JSON.parse(text) as unknown
    } catch (err) {
      throw new Error(`${source} is not valid JSON`, { cause: err })
    }
  })()
  const stats = validateModelsSnapshot(data, source)
  return { data: data as ModelsSnapshot, stats }
}
