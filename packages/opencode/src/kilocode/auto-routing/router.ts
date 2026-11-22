import {
  AUTO_DECISION_HEADER,
  CustomRouterRequestError,
  decideCustomRouter,
  fetchCustomRouters,
  parseCustomRouterModelId,
  type ClientCustomRouterEntry,
  type CustomRouterEntryRef,
  type CustomRouterListResponse,
  type CustomRouterSummary,
  type FetchLike,
} from "@kilocode/kilo-gateway"
import { Log } from "@opencode-ai/core/util/log"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Provider } from "@/provider/provider"

const log = Log.create({ service: "kilo.auto-router" })
const LIST_TTL_MS = 30_000

type Catalog = Record<ProviderV2.ID, Provider.Info>

export type Resolution =
  | { kind: "client"; provider: string; model: string; variant: string | null }
  | { kind: "gateway"; model: string; variant: string | null; decisionId: string }

type ResolveInput = {
  modelID: string
  messages: unknown[]
  tools?: unknown[]
  sessionID: string
  requestID?: string
  mode?: string
  machineId?: string
  token?: string
  organizationId?: string | null
  providers: Catalog
  fetch?: FetchLike
  now?: () => number
}

const cache = new Map<string, { at: number; pending: Promise<CustomRouterListResponse> }>()

function routers(input: ResolveInput): Promise<CustomRouterListResponse> {
  const key = `${input.token ?? ""}:${input.organizationId ?? ""}`
  const now = input.now?.() ?? Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < LIST_TTL_MS) return hit.pending
  const pending = fetchCustomRouters({
    token: input.token,
    organizationId: input.organizationId,
    fetch: input.fetch,
  })
  cache.set(key, { at: now, pending })
  pending.catch(() => cache.delete(key))
  return pending
}

// ADR 0005 serving: the CLI only calls /v1/decide when the selected custom
// router has a client entry this machine can serve. Otherwise the custom model
// id goes to the gateway unchanged.
export namespace KiloCustomRouter {
  export function isCustomRouter(input: { providerID: string; modelID: string | undefined }): boolean {
    return (
      input.providerID === ProviderV2.ID.kilo &&
      input.modelID !== undefined &&
      parseCustomRouterModelId(input.modelID) !== null
    )
  }

  export function servable(entry: CustomRouterEntryRef, providers: Catalog): boolean {
    if (entry.kind !== "client") return false
    const provider = providers[ProviderV2.ID.make(entry.provider)]
    return provider !== undefined && Object.hasOwn(provider.models, entry.model)
  }

  export function servableEntries(router: CustomRouterSummary, providers: Catalog): ClientCustomRouterEntry[] {
    const out: ClientCustomRouterEntry[] = []
    for (const item of router.entries) {
      if (item.entry.kind !== "client") continue
      if (!servable(item.entry, providers)) continue
      out.push(item.entry)
    }
    return out
  }

  export function errorMessage(code: string, detail?: string, retryAt?: string): string {
    const suffix = detail ? ` (${detail})` : ""
    switch (code) {
      case "unauthorized":
        return "Sign in to Kilo to use a custom auto router. Run `kilo auth login`."
      case "forbidden":
        return `You do not have access to this custom auto router${suffix}.`
      case "router_not_found":
        return `Custom auto router ${detail ?? ""} was not found. Check the id with \`kilo auto router list\`.`
      case "insufficient_balance":
        return "Your Kilo balance is too low for auto routing. Top up your account and try again."
      case "quota_exceeded":
        return `Kilo's benchmark limit for this router owner is reached. Try again ${retryAt ? `after ${retryAt}` : "later"}.`
      case "custom_router_unavailable":
        return `No model in this custom auto router can serve this request${suffix}. Add a client model with \`kilo auto router add\`, or add a gateway model in the web editor.`
      case "stale_engine_identity":
        return `This custom auto router needs a fresh evaluation. Run \`kilo auto eval ${detail ?? "<router>"}\`.`
      case "invalid_request":
        return `Kilo rejected the custom router request${suffix}.`
    }
    return `Kilo auto routing failed${suffix}.`
  }

  export function failure(error: unknown, router?: string): Error {
    if (error instanceof CustomRouterRequestError) {
      return new Error(errorMessage(error.code, error.message || router, error.retryAt))
    }
    const reason = error instanceof Error ? error.message : String(error)
    return new Error(`Kilo auto routing request failed: ${reason}`)
  }

  export async function resolve(input: ResolveInput): Promise<Resolution | undefined> {
    const reference = parseCustomRouterModelId(input.modelID)
    if (!reference) return undefined
    if (!input.token) throw new Error(errorMessage("unauthorized"))

    const list = await routers(input).catch((error) => {
      throw failure(error, input.modelID)
    })
    const router = list.routers.find((item) => item.modelId === input.modelID)
    if (!router) throw new Error(errorMessage("router_not_found", input.modelID))

    const servable = servableEntries(router, input.providers)
    if (servable.length === 0) return undefined

    const decision = await decideCustomRouter({
      token: input.token,
      organizationId: input.organizationId,
      fetch: input.fetch,
      body: {
        model: input.modelID,
        messages: input.messages,
        ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
        sessionId: input.sessionID,
        machineId: input.machineId ?? null,
        clientRequestId: input.requestID ?? null,
        mode: input.mode ?? null,
        clientEntries: servable.map((entry) => ({ provider: entry.provider, model: entry.model })),
      },
    }).catch((error) => {
      throw failure(error, input.modelID)
    })

    const pick = decision.decision
    log.info("custom router decision", {
      router: input.modelID,
      entry: pick.entry.kind === "client" ? `client:${pick.entry.provider}/${pick.entry.model}` : `gateway:${pick.entry.model}`,
      stale: String(pick.stale),
      fallback: String(pick.fallback),
    })

    if (pick.entry.kind === "client") {
      const provider = input.providers[ProviderV2.ID.make(pick.entry.provider)]
      if (!provider || !Object.hasOwn(provider.models, pick.entry.model)) {
        throw new Error(errorMessage("custom_router_unavailable", `client:${pick.entry.provider}/${pick.entry.model}`))
      }
      return { kind: "client", provider: pick.entry.provider, model: pick.entry.model, variant: pick.variant }
    }
    return { kind: "gateway", model: pick.entry.model, variant: pick.variant, decisionId: decision.decisionId }
  }

  export function routedModel(input: {
    pick: Resolution
    base: Provider.Model
    providers: Catalog
  }): Provider.Model | undefined {
    if (input.pick.kind === "client") {
      return input.providers[ProviderV2.ID.make(input.pick.provider)]?.models[input.pick.model]
    }
    const known = input.providers[ProviderV2.ID.kilo]?.models[input.pick.model]
    // The gateway catalog can omit a model the decision still names, for
    // example a direct-BYOK entry the owner key serves. Keep the router's
    // request shape and let the gateway resolve the concrete id.
    const model = known ?? {
      ...input.base,
      id: ModelV2.ID.make(input.pick.model),
      api: { ...input.base.api, id: input.pick.model },
    }
    // ADR 0005: the gateway verifies the signed decision and records the custom
    // router as the auto model, so the header travels with the request.
    return { ...model, headers: { ...model.headers, [AUTO_DECISION_HEADER]: input.pick.decisionId } }
  }
}
