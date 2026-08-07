/** @jsxImportSource solid-js */

import { createMemo, createSignal, onCleanup, type Component } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { BranchSelect } from "../src/components/shared/BranchSelect"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { AgentManagerBranchesMessage, BranchInfo } from "../src/types/messages"

interface Props {
  selected?: string
  detected?: string
  onSelect: (branch?: string) => void
  onDetected: (branch: string) => void
  onClose: () => void
}

export const DefaultBaseBranchDialog: Component<Props> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const [search, setSearch] = createSignal("")
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [loading, setLoading] = createSignal(true)
  const [highlighted, setHighlighted] = createSignal(-1)
  const filtered = createMemo(() => {
    const value = search().toLowerCase()
    return value ? branches().filter((branch) => branch.name.toLowerCase().includes(value)) : branches()
  })
  const select = (branch?: string) => {
    vscode.postMessage({ type: "agentManager.setDefaultBaseBranch", branch })
    props.onSelect(branch)
    props.onClose()
  }
  const unsub = vscode.onMessage((message) => {
    if (message.type !== "agentManager.branches") return
    const event = message as AgentManagerBranchesMessage
    setBranches(event.branches)
    if (event.defaultBranch) props.onDetected(event.defaultBranch)
    setLoading(false)
  })
  onCleanup(unsub)
  vscode.postMessage({ type: "agentManager.requestBranches" })

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
    <Dialog title={t("agentManager.worktree.defaultBaseBranch")} fit>
      <div class="am-default-base-branch">
        <BranchSelect
          branches={filtered()}
          loading={loading()}
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
          searchPlaceholder={t("agentManager.dialog.searchBranches")}
          emptyLabel={t("agentManager.import.noMatchingBranches")}
          loadingLabel={t("agentManager.import.loadingBranches")}
          defaultLabel={t("agentManager.dialog.branchBadge.default")}
          remoteLabel={t("agentManager.dialog.branchBadge.remote")}
          defaultName={props.selected}
          autoOption={{
            label: t("agentManager.worktree.defaultBaseBranchAuto"),
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
