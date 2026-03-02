import { For, Show, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { BranchInfo } from "../src/types/messages"
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
  const isDefault = (name: string, branchDefault: boolean) => {
    if (props.defaultName) return name === props.defaultName
    return branchDefault
  }

  return (
    <>
      <div class="am-dropdown-search">
        <Icon name="magnifying-glass" size="small" />
        <input
          class="am-dropdown-search-input"
          type="text"
          placeholder={props.searchPlaceholder}
          value={props.search}
          autofocus
          onInput={(event) => props.onSearch(event.currentTarget.value)}
          onKeyDown={props.onSearchKeyDown}
        />
      </div>

      <div class="am-dropdown-list">
        <Show when={props.autoOption}>
          {(option) => (
            <button
              class="am-branch-item"
              classList={{
                "am-branch-item-active": option().active,
                "am-branch-item-highlighted": option().highlighted === true,
              }}
              data-index={-1}
              data-role="auto-option"
              onClick={option().onSelect}
              type="button"
            >
              <span class="am-branch-item-left">
                <Icon name="branch" size="small" />
                <span class="am-branch-item-name">{option().label}</span>
                <Show when={option().hint}>
                  <span class="am-branch-hint">{option().hint}</span>
                </Show>
              </span>
            </button>
          )}
        </Show>

        <Show
          when={props.branches.length > 0}
          fallback={
            <div class="am-dropdown-empty">
              {props.loading ? (props.loadingLabel ?? props.emptyLabel) : props.emptyLabel}
            </div>
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
                  <Show when={isDefault(branch.name, branch.isDefault)}>
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
      </div>
    </>
  )
}
