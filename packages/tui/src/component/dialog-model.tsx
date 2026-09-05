import { createEffect, createMemo, createSignal, onCleanup } from "solid-js" // kilocode_change - scoped display metadata lifecycle
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogIntegration } from "./dialog-integration"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useData } from "../context/data"
import { modelPreferenceKey } from "../model-preference"
import { useLocation } from "../context/location"
import { useTuiApp, type TuiModelGroup } from "../context/runtime" // kilocode_change - host-owned picker presentation

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const data = useData()
  const dialog = useDialog()
  const location = useLocation()
  const presentation = useTuiApp().modelPicker // kilocode_change - do not fork native picker/preferences
  const [query, setQuery] = createSignal("")
  const favoritePriority = new Set(local.model.favorite().map(modelPreferenceKey))

  const connected = useConnected()
  const providers = createMemo(
    () => new Map((data.location.provider.list(location.ref) ?? []).map((item) => [item.id, item])),
  )
  const models = createMemo(() => data.location.model.list(location.ref) ?? [])

  // kilocode_change - refresh scoped display metadata; never retain a previous account's groups
  const [groups, setGroups] = createSignal<ReadonlyArray<TuiModelGroup>>([])
  createEffect(() => {
    const input = {
      location: location.ref,
      models: models().map((model) => ({ providerID: model.providerID, modelID: model.id })),
    }
    const controller = new AbortController()
    setGroups([])
    onCleanup(() => controller.abort())
    void presentation
      ?.groups?.(input, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setGroups(value)
      })
      .catch(() => undefined)
  })

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const model = models().find((model) => model.providerID === item.providerID && model.id === item.modelID)
        if (!model) return []
        const provider = providers().get(model.providerID)
        return [
          {
            key: item,
            value: { providerID: model.providerID, modelID: model.id },
            title: model.name,
            releaseDate: model.time.released,
            description: provider?.name ?? model.providerID,
            category,
            footer: free(model) ? "Free" : undefined,
            onSelect: () => {
              onSelect(model.providerID, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const modelOptions = sortModelOptions(
      models()
        .filter((model) => model.status !== "deprecated")
        .filter((model) => (props.providerID ? model.providerID === props.providerID : true))
        .map((model) => {
          const provider = providers().get(model.providerID)
          const key = modelPreferenceKey({ providerID: model.providerID, modelID: model.id })
          const favorite = favorites.some((item) => modelPreferenceKey(item) === key)
          // kilocode_change - display-only grouping supplied by the host
          const group = groups().find((item) => item.providerID === model.providerID && item.modelID === model.id)
          return {
            value: { providerID: model.providerID, modelID: model.id },
            providerID: model.providerID,
            providerName: provider?.name ?? model.providerID,
            title: model.name,
            releaseDate: model.time.released,
            description: favorite ? "(Favorite)" : undefined,
            category: connected() ? (group?.category ?? provider?.name ?? model.providerID) : undefined, // kilocode_change
            groupOrder: group?.order, // kilocode_change - metadata ordering, never model identity
            footer: free(model) ? "Free" : undefined,
            onSelect() {
              onSelect(model.providerID, model.id)
            },
          }
        })
        .filter((option) => {
          if (!showSections) return true
          if (
            favorites.some(
              (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
            )
          )
            return false
          if (
            recents.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID)
          )
            return false
          return true
        }),
      presentation?.preferredProviderID, // kilocode_change
    )

    if (needle) {
      return prioritizeFavorites(
        fuzzysort.go(needle, modelOptions, { keys: ["title", "category"] }).map((item) => item.obj),
        favoritePriority,
      )
    }

    return [...favoriteOptions, ...recentOptions, ...modelOptions]
  })

  const provider = createMemo(() => (props.providerID ? providers().get(props.providerID) : undefined))

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.current()
    if (cur && list.includes(cur)) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect an integration" : "View all integrations",
          selection: "none",
          onTrigger() {
            dialog.replace(() => (
              <DialogIntegration
                onConnected={(providerID) => dialog.replace(() => <DialogModel providerID={providerID} />)}
              />
            ))
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      focusCurrent={false}
    />
  )
}

export function prioritizeFavorites<T extends { value: { providerID: string; modelID: string } }>(
  options: T[],
  favorites: Set<string>,
) {
  return options.toSorted(
    (a, b) => Number(favorites.has(modelPreferenceKey(b.value))) - Number(favorites.has(modelPreferenceKey(a.value))),
  )
}

export function sortModelOptions<
  T extends {
    providerID?: string
    providerName?: string
    releaseDate: string | number
    title: string
    groupOrder?: number
  },
>(options: T[], preferredProviderID = "opencode") {
  // kilocode_change - optional host priority; preserve the upstream default
  return options.toSorted((a, b) => {
    const group = (a.groupOrder ?? Infinity) - (b.groupOrder ?? Infinity) // kilocode_change
    if (group && !Number.isNaN(group)) return group // kilocode_change
    // kilocode_change - preserve explicit model selection independently of presentation
    const provider = Number(a.providerID !== preferredProviderID) - Number(b.providerID !== preferredProviderID)
    if (provider !== 0) return provider

    const name = (a.providerName ?? "").localeCompare(b.providerName ?? "")
    if (name !== 0) return name

    const release = Number(b.releaseDate) - Number(a.releaseDate)
    if (release !== 0) return release

    return a.title.localeCompare(b.title)
  })
}

function free(model: { cost: Array<{ input: number }> }) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0)
}
