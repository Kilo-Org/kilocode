// One node of the v1 model picker tree: a group heading, the clear row, or a model row with its badges, favorite
// star and the expanded mode Select button.
import { Show, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { autoSummary, hasByok, isAuto, isDataCollectedModel, isFree, sanitizeName } from "./model-selector-utils"
import { CLEAR_KEY, groupKey, modelKey, type ModelGroup, type ModelNode, type ModelRow } from "./model-selector-tree"
import type { ModelTree } from "./model-selector-state"

export const ModelSelectorNode: Component<{
  node: ModelNode
  tree: ModelTree
  optionID: (key: string) => string
  expanded: boolean
  allowClear: boolean
  clearLabel?: string
  unset: boolean
  /** Whether rows show the favorite star. */
  stars: boolean
  dataLabel: string
}> = (props) => {
  if (props.node.kind === "group" && props.node.group) return <Heading group={props.node.group} {...props} />
  const row = props.node.row
  if (row?.kind === "clear") return <Clear {...props} />
  if (!row?.model) return null
  return <Row row={row} {...props} />
}

type Props = Parameters<typeof ModelSelectorNode>[0]

const Heading: Component<Props & { group: ModelGroup }> = (props) => {
  const key = groupKey(props.group.key)
  const shown = () => props.tree.isGroupOpen(props.group.key)
  const selected = () => props.tree.isSelected(key)
  const divided = () => props.allowClear || props.group.key !== props.tree.groups()[0]?.key
  return (
    <div
      id={props.optionID(key)}
      data-key={key}
      class={`model-selector-group-label${divided() ? " model-selector-group-label--divided" : ""}${selected() ? " selected" : ""}${selected() && !props.tree.pointer() ? " keyboard-focused" : ""}`}
      role="treeitem"
      aria-level={1}
      aria-expanded={shown()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => props.tree.toggleGroup(props.group.key)}
    >
      <svg
        class={`model-selector-group-chevron${shown() ? "" : " model-selector-group-chevron--collapsed"}`}
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4 6l4 5 4-5H4z" />
      </svg>
      <span>{props.group.label}</span>
      <Show when={!shown() && props.tree.hasSearch()}>
        <span class="model-selector-group-match-dot" aria-hidden="true" />
      </Show>
    </div>
  )
}

const Clear: Component<Props> = (props) => {
  const language = useLanguage()
  const selected = () => props.tree.isSelected(CLEAR_KEY)
  return (
    <div
      id={props.optionID(CLEAR_KEY)}
      data-key={CLEAR_KEY}
      class={`model-selector-item${selected() && !props.tree.pointer() ? " keyboard-focused" : ""}${selected() ? " selected" : ""}${props.unset ? " active" : ""}`}
      role="treeitem"
      aria-level={1}
      aria-selected={props.unset}
      onClick={() => props.tree.pickClear()}
    >
      <span class="model-selector-item-name" style={{ "font-style": "italic", opacity: 0.7 }}>
        {props.clearLabel ?? language.t("dialog.model.notSet")}
      </span>
    </div>
  )
}

const Row: Component<Props & { row: ModelRow }> = (props) => {
  const language = useLanguage()
  const tree = props.tree
  // SAFETY: ModelSelectorNode renders Row only for a row with a model.
  const model = props.row.model!
  const hovered = () => tree.isSelected(props.row.key)
  const preActive = () => tree.isPreActive(props.row.key)
  const starred = () => tree.favoriteKeys().has(modelKey(model.providerID, model.id))
  const name = sanitizeName(model.name)
  const sep = name.indexOf(": ")
  const auto = autoSummary(model)
  const starLabel = () =>
    `${starred() ? language.t("model.favorite.remove") : language.t("model.favorite.add")}: ${name}`
  return (
    <div role="presentation" class={`model-selector-row${hovered() || preActive() ? " selected" : ""}`}>
      <div
        id={props.optionID(props.row.key)}
        data-key={props.row.key}
        class={`model-selector-item${(hovered() && !tree.pointer()) || preActive() ? " keyboard-focused" : ""}${hovered() || preActive() ? " selected" : ""}${tree.chosen(props.row) ? " active" : ""}`}
        role="treeitem"
        aria-level={2}
        aria-selected={tree.chosen(props.row)}
        onClick={() => (props.expanded ? tree.preview(props.row.key) : tree.selectRow(props.row))}
        onDblClick={() => {
          if (props.expanded) tree.selectRow(props.row)
        }}
      >
        <div class="model-selector-item-left">
          <span class="model-selector-item-name">
            <Show when={sep >= 0} fallback={<span class="model-selector-item-name-main">{name}</span>}>
              <span class="model-selector-item-name-provider">{name.slice(0, sep)}</span>
              <span class="model-selector-item-name-main">{name.slice(sep + 2)}</span>
            </Show>
          </span>
          <Show when={isAuto(model)}>
            <Tooltip value={auto} placement="top">
              <span class="model-selector-auto-icon" aria-label={auto}>
                <Icon name="models" size="small" />
              </span>
            </Tooltip>
          </Show>
          <Show when={isFree(model) || hasByok(model) || isDataCollectedModel(model)}>
            <span class="model-selector-free-data">
              <Show when={isFree(model) && !hasByok(model)}>
                <span class="model-selector-data-badge">
                  <Tag data-variant="member">{language.t("model.tag.free")}</Tag>
                </span>
              </Show>
              <Show when={hasByok(model)}>
                <span class="model-selector-data-badge model-selector-data-badge--byok">
                  <Tag data-variant="member">BYOK</Tag>
                </span>
              </Show>
              <Show when={isDataCollectedModel(model)}>
                <Tooltip value={props.dataLabel} placement="top">
                  <span class="model-selector-free-data-icon" aria-label={props.dataLabel}>
                    <Icon name="book-open-check" size="small" />
                  </span>
                </Tooltip>
              </Show>
            </span>
          </Show>
          <span class="model-selector-item-provider-tag">{model.providerName}</span>
        </div>
      </div>
      <Show when={props.stars}>
        <button
          type="button"
          class={`model-selector-star${starred() ? " model-selector-star--active" : ""}`}
          aria-label={starLabel()}
          aria-pressed={starred()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            tree.toggleFavorite(model, props.row)
            tree.focusSearch()
          }}
        >
          <Icon name={starred() ? "star-filled" : "star"} size="small" />
        </button>
      </Show>
      <Show when={props.expanded && preActive() && !tree.isActive(model)}>
        <button
          type="button"
          class="model-selector-item-select-btn"
          aria-label={`${language.t("dialog.model.select")}: ${name}`}
          onClick={() => tree.selectRow(props.row)}
        >
          {language.t("dialog.model.select")}
        </button>
      </Show>
    </div>
  )
}
