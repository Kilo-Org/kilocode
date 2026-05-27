import { type Component, createMemo, createSignal, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { BranchSelect, BranchSelectPopover } from "../src/components/shared/BranchSelect"
import type { BranchInfo } from "../src/types/messages"
import { useLanguage } from "../src/context/language"

interface BaseBranchPickerProps {
  branches: BranchInfo[]
  loading: boolean
  defaultBranch: string
  autoBase: string | undefined
  currentBase: string | undefined
  isAuto: boolean
  /** Currently checked-out branch (HEAD). Hidden when undefined. */
  currentBranch: string | undefined
  onSelect: (branch: string | undefined) => void
}

/**
 * Compact branch picker for the diff viewer header. Lets the user override
 * the base branch the workspace source diffs against. Selecting "Default"
 * clears the override and falls back to the auto-resolved tracking/default
 * branch.
 */
export const BaseBranchPicker: Component<BaseBranchPickerProps> = (props) => {
  const { t } = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [highlight, setHighlight] = createSignal(0)

  const filtered = createMemo<BranchInfo[]>(() => {
    const q = search().trim().toLowerCase()
    if (!q) return props.branches
    return props.branches.filter((b) => b.name.toLowerCase().includes(q))
  })

  const close = () => {
    setOpen(false)
    setSearch("")
    setHighlight(0)
  }

  const choose = (branch: string | undefined) => {
    props.onSelect(branch)
    close()
  }

  const triggerLabel = () => props.currentBase ?? t("diffViewer.baseBranch.none")

  // Keyboard nav: ArrowDown/ArrowUp moves highlight; index -1 is the auto
  // option; 0..n-1 is the branch list.
  const onKeyDown = (e: KeyboardEvent) => {
    const items = filtered()
    const max = items.length - 1
    if (e.key === "ArrowDown") {
      e.preventDefault()
      const cur = highlight()
      setHighlight(cur === -1 ? 0 : Math.min(cur + 1, max))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const cur = highlight()
      setHighlight(cur <= 0 ? -1 : cur - 1)
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (highlight() === -1) {
        choose(undefined)
        return
      }
      const selected = items[highlight()]
      if (selected) choose(selected.name)
    } else if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  }

  return (
    <span class="diff-base-picker">
      <Show when={props.currentBranch}>
        <span class="diff-base-current" title={props.currentBranch}>
          <span class="diff-base-current-name">{props.currentBranch}</span>
        </span>
        <span class="diff-base-arrow" aria-hidden="true">
          →
        </span>
      </Show>
      <BranchSelectPopover
        open={open()}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) {
            setSearch("")
            setHighlight(0)
          }
        }}
        placement="bottom-start"
        flip
        trigger={
          <button class="am-selector-trigger diff-base-trigger" type="button">
            <span class="am-selector-left">
              <Show when={!props.currentBranch}>
                <Icon name="branch" size="small" />
              </Show>
              <span class="am-selector-value">{triggerLabel()}</span>
              <Show when={props.isAuto}>
                <span class="am-branch-badge">{t("diffViewer.baseBranch.default")}</span>
              </Show>
            </span>
            <span class="am-selector-right">
              <Icon name="selector" size="small" />
            </span>
          </button>
        }
      >
        <BranchSelect
          branches={filtered()}
          loading={props.loading}
          search={search()}
          onSearch={(v) => {
            setSearch(v)
            setHighlight(0)
          }}
          onSelect={(b) => choose(b.name)}
          onSearchKeyDown={onKeyDown}
          selected={props.currentBase}
          highlighted={highlight() >= 0 ? highlight() : undefined}
          onHighlight={setHighlight}
          defaultName={props.defaultBranch}
          searchPlaceholder={t("diffViewer.baseBranch.search")}
          emptyLabel={t("diffViewer.baseBranch.empty")}
          loadingLabel={t("diffViewer.baseBranch.loading")}
          defaultLabel={t("diffViewer.baseBranch.default")}
          remoteLabel={t("diffViewer.baseBranch.remote")}
          autoOption={{
            label: t("diffViewer.baseBranch.auto"),
            hint: props.autoBase,
            active: props.isAuto,
            highlighted: highlight() === -1,
            onSelect: () => choose(undefined),
          }}
        />
      </BranchSelectPopover>
    </span>
  )
}
