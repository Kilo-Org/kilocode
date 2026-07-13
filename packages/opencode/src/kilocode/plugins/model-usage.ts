import type { TuiPluginApi } from "@kilocode/plugin/tui"
import type { KilocodeSessionModelUsageResponse, Session } from "@kilocode/sdk/v2"
import {
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js"

export type SessionModelUsage = KilocodeSessionModelUsageResponse
export type UsageResult = { sessionID: string; data?: SessionModelUsage }

type UsageApi = {
  state: { session: { get: (sessionID: string) => Session | undefined } }
  client: {
    kilocode: {
      sessionModelUsage: (input: { sessionID: string }) => Promise<{ data?: SessionModelUsage }>
    }
  }
  event: TuiPluginApi["event"]
}

const stores = new WeakMap<UsageApi["state"], ReturnType<typeof createStore>>()

function createStore(api: UsageApi) {
  return createRoot((dispose) => {
    const [sessionID, open] = createSignal<string>()
    const [result, { refetch }] = createResource(
      sessionID,
      (id): Promise<UsageResult> =>
        api.client.kilocode.sessionModelUsage({ sessionID: id }).then(
          (response) => ({ sessionID: id, data: response.data }),
          () => ({ sessionID: id }),
        ),
    )
    const clients = new Map<UsageApi, number>()
    const state = api.state
    const refresh = () => void refetch()
    const related = (id: string, info?: ReturnType<typeof state.session.get>) => {
      const root = sessionID()
      return root ? isSessionTreeMember({ root, sessionID: id, info, get: state.session.get }) : false
    }
    const subscribe = (client: UsageApi) => [
      client.event.on("message.part.updated", (event) => {
        if (event.properties.part.type === "step-finish" && related(event.properties.sessionID)) refresh()
      }),
      client.event.on("message.part.removed", (event) => {
        if (related(event.properties.sessionID)) refresh()
      }),
      client.event.on("message.removed", (event) => {
        if (related(event.properties.sessionID)) refresh()
      }),
      client.event.on("session.created", (event) => {
        if (related(event.properties.sessionID, event.properties.info)) refresh()
      }),
      client.event.on("session.deleted", (event) => {
        if (related(event.properties.sessionID, event.properties.info)) refresh()
      }),
      client.event.on("server.connected", refresh),
    ]
    let owner: UsageApi | undefined
    let offs: (() => void)[] = []
    const activate = (client: UsageApi) => {
      owner = client
      offs = subscribe(client)
    }
    const deactivate = () => {
      for (const off of offs) off()
      offs = []
      owner = undefined
    }
    const mount = (client: UsageApi) => {
      clients.set(client, (clients.get(client) ?? 0) + 1)
      if (!owner) activate(client)
      return () => {
        const count = (clients.get(client) ?? 1) - 1
        if (count > 0) clients.set(client, count)
        if (count <= 0) clients.delete(client)
        if (owner === client && count <= 0) {
          deactivate()
          const next = clients.keys().next().value
          if (next) activate(next)
        }
        if (clients.size > 0) return
        stores.delete(state)
        dispose()
      }
    }
    return { mount, open, result }
  })
}

export function useModelUsage(api: UsageApi, sessionID: Accessor<string>) {
  const store = (() => {
    const current = stores.get(api.state)
    if (current) return current
    const created = createStore(api)
    stores.set(api.state, created)
    return created
  })()
  store.open(sessionID())
  createEffect(() => store.open(sessionID()))
  onMount(() => {
    const release = store.mount(api)
    onCleanup(release)
  })
  return {
    usage: createMemo(() => select(store.result(), sessionID())),
    unavailable: createMemo(() => failed(store.result(), sessionID())),
  }
}

export function select(result: UsageResult | undefined, sessionID: string) {
  if (result?.sessionID !== sessionID) return undefined
  return result.data
}

export function failed(result: UsageResult | undefined, sessionID: string) {
  return result?.sessionID === sessionID && !result.data
}

export function isSessionTreeMember(input: {
  root: string
  sessionID: string
  get: (sessionID: string) => Session | undefined
  info?: Session
}) {
  const seen = new Set<string>()
  const visit = (sessionID: string, info?: Session): boolean => {
    if (sessionID === input.root) return true
    if (seen.has(sessionID)) return false
    seen.add(sessionID)
    const session = info ?? input.get(sessionID)
    if (!session?.parentID) return false
    return visit(session.parentID)
  }
  return visit(input.sessionID, input.info)
}

export function groupModelsByProvider(
  models: SessionModelUsage["models"],
  providers: ReadonlyArray<{ id: string; name: string }>,
) {
  const names = new Map(providers.map((provider) => [provider.id, provider.name]))
  const groups = new Map<string, { providerID: string; providerName: string; models: SessionModelUsage["models"] }>()
  for (const model of models) {
    const group = groups.get(model.providerID) ?? {
      providerID: model.providerID,
      providerName: names.get(model.providerID) ?? model.providerID,
      models: [],
    }
    group.models.push(model)
    groups.set(model.providerID, group)
  }
  return [...groups.values()]
}

const count = new Intl.NumberFormat("en-US")
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

export function formatCount(value: number) {
  return count.format(value)
}

export function formatRate(tokens: SessionModelUsage["totals"]["tokens"]) {
  const total = tokens.input + tokens.cache.read + tokens.cache.write
  if (total === 0) return "-"
  return `${((tokens.cache.read / total) * 100).toFixed(1)}%`
}

export function formatCost(input: number) {
  const value = Math.max(0, Number.isFinite(input) ? input : 0)
  if (value > 0 && value < 0.000001) return "<$0.000001"
  return currency.format(value)
}
