// Reusable branch selector: search input + scrollable list with keyboard navigation

import { type Component, For, Show } from "solid-js"
import type { BranchInfo } from "../src/types/messages"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { formatRelativeDate } from "../src/utils/date"

interface AutoOption {
  label: string
  hint?: string
  active: boolean
  highlighted?: boolean
  onSelect: () => void
}

interface BranchSelectProps {
  branches: BranchInfo[]
  loading?: boolean
  search: string
  onSearch: (value: string) => void
  onSelect: (branch: BranchInfo) => void
  onSearchKeyDown?: (event: KeyboardEvent) => void
  selected?: string
  highlighted?: number
  onHighlight?: (index: number) => void
  defaultName?: string
  searchPlaceholder: string
  loadingLabel?: string
  emptyLabel: string
  defaultLabel: string
  remoteLabel: string
  autoOption?: AutoOption
}

export const BranchSelect: Component<BranchSelectProps> = (props) => {
  const isDefault = (branch: BranchInfo) => {
    if (props.defaultName) return branch.name === props.defaultName
    return branch.isDefault
  }

  return (
    <>
      <div class="am-dropdown-search">
        <Icon name="magnifying-glass" size="small" />
        <input
          data-autofocus
          class="am-dropdown-search-input"
          type="text"
          placeholder={props.searchPlaceholder}
          value={props.search}
          onInput={(e) => props.onSearch(e.currentTarget.value)}
          onKeyDown={(e) => props.onSearchKeyDown?.(e)}
        />
      </div>
      <div class="am-dropdown-list">
        <Show when={props.autoOption}>
          {(opt) => (
            <button
              class="am-branch-item"
              classList={{
                "am-branch-item-active": opt().active,
                "am-branch-item-highlighted": opt().highlighted,
              }}
              data-index="auto"
              onClick={() => opt().onSelect()}
              type="button"
            >
              <span class="am-branch-item-left">
                <Icon name="branch" size="small" />
                <span class="am-branch-item-name">{opt().label}</span>
              </span>
              <Show when={opt().hint}>
                <span class="am-branch-hint">{opt().hint}</span>
              </Show>
            </button>
          )}
        </Show>
        <Show
          when={props.branches.length > 0}
          fallback={
            <Show when={!props.autoOption}>
              <div class="am-dropdown-empty">
                {props.loading ? (props.loadingLabel ?? props.emptyLabel) : props.emptyLabel}
              </div>
            </Show>
          }
        >
          <For each={props.branches}>
            {(branch, index) => (
              <button
                class="am-branch-item"
                classList={{
                  "am-branch-item-active": props.selected === branch.name,
                  "am-branch-item-highlighted": props.highlighted === index(),
                }}
                data-index={index()}
                onClick={() => props.onSelect(branch)}
                onMouseEnter={() => props.onHighlight?.(index())}
                type="button"
              >
                <span class="am-branch-item-left">
                  <Icon name="branch" size="small" />
                  <span class="am-branch-item-name">{branch.name}</span>
                  <Show when={isDefault(branch)}>
                    <span class="am-branch-badge">{props.defaultLabel}</span>
                  </Show>
                  <Show when={!branch.isLocal && branch.isRemote}>
                    <span class="am-branch-badge am-branch-badge-remote">{props.remoteLabel}</span>
                  </Show>
                </span>
                <Show when={branch.lastCommitDate}>
                  <span class="am-branch-item-time">{formatRelativeDate(branch.lastCommitDate!)}</span>
                </Show>
              </button>
            )}
          </For>
        </Show>
        <Show when={props.loading && props.branches.length === 0 && !props.autoOption}>
          <div class="am-dropdown-empty">
            <Spinner class="am-setup-spinner" />
            <span>{props.loadingLabel}</span>
          </div>
        </Show>
      </div>
    </>
  )
}
