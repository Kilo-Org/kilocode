// kilocode_change - new file
//
// Pure option builder for the TUI model picker, extracted from
// `component/dialog-model.tsx` so the Kilo Gateway grouping/search rules are
// testable without mounting the dialog.
//
// Two rules here exist because the TUI used to hide live Kilo Gateway models:
//   1. Recently used models are no longer stripped from their provider section.
//      Selecting a Kilo sonnet once used to remove it from "Recommended" /
//      "Kilo Gateway" entirely, leaving those sections looking empty. This
//      matches the VS Code selector, which also keeps recents in place.
//   2. Search matches the provider name and the provider/model ids, not just
//      the title and the section header, so typing `kilo` finds
//      "Anthropic Claude Sonnet 4.5" under the "Recommended" section.
import * as fuzzysort from "fuzzysort"
import { entries, filter, flatMap, groupBy, map, pipe, sortBy } from "remeda"

export const KILO_PROVIDER_ID = "kilo"
export const RECOMMENDED_CATEGORY = "Recommended"

export interface ModelPickerRef {
  providerID: string
  modelID: string
}

export interface ModelPickerModel {
  id: string
  name?: string
  status?: string
  /** sub-provider the model is routed through, not the catalog provider id */
  providerID?: string
  release_date?: string | number
  recommendedIndex?: number
}

export interface ModelPickerProvider<M extends ModelPickerModel = ModelPickerModel> {
  id: string
  name: string
  models: Record<string, M>
}

export interface ModelPickerOption {
  key?: ModelPickerRef
  value: ModelPickerRef
  title: string
  description?: string
  category?: string
  releaseDate: string | number
  disabled: boolean
  footer?: string
  /** extra search haystacks — kept flat so fuzzysort can key off them */
  providerName: string
  providerID: string
  modelID: string
  onSelect: () => void
}

const MODEL_SEARCH_KEYS = ["title", "category", "providerName", "providerID", "modelID"]
const PROVIDER_SEARCH_KEYS = ["title", "category"]

function rank<T>(needle: string, items: readonly T[], keys: string[]): T[] {
  return fuzzysort.go(needle, items as T[], { keys }).map((result) => result.obj)
}

export function rankModelOptions<T extends ModelPickerOption>(needle: string, items: readonly T[]): T[] {
  return rank(needle, items, MODEL_SEARCH_KEYS)
}

export function rankProviderOptions<T extends { title: string; category?: string }>(
  needle: string,
  items: readonly T[],
): T[] {
  return rank(needle, items, PROVIDER_SEARCH_KEYS)
}

function sameRef(left: ModelPickerRef, right: ModelPickerRef) {
  return left.providerID === right.providerID && left.modelID === right.modelID
}

export interface BuildModelPickerOptionsInput<M extends ModelPickerModel> {
  providers: readonly ModelPickerProvider<M>[]
  favorites?: readonly ModelPickerRef[]
  recents?: readonly ModelPickerRef[]
  /** true once the user is signed in — drives the "Recommended" section */
  connected?: boolean
  /** true when the favorites/recents sections are rendered */
  showExtra?: boolean
  /** set when the dialog is scoped to a single provider */
  providerID?: string
  query?: string
  footer?: (providerID: string, model: M) => string | undefined
  onSelect?: (providerID: string, modelID: string) => void
  /** applied per provider section, before search ranking */
  sort?: (options: ModelPickerOption[]) => ModelPickerOption[]
}

export function buildModelPickerOptions<M extends ModelPickerModel>(
  input: BuildModelPickerOptionsInput<M>,
): ModelPickerOption[] {
  const favorites = input.favorites ?? []
  const recents = input.recents ?? []
  const connected = input.connected ?? false
  const showExtra = input.showExtra ?? false
  const sort = input.sort ?? ((options: ModelPickerOption[]) => options)
  const needle = (input.query ?? "").trim()

  const build = (
    provider: ModelPickerProvider<M>,
    modelID: string,
    model: M,
    extra: Partial<ModelPickerOption>,
  ): ModelPickerOption => ({
    value: { providerID: provider.id, modelID },
    title: model.name ?? modelID,
    releaseDate: model.release_date ?? "",
    disabled: provider.id === "opencode" && modelID.includes("-nano"),
    footer: input.footer?.(provider.id, model),
    providerName: provider.name,
    providerID: provider.id,
    modelID,
    onSelect: () => input.onSelect?.(provider.id, modelID),
    ...extra,
  })

  function toOptions(items: readonly ModelPickerRef[], category: string) {
    if (!showExtra) return []
    return items.flatMap((item) => {
      const provider = input.providers.find((provider) => provider.id === item.providerID)
      if (!provider) return []
      const model = provider.models[item.modelID]
      if (!model) return []
      return [build(provider, item.modelID, model, { key: item, description: provider.name, category })]
    })
  }

  const favoriteOptions = toOptions(favorites, "Favorites")
  const recentOptions = toOptions(
    recents.filter((item) => !favorites.some((favorite) => sameRef(favorite, item))),
    "Recent",
  )

  const providerOptions = pipe(
    input.providers,
    sortBy(
      (provider) => provider.id !== "opencode",
      (provider) => provider.name,
    ),
    flatMap((provider) =>
      pipe(
        provider.models,
        entries(),
        filter(([_, model]) => model.status !== "deprecated"),
        filter(([_, model]) => (input.providerID ? model.providerID === input.providerID : true)),
        map(([modelID, model]) =>
          build(provider, modelID, model, {
            description: favorites.some((item) => sameRef(item, { providerID: provider.id, modelID }))
              ? "(Favorite)"
              : undefined,
            category: connected
              ? provider.id === KILO_PROVIDER_ID && model.recommendedIndex !== undefined
                ? RECOMMENDED_CATEGORY
                : provider.name
              : undefined,
          }),
        ),
        // Favorites are pinned by hand and get their own section, so they are
        // deduped out of the provider section. Recents are not: a model must
        // stay visible under its provider (and under "Recommended") even right
        // after it was used, otherwise those sections look empty.
        filter((option) => !(showExtra && favorites.some((item) => sameRef(item, option.value)))),
        sort,
      ),
    ),
  )

  if (!needle) return [...favoriteOptions, ...recentOptions, ...providerOptions]

  // rank within each category so section headers survive filtering
  const rankedProviders = pipe(
    providerOptions,
    groupBy((option) => option.category ?? ""),
    entries(),
    flatMap(([_, items]) => rankModelOptions(needle, items)),
  )
  return [...rankModelOptions(needle, favoriteOptions), ...rankModelOptions(needle, recentOptions), ...rankedProviders]
}
