// Option builder for the TUI model picker with Kilo Gateway metadata, as in v1 `kilocode/model-picker.ts`.
// Pure, so the grouping, order, search and label rules are testable without the dialog.
//
// - Favorites and Recent come first, in stored order. A recent model also stays in its provider section, so
//   "Recommended" and "Kilo Gateway" do not look empty after a model is used.
// - Then "Recommended" (Kilo models with a Gateway `recommendedIndex`, in that order), then the other Kilo Gateway
//   models, then the other providers by name. Nothing is hidden.
// - Search matches the title, the section, the provider name and the provider and model IDs, and ranks inside
//   each section so that section headers stay visible.
import type { ModelInfo } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import * as fuzzysort from "fuzzysort"
import { entries, flatMap, groupBy, pipe } from "remeda"
import { FreeModelDisclosure } from "./components/free-model-disclosure"

export const KILO_PROVIDER_ID = "kilo"
export const RECOMMENDED_CATEGORY = "Recommended"

type Ref = { providerID: string; modelID: string }

export type ModelPickerInput = {
  models: readonly ModelInfo[]
  providers: ReadonlyMap<string, { name: string }>
  /** Kilo Gateway catalog entries by Gateway model ID. Empty while the catalog loads or when it fails. */
  gateway: ReadonlyMap<string, KiloGatewayRpc.ModelEntry>
  favorites: readonly Ref[]
  recents: readonly Ref[]
  /** Section headers need a connected integration, as upstream. */
  connected: boolean
  /** True when the Favorites and Recent sections show. */
  showExtra: boolean
  /** Set when the dialog shows one provider. */
  providerID?: string
  query: string
  onSelect: (providerID: string, modelID: string) => void
}

export type ModelPickerOption = ReturnType<typeof buildModelPickerOptions>[number]

const SEARCH_KEYS = ["title", "category", "providerName", "providerID", "modelID"]

// kilo_port(tui:c29e2d297ca2) kilo_port(unattributed:tui/component:3bd2c832bb54) kilo_port(unattributed:tui/component:8356b283bea4)
// kilo_port(unattributed:tui/component:9a58930c75d8) kilo_port(unattributed:tui/component:013e56c6e70d)
export function buildModelPickerOptions(input: ModelPickerInput) {
  const needle = input.query.trim()
  const gateway = (model: ModelInfo) => gatewayModel(model, input.gateway)
  const option = (model: ModelInfo, extra: { key?: Ref; description?: string; category?: string }) => {
    const providerName = input.providers.get(model.providerID)?.name ?? model.providerID
    return {
      value: { providerID: model.providerID, modelID: model.id },
      title: model.name,
      footer: modelFooter(model, gateway(model)),
      providerName,
      providerID: model.providerID,
      modelID: model.id,
      onSelect: () => input.onSelect(model.providerID, model.id),
      ...extra,
    }
  }
  const find = (ref: Ref) =>
    input.models.find((model) => model.providerID === ref.providerID && model.id === ref.modelID)
  const section = (refs: readonly Ref[], category: string) =>
    input.showExtra
      ? refs.flatMap((ref) => {
          const model = find(ref)
          return model
            ? [
                option(model, {
                  key: ref,
                  description: input.providers.get(model.providerID)?.name ?? model.providerID,
                  category,
                }),
              ]
            : []
        })
      : []
  const favorite = (model: ModelInfo) =>
    input.favorites.some((item) => item.providerID === model.providerID && item.modelID === model.id)

  const favorites = section(input.favorites, "Favorites")
  const recents = section(
    input.recents.filter(
      (item) => !input.favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
    ),
    "Recent",
  )
  const list = input.models
    .filter((model) => model.status !== "deprecated")
    .filter((model) => !input.providerID || model.providerID === input.providerID)
    // Favorites have their own section. Recents stay in their provider section (see the header).
    .filter((model) => !(input.showExtra && favorite(model)))
    .map((model) => {
      const meta = gateway(model)
      return {
        group: group(model, meta),
        index: meta?.recommendedIndex ?? 0,
        free: free(model, meta),
        option: option(model, {
          description: favorite(model) ? "(Favorite)" : undefined,
          category: input.connected ? category(model, meta, input.providers) : undefined,
        }),
      }
    })
    // Stable sort: the server order (newest first) stays inside each group.
    .toSorted(
      (a, b) =>
        a.group - b.group ||
        a.index - b.index ||
        (a.group === 2 ? a.option.providerName.localeCompare(b.option.providerName) : 0) ||
        Number(b.free) - Number(a.free),
    )
    .map((item) => item.option)

  if (!needle) return [...favorites, ...recents, ...list]
  return [
    ...rank(needle, favorites),
    ...rank(needle, recents),
    ...pipe(
      list,
      groupBy((item) => item.category ?? ""),
      entries(),
      flatMap(([, items]) => rank(needle, items)),
    ),
  ]
}

/** Right-hand labels of a picker row: `Free`, `BYOK` and `May train` for Kilo models, from Gateway metadata only. */
export function modelFooter(model: ModelInfo, gateway: KiloGatewayRpc.ModelEntry | undefined) {
  const labels = [
    free(model, gateway) ? "Free" : undefined,
    model.providerID === KILO_PROVIDER_ID && FreeModelDisclosure.hasByok(gateway)
      ? FreeModelDisclosure.byok
      : undefined,
    model.providerID === KILO_PROVIDER_ID && FreeModelDisclosure.collectsData(gateway)
      ? FreeModelDisclosure.label
      : undefined,
  ].filter((label) => label !== undefined)
  return labels.length > 0 ? labels.join(" · ") : undefined
}

/** Gateway metadata of a Kilo model. A config alias keeps the Gateway ID in `modelID`. */
export function gatewayModel(model: ModelInfo, gateway: ReadonlyMap<string, KiloGatewayRpc.ModelEntry>) {
  if (model.providerID !== KILO_PROVIDER_ID) return
  return gateway.get(model.modelID) ?? gateway.get(model.id)
}

// Kilo models use the Gateway `isFree` flag. Other providers keep the upstream rule: every price tier has zero input.
function free(model: ModelInfo, gateway: KiloGatewayRpc.ModelEntry | undefined) {
  if (model.providerID === KILO_PROVIDER_ID) return gateway?.isFree === true
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0)
}

function recommended(model: ModelInfo, gateway: KiloGatewayRpc.ModelEntry | undefined) {
  return model.providerID === KILO_PROVIDER_ID && gateway?.recommendedIndex !== undefined
}

function group(model: ModelInfo, gateway: KiloGatewayRpc.ModelEntry | undefined) {
  if (recommended(model, gateway)) return 0
  if (model.providerID === KILO_PROVIDER_ID) return 1
  return 2
}

function category(
  model: ModelInfo,
  gateway: KiloGatewayRpc.ModelEntry | undefined,
  providers: ReadonlyMap<string, { name: string }>,
) {
  if (recommended(model, gateway)) return RECOMMENDED_CATEGORY
  return providers.get(model.providerID)?.name ?? model.providerID
}

function rank<T>(needle: string, items: readonly T[]) {
  return fuzzysort.go(needle, items, { keys: SEARCH_KEYS }).map((result) => result.obj)
}
