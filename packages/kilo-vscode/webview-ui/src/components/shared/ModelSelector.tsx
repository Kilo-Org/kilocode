/**
 * ModelSelector component
 * Popover-based selector for choosing a provider/model in the chat prompt area.
 *
 * ModelSelectorBase is the v1 picker over the native v2 model catalog: favorites, Auto, Recommended and Most used
 * groups, the v1 search ranking, keyboard model, expanded preview and badges. The Kilo Gateway metadata comes from the
 * `kilocode.gateway` `models` RPC (`gateway` prop); favorites, recents and usage come from the optional model
 * preferences context. The tree state is in model-selector-state.ts, the rows in ModelSelectorRow.tsx and the v2 chat
 * binding in v2/selectors.tsx.
 */

import { createSignal, createMemo, createEffect, createUniqueId, onCleanup, Show } from "solid-js"
import type { Component } from "solid-js"
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { Virtualizer } from "virtua/solid"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { useModelPreferences } from "../../context/model-preferences"
import { useVSCode } from "../../context/vscode"
import type { KiloModelEntry } from "../../v2/kilo-models"
import { pickerModels } from "./model-selector-filter"
import { isDataCollectedModel, freeDataLabel, buildTriggerLabel, toPickerModels } from "./model-selector-utils"
import { createModelTree, dragSplitter } from "./model-selector-state"
import { ModelSelectorNode } from "./ModelSelectorRow"
import { ModelPreview } from "./ModelPreview"

export type ModelValue = { providerID: string; modelID: string }

export interface ModelSelectorBaseProps {
  /** The location catalog; undefined while it loads. */
  models: ModelInfo[] | undefined
  providers: ProviderInfo[] | undefined
  /** Kilo Gateway metadata by model id: order, badges, description. Without it Gateway rows show no Gateway data. */
  gateway?: ReadonlyMap<string, KiloModelEntry>
  /** Current selection (null = nothing selected) */
  value: ModelValue | null
  /** Called when the user picks a model */
  onSelect: (providerID: string, modelID: string) => void
  /** Called after a pick closes the popover */
  onPick?: () => void
  /** Called after Escape closes the popover without picking */
  onCancel?: () => void
  /** Popover placement — defaults to "top-start" */
  placement?: "top-start" | "bottom-start" | "bottom-end" | "top-end"
  /** Allow clearing the selection (shows a "Not set" option) */
  allowClear?: boolean
  /** Label shown for the clear option */
  clearLabel?: string
  /** Include the kilo-auto/small model in the list — defaults to false */
  includeAutoSmall?: boolean
  /** Show favorites group and favorite buttons — defaults to true. */
  favorites?: boolean
  descriptionRenderer?: Component<{ text: string }>
  /** Delay outside dismissal while the popover opens inside a dialog. */
  deferDismiss?: boolean
  /** Render inline instead of through a portal when nested in a dialog. */
  portal?: boolean
  /** Accessible purpose of this model setting or selector. */
  label?: string
  /** Additional accessible context for this model setting. */
  description?: string
  /** Only respond to picker events from this prompt scope. */
  trigger?: string
  /** Disable this prompt-scoped selector while a permission owns the prompt. */
  blocked?: boolean
  /** Trigger text when nothing is selected. Defaults to the "Select model" prompt label. */
  placeholder?: string
  /** Why the Kilo Gateway catalog failed to load, shown when no model is usable. */
  failure?: string
  /**
   * Force the compact list layout. Used by inline `@` model references, where
   * there is no current model for the preview pane and picking is a one-click,
   * insert-only action. The persisted chat-selector preference is not changed.
   */
  collapsed?: boolean
}

export const ModelSelectorBase: Component<ModelSelectorBaseProps> = (props) => {
  const language = useLanguage()
  const vscode = useVSCode()
  // The preferences are optional, as v1's session context: a picker without them shows no favorites or most used.
  const prefs = useModelPreferences()
  const stars = () => !!prefs && props.favorites !== false
  const uid = createUniqueId()
  const listID = `${uid}-models`
  const previewID = `${uid}-preview`
  const descriptionID = `${uid}-description`
  const optionID = (key: string) => `${uid}-option-${encodeURIComponent(key)}`
  // Enabled, not deprecated models; the Gateway small model only for its own row.
  const usable = createMemo(() => pickerModels(props.models ?? [], props.includeAutoSmall))
  const activeModel = createMemo(() => {
    const model = (props.models ?? []).find((m) => m.providerID === props.value?.providerID && m.id === props.value?.modelID)
    return model ? toPickerModels([model], props.providers, props.gateway)[0] : undefined
  })

  const [open, setOpen] = createSignal(false)
  // The host-persisted expand preference; inline `@` references force the compact layout and never touch it.
  const expanded = () => !props.collapsed && vscode.getModelSelectorExpanded()
  const [previewHeight, setPreviewHeight] = createSignal(500)
  const refs: { wrapper?: HTMLDivElement; splitter?: HTMLDivElement; body?: HTMLDivElement } = {}
  const chrome = () => (refs.wrapper?.offsetHeight ?? 0) + (refs.splitter?.offsetHeight ?? 0)

  // Only connected providers and the Kilo Gateway, built only while open; the trigger needs no closed catalog.
  const visibleModels = createMemo(() => (open() ? toPickerModels(usable(), props.providers, props.gateway) : []))
  const hasProviders = createMemo(() => usable().length > 0)
  const canOpen = () => hasProviders() || ((props.allowClear ?? false) && !!props.value)

  const tree = createModelTree({
    open,
    visible: visibleModels,
    active: activeModel,
    value: () => props.value,
    allowClear: () => props.allowClear ?? false,
    favorites: () => (stars() ? prefs?.favorites() : undefined),
    usage: () => prefs?.usage(),
    recents: () => prefs?.recents(),
    labels: () => ({
      favorites: language.t("model.group.favorites"),
      auto: language.t("model.group.auto"),
      recommended: language.t("model.group.recommended"),
      mostUsed: language.t("model.group.mostUsed"),
    }),
    toggleFavorite: (providerID, modelID) => prefs?.toggleFavorite(providerID, modelID),
    onSelect: (providerID, modelID) => props.onSelect(providerID, modelID),
    close() {
      setOpen(false)
      props.onPick?.()
    },
    cancel,
  })

  function cancel() {
    if (!open()) return
    setOpen(false)
    props.onCancel?.()
  }

  // Registered before the popover mounts, so a slash-command open restores the prompt before the popover's Escape.
  const onTrigger = (event: Event) => {
    const source = (event as CustomEvent<{ source?: string }>).detail?.source
    if (source !== props.trigger || props.blocked) return
    setOpen(true)
  }
  const onEscape = (e: KeyboardEvent) => {
    if (!open() || e.key !== "Escape") return
    e.preventDefault()
    e.stopImmediatePropagation()
    cancel()
  }
  createEffect(() => {
    if (props.blocked) {
      setOpen(false)
      return
    }
    window.addEventListener("openModelPicker", onTrigger)
    window.addEventListener("keydown", onEscape, true)
    onCleanup(() => {
      window.removeEventListener("openModelPicker", onTrigger)
      window.removeEventListener("keydown", onEscape, true)
    })
  })

  // With no usable model, the catalog reason explains more than a selection that cannot resolve.
  const failure = () => (!activeModel() && props.models && !hasProviders() ? props.failure : undefined)
  const triggerLabel = () =>
    failure() ??
    buildTriggerLabel(
      activeModel()?.name,
      activeModel()?.providerID,
      props.value,
      props.allowClear ?? false,
      props.clearLabel ?? "",
      // While the catalog loads, show the prompt instead of "No providers".
      hasProviders() || !props.models,
      {
        select: props.placeholder ?? language.t("dialog.model.select.title"),
        noProviders: language.t("dialog.model.noProviders"),
        notSet: language.t("dialog.model.notSet"),
      },
    )
  const label = () => props.label ?? language.t("dialog.model.select.title")
  const controlLabel = () => `${label()}: ${triggerLabel()}`
  const searchLabel = () => `${controlLabel()}. ${language.t("dialog.model.search.placeholder")}`
  const describedBy = () => (props.description ? descriptionID : undefined)
  const dataLabel = () => freeDataLabel(language.t("model.tag.free"), language.t("model.tag.dataCollected"))
  const activeCollectsData = () => {
    const model = activeModel()
    return !!model && isDataCollectedModel(model)
  }
  const preview = () => tree.previewModel() ?? activeModel() ?? null
  const activeOptionID = () =>
    tree.browsing() && tree.nodeMap().has(tree.selectedKey()) ? optionID(tree.selectedKey()) : undefined
  const toggleExpanded = () => {
    if (expanded()) tree.clearPreview()
    if (!props.collapsed) vscode.setModelSelectorExpanded(!expanded())
    requestAnimationFrame(() => {
      tree.focusSearch()
      tree.scrollToSelection()
    })
  }

  return (
    <>
      <Show when={props.description}>
        <span id={descriptionID} class="model-selector-assistive">
          {props.description}
        </span>
      </Show>
      <Tooltip value={activeModel()?.id ?? ""} placement="top" openDelay={0} inactive={!activeModel()}>
        <PopupSelector
          expanded={expanded()}
          preferredWidth={350}
          preferredExpandedWidth={450}
          preferredHeight={300}
          preferredExpandedHeight={800}
          minHeight={200}
          placement={props.placement ?? "top-start"}
          deferDismiss={props.deferDismiss}
          portal={props.portal}
          open={open()}
          onOpenChange={(value) => {
            if (value && props.blocked) return
            setOpen(value)
          }}
          triggerAs={Button}
          triggerProps={{
            variant: "secondary",
            size: "normal",
            get disabled() {
              return props.blocked || !canOpen()
            },
            get ["aria-label"]() {
              return controlLabel()
            },
            get ["aria-describedby"]() {
              return describedBy()
            },
          }}
          trigger={
            <>
              {/* Keyed so the label remounts on change and the prompt pill can animate it. */}
              <Show when={triggerLabel()} keyed>
                {(label) => (
                  // The trigger truncates a long reason; the native title shows all of it.
                  <span class="model-selector-trigger-label" title={failure()}>
                    {label}
                  </span>
                )}
              </Show>
              <Show when={activeCollectsData()}>
                <Tooltip value={dataLabel()} placement="top" openDelay={0}>
                  <span class="model-selector-trigger-free-data" aria-label={dataLabel()}>
                    <Icon name="book-open-check" size="small" />
                  </span>
                </Tooltip>
              </Show>
              <svg
                class="model-selector-trigger-chevron"
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M8 4l4 5H4l4-5z" />
              </svg>
            </>
          }
          class={`model-selector-popover${expanded() ? " model-selector-popover--expanded" : ""}`}
        >
          {(bodyH) => {
            createEffect(() => {
              if (!expanded()) return
              const h = bodyH()
              if (h === undefined) return
              setPreviewHeight((h - chrome()) / 2)
            })
            return (
              <div
                onKeyDown={tree.handleKeyDown}
                class={`model-selector-body${expanded() ? " model-selector-body--expanded" : ""}`}
                style={{ height: `${bodyH()}px` }}
                ref={(el) => (refs.body = el)}
              >
                <div class="model-selector-search-wrapper" ref={(el) => (refs.wrapper = el)}>
                  <input
                    ref={tree.setSearchRef}
                    data-autofocus
                    class="model-selector-search"
                    type="text"
                    role="combobox"
                    aria-label={searchLabel()}
                    aria-describedby={describedBy()}
                    aria-autocomplete="list"
                    aria-haspopup="tree"
                    aria-expanded={open()}
                    aria-controls={listID}
                    aria-activedescendant={activeOptionID()}
                    placeholder={language.t("dialog.model.search.placeholder")}
                    value={tree.search()}
                    onInput={(e) => tree.input(e.currentTarget.value)}
                    onMouseDown={(e) => {
                      const input = e.currentTarget
                      if (input.selectionStart !== input.selectionEnd || input.selectionStart !== input.value.length)
                        tree.caret()
                    }}
                  />
                  <Show when={!props.collapsed}>
                    <Tooltip
                      value={expanded() ? language.t("dialog.model.collapse") : language.t("dialog.model.expand")}
                      placement="top"
                    >
                      <IconButton
                        icon={expanded() ? "collapse" : "expand"}
                        size="small"
                        variant="ghost"
                        aria-label={
                          expanded() ? language.t("dialog.model.collapse") : language.t("dialog.model.expand")
                        }
                        aria-expanded={expanded()}
                        aria-controls={previewID}
                        onClick={toggleExpanded}
                      />
                    </Tooltip>
                  </Show>
                </div>

                <div
                  id={listID}
                  class="model-selector-list"
                  role="tree"
                  aria-label={label()}
                  ref={tree.setListRef}
                  onMouseMove={tree.pointerMove}
                >
                  <Show when={tree.groups().length === 0}>
                    <div class="model-selector-empty" role="status" aria-live="polite">
                      {language.t("dialog.model.empty")}
                    </div>
                  </Show>

                  <Show when={tree.nodes().length > 0}>
                    <Virtualizer
                      ref={tree.setVirtualizer}
                      data={tree.nodes()}
                      keepMounted={tree.mounted()}
                      bufferSize={120}
                      itemSize={30}
                    >
                      {(node) => (
                        <ModelSelectorNode
                          node={node}
                          tree={tree}
                          optionID={optionID}
                          expanded={expanded()}
                          allowClear={props.allowClear ?? false}
                          clearLabel={props.clearLabel}
                          unset={!props.value?.providerID}
                          stars={stars()}
                          dataLabel={dataLabel()}
                        />
                      )}
                    </Virtualizer>
                  </Show>
                </div>

                <Show when={expanded()}>
                  <div
                    class="model-selector-splitter"
                    ref={(el) => (refs.splitter = el)}
                    onPointerDown={(e) =>
                      dragSplitter(e, previewHeight(), setPreviewHeight, () =>
                        refs.body ? refs.body.offsetHeight - chrome() - 80 : undefined,
                      )
                    }
                  />
                </Show>
                <div
                  id={previewID}
                  aria-hidden={!expanded()}
                  class={`model-selector-preview${expanded() ? " model-selector-preview--visible" : ""}`}
                  style={expanded() ? { height: `${previewHeight()}px` } : {}}
                >
                  <Show when={expanded()}>
                    <ModelPreview model={preview()} models={visibleModels()} favorites={stars()} description={props.descriptionRenderer} />
                  </Show>
                </div>
              </div>
            )
          }}
        </PopupSelector>
      </Tooltip>
    </>
  )
}
