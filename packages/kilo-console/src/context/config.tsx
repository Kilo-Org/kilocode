import { createContext, useContext } from "solid-js"
import type { Accessor, Resource } from "solid-js"
import type { Query, Snapshot, ConfigPatch, ConfigUnset, TuiPatch } from "../client"

export type Task = {
  refetch?: boolean
}

export type Ctx = {
  data: Resource<Snapshot>
  query: Accessor<Query | undefined>
  saving: Accessor<string | undefined>
  failure: Accessor<string | undefined>

  target: () => Query
  fail: (message: string) => void
  run: (label: string, job: () => Promise<unknown>, task?: Task) => void
  save: (patch: Partial<ConfigPatch>) => void
  patch: (patch: Partial<ConfigPatch>, unset?: ConfigUnset) => void
  unset: (paths: ConfigUnset) => void
  tui: (patch: TuiPatch) => void
}

export const ConfigContext = createContext<Ctx>()

export function useConfig() {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error("useConfig must be used within ConfigLayout")
  return ctx
}
