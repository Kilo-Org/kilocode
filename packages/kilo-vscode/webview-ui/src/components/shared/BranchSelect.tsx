// Reusable branch selector: search input + scrollable list with keyboard navigation

import { type Component, For, Show, createMemo, type JSXElement, type ParentProps } from "solid-js"
import type { BranchInfo } from "../../types/messages"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { formatRelativeDate } from "../../utils/date"
import { useLanguage } from "../../context/language"
import { DeferredPopover } from "./DeferredPopover"

/**
 * Maximum rows rendered at once. Large repositories can have thousands of
 * branches, and rendering all of them blocks the popover open. Search narrows
 * the list, so the cap only hides rows nobody scrolls to.
 */
export const BRANCH_LIMIT = 100

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
  footer?: JSXElement
}

type Placement = "top-start" | "bottom-start" | "bottom-end"

interface BranchSelectPopoverProps extends ParentProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: JSXElement
  /**
   * Where the popover opens relative to the trigger. Defaults to `top-start`
   * (the agent manager pattern: trigger sits near the bottom of its panel).
   * Pass `bottom-start` for triggers near the top of a view (e.g. the diff
   * viewer header).
   */
  placement?: Placement
  /**
   * Whether the popover should flip to the opposite side when there's not
   * enough room. Defaults to `false` to match the agent manager behavior.
   */
  flip?: boolean
  /** Extra class for the popover content, e.g. to set a fixed width. */
  class?: string
  /** Match the trigger width. Defaults to `true`. */
  sameWidth?: boolean
}

export const BranchSelectPopover: Component<BranchSelectPopoverProps> = (props) => (
  <DeferredPopover
    open={props.open}
    onOpenChange={props.onOpenChange}
    placement={props.placement ?? "top-start"}
    flip={props.flip ?? false}
    sameWidth={props.sameWidth ?? true}
    portal={false}
    deferDismiss
    class={props.class ? `am-dropdown ${props.class}` : "am-dropdown"}
    trigger={props.trigger}
  >
    {props.children}
  </DeferredPopover>
)

export const BranchSelect: Component<BranchSelectProps> = (props) => {
  const { t } = useLanguage()
  const isDefault = (branch: BranchInfo) => {
    if (props.defaultName) return branch.name === props.defaultName
    return branch.isDefault
  }
  const visible = createMemo(() => props.branches.slice(0, BRANCH_LIMIT))
  const more = () => props.branches.length - visible().length

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
          <For each={visible()}>
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
          <Show when={more() > 0}>
            <div class="am-dropdown-more">{t("agentManager.dialog.moreBranches", { count: more() })}</div>
          </Show>
        </Show>
        <Show when={props.loading && props.branches.length === 0 && !props.autoOption}>
          <div class="am-dropdown-empty">
            <Spinner class="am-setup-spinner" />
            <span>{props.loadingLabel}</span>
          </div>
        </Show>
      </div>
      <Show when={props.footer}>
        <div class="am-dropdown-footer">{props.footer}</div>
      </Show>
    </>
  )
}
