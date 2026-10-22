import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import z from "zod"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"

const log = Log.create({ service: "model-state" })

export namespace KilocodeModelState {
  export const Ref = z.object({
    providerID: z.string(),
    modelID: z.string(),
  })
  export type Ref = z.infer<typeof Ref>

  export const State = z.object({
    model: z.record(z.string(), Ref),
    recent: Ref.array(),
    favorite: Ref.array(),
    variant: z.record(z.string(), z.string()),
  })
  export type State = z.infer<typeof State>

  export const Patch = z.object({
    favorite: Ref.array().optional(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function get(): Promise<State> {
    const file = target()
    if (!(await Bun.file(file).exists())) return empty()
    const data = await Filesystem.readJson(file).catch((err: unknown) => {
      log.warn("failed to read model state", { err })
      return undefined
    })
    return clean(data)
  }

  export async function update(input: Patch): Promise<State> {
    const state = await get()
    const next = {
      ...state,
      favorite: input.favorite ? refs(input.favorite) : state.favorite,
    }
    await Filesystem.writeJson(target(), next)
    return next
  }

  function target() {
    return path.join(Global.Path.state, "model.json")
  }

  function empty(): State {
    return { model: {}, recent: [], favorite: [], variant: {} }
  }

  function clean(input: unknown): State {
    if (!isRecord(input)) return empty()
    return {
      model: record(input.model),
      recent: refs(input.recent),
      favorite: refs(input.favorite),
      variant: variant(input.variant),
    }
  }

  function refs(input: unknown) {
    const parsed = Ref.array().safeParse(input)
    if (!parsed.success) return []
    const seen = new Set<string>()
    return parsed.data.filter((item) => {
      const id = `${item.providerID}/${item.modelID}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  }

  function record(input: unknown) {
    if (!isRecord(input)) return {}
    return Object.fromEntries(
      Object.entries(input).flatMap(([key, value]) => {
        const parsed = Ref.safeParse(value)
        if (!parsed.success) return []
        return [[key, parsed.data]]
      }),
    )
  }

  function variant(input: unknown) {
    if (!isRecord(input)) return {}
    return Object.fromEntries(
      Object.entries(input).filter((item): item is [string, string] => typeof item[1] === "string"),
    )
  }
}
