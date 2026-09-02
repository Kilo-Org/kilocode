/** @jsxImportSource solid-js */

import { createMemo, createSignal, type Component } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import "./agent-manager.css"
import "./agent-manager-review.css"
import { BranchSelect } from "../src/components/shared/BranchSelect"
import { useLanguage } from "../src/context/language"
import type { BranchInfo } from "../src/types/messages"

interface Props {
  selected?: string
  detected?: string
  branches: () => BranchInfo[]
  loading: () => boolean
  onSelect: (branch?: string) => void
  onClose: () => void
}

export const ProjectBranchDialog: Component<Props> = (props) => {
  const language = useLanguage()
  const [search, setSearch] = createSignal("")
  const [highlighted, setHighlighted] = createSignal(-1)
  const filtered = createMemo(() => {
    const value = search().toLowerCase()
    const items = props.branches()
    return value ? items.filter((branch) => branch.name.toLowerCase().includes(value)) : items
  })
  const select = (branch?: string) => {
    props.onSelect(branch)
    props.onClose()
  }
  const keydown = (event: KeyboardEvent) => {
    const items = filtered()
    const total = items.length + 1
    if (event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      setHighlighted((value) => Math.min(value + 1, total - 2))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      setHighlighted((value) => Math.max(value - 1, -1))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      const index = highlighted()
      if (index === -1) {
        select()
        return
      }
      const branch = items[index]
      if (branch) select(branch.name)
      return
    }
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  return (
    <Dialog title={language.t("agentManager.worktree.defaultBaseBranch")} fit>
      <div class="am-default-base-branch">
        <BranchSelect
          branches={filtered()}
          loading={props.loading()}
          search={search()}
          onSearch={(value) => {
            setSearch(value)
            setHighlighted(-1)
          }}
          onSelect={(branch) => select(branch.name)}
          onSearchKeyDown={keydown}
          selected={props.selected}
          highlighted={highlighted()}
          onHighlight={setHighlighted}
          searchPlaceholder={language.t("agentManager.dialog.searchBranches")}
          emptyLabel={language.t("agentManager.import.noMatchingBranches")}
          loadingLabel={language.t("agentManager.import.loadingBranches")}
          defaultLabel={language.t("agentManager.dialog.branchBadge.default")}
          remoteLabel={language.t("agentManager.dialog.branchBadge.remote")}
          defaultName={props.selected ?? props.detected}
          autoOption={{
            label: language.t("agentManager.worktree.defaultBaseBranchAuto"),
            hint: props.detected,
            active: !props.selected,
            highlighted: highlighted() === -1,
            onSelect: () => select(),
          }}
        />
      </div>
    </Dialog>
  )
}
