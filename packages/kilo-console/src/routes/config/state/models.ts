import { createMemo, createSignal } from "solid-js"
import type { Model, Provider } from "@kilocode/sdk/v2/client"
import { saveModelState, type ModelRef } from "../../../client"
import { useConfig } from "../../../context/config"
import { hasGateway, visible } from "./privacy"

export const capabilities = [
  "toolcall",
  "attachment",
  "temperature",
  "interleaved",
  "input:audio",
  "input:image",
  "input:video",
  "input:pdf",
  "output:audio",
  "output:image",
  "output:video",
  "output:pdf",
] as const

export type Capability = (typeof capabilities)[number]
export type ModelField = "model" | "small_model"

const cap = 1_000_000

function order(a: Provider, b: Provider) {
  if (a.id === "kilo") return -1
  if (b.id === "kilo") return 1
  return a.name.localeCompare(b.name)
}

function has(model: Model, cap: Capability) {
  if (cap === "toolcall") return model.capabilities.toolcall
  if (cap === "attachment") return model.capabilities.attachment
  if (cap === "temperature") return model.capabilities.temperature
  if (cap === "interleaved") return Boolean(model.capabilities.interleaved)
  if (cap === "input:audio") return model.capabilities.input.audio
  if (cap === "input:image") return model.capabilities.input.image
  if (cap === "input:video") return model.capabilities.input.video
  if (cap === "input:pdf") return model.capabilities.input.pdf
  if (cap === "output:audio") return model.capabilities.output.audio
  if (cap === "output:image") return model.capabilities.output.image
  if (cap === "output:video") return model.capabilities.output.video
  return model.capabilities.output.pdf
}

type Item = { id: string; provider: Provider; model: Model }

function same(item: Item, ref: ModelRef) {
  if (item.provider.id === ref.providerID && item.model.id === ref.modelID) return true
  return item.model.providerID === ref.providerID && item.model.id === ref.modelID
}

export function useModelSettings() {
  const ctx = useConfig()
  const snap = () => ctx.data()
  const [search, setSearch] = createSignal("")
  const [filter, setFilter] = createSignal("all")
  const [price, setPrice] = createSignal("all")
  const [low, setLow] = createSignal(0)
  const [high, setHigh] = createSignal(0)
  const [reason, setReason] = createSignal("all")
  const [privacy, setPrivacy] = createSignal(false)
  const [caps, setCaps] = createSignal<Capability[]>([])
  const [starred, setStarred] = createSignal(false)
  const [mode, setMode] = createSignal<"closed" | "select">("closed")
  const [field, setField] = createSignal<ModelField>("model")
  const [picker, setPicker] = createSignal("")
  const [choice, setChoice] = createSignal("")

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
  const gateway = createMemo(() => hasGateway(providers()))

  const max = createMemo(() => {
    const values = all().map((item) => item.model.limit.context)
    return values.length ? Math.min(Math.max(...values), cap) : 0
  })

  const top = createMemo(() => Math.min(high() || max(), max()))
  const bottom = createMemo(() => Math.min(low(), top()))
  const upper = createMemo(() => (top() >= max() ? undefined : top()))
  const favorites = createMemo(() => snap()?.modelState.favorite ?? [])
  const fav = (item: Item) => favorites().some((ref) => same(item, ref))

  const models = createMemo(() => {
    const term = search().toLowerCase()
    return all()
      .filter((item) => (filter() === "all" ? true : item.provider.id === filter()))
      .filter((item) => (price() === "free" ? item.model.isFree : true))
      .filter((item) => (price() === "paid" ? !item.model.isFree : true))
      .filter((item) => (bottom() > 0 ? item.model.limit.context >= bottom() : true))
      .filter((item) => (upper() !== undefined ? item.model.limit.context <= upper()! : true))
      .filter((item) => (reason() === "reasoning" ? item.model.capabilities.reasoning : true))
      .filter((item) => (reason() === "standard" ? !item.model.capabilities.reasoning : true))
      .filter((item) => visible(item.provider, item.model, privacy()))
      .filter((item) => (starred() ? fav(item) : true))
      .filter((item) => caps().every((cap) => has(item.model, cap)))
      .filter((item) => {
        if (!term) return true
        return `${item.id} ${item.model.name} ${item.provider.name}`.toLowerCase().includes(term)
      })
      .sort((a, b) => {
        const ranked = Number(fav(b)) - Number(fav(a))
        if (ranked !== 0) return ranked
        return a.model.name.localeCompare(b.model.name) || a.provider.name.localeCompare(b.provider.name)
      })
  })

  const options = createMemo(() => {
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

  const label = createMemo(() => (field() === "model" ? "Default model" : "Small model"))

  function item(value: unknown) {
    if (typeof value !== "string") return undefined
    return all().find((model) => model.id === value || `${model.model.providerID}/${model.model.id}` === value)
  }

  function toggle(cap: Capability) {
    const set = new Set(caps())
    if (set.has(cap)) {
      set.delete(cap)
      setCaps([...set])
      return
    }
    set.add(cap)
    setCaps([...set])
  }

  function setMin(value: number) {
    setLow(Math.max(0, Math.min(value, top())))
  }

  function setMax(value: number) {
    setHigh(Math.min(max(), Math.max(value, bottom())))
  }

  function favorite(item: Item) {
    const query = ctx.query()
    if (!query) return
    const next = fav(item)
      ? favorites().filter((ref) => !same(item, ref))
      : [{ providerID: item.provider.id, modelID: item.model.id }, ...favorites()]
    ctx.run("Saving favorite", () => saveModelState(query, next))
  }

  function edit(next: ModelField) {
    const value = snap()?.overlay.fields[next]?.value
    setField(next)
    setPicker("")
    setChoice(typeof value === "string" ? value : "")
    setMode("select")
  }

  function close() {
    setMode("closed")
  }

  function select(item: Item) {
    setChoice(item.id)
  }

  function save() {
    const id = choice()
    if (!id) {
      ctx.fail(`Select a ${label().toLowerCase()} before saving.`)
      return
    }
    if (field() === "model") {
      ctx.save({ model: id })
      close()
      return
    }
    ctx.save({ small_model: id })
    close()
  }

  return {
    ctx,
    snap,
    search,
    setSearch,
    filter,
    setFilter,
    price,
    setPrice,
    low: bottom,
    high,
    top,
    setMin,
    setMax,
    reason,
    setReason,
    privacy,
    setPrivacy,
    caps,
    setCaps,
    starred,
    setStarred,
    fav,
    favorite,
    max,
    gateway,
    providers,
    capabilities,
    toggle,
    models,
    item,
    mode,
    field,
    label,
    picker,
    setPicker,
    choice,
    options,
    edit,
    close,
    select,
    save,
  }
}
