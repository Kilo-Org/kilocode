/** @jsxImportSource solid-js */

import { createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { BranchSelect } from "../src/components/shared/BranchSelect"
import { useLanguage } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import type { AgentManagerBranchesMessage, BranchInfo } from "../src/types/messages"

interface Props {
  projectId: string
  selected?: string
  detected?: string
  onClose: () => void
}

export const ProjectBranchDialog: Component<Props> = (props) => {
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
    vscode.postMessage({ type: "agentManager.setDefaultBaseBranch", projectId: props.projectId, branch })
    props.onClose()
  }
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "agentManager.branches") return
    const event = message as AgentManagerBranchesMessage
    setBranches(event.branches)
    setLoading(false)
  })
  onCleanup(unsubscribe)
  onMount(() => vscode.postMessage({ type: "agentManager.requestBranches", projectId: props.projectId }))

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
          selected={props.selected}
          highlighted={highlighted()}
          onHighlight={setHighlighted}
          searchPlaceholder={t("agentManager.dialog.searchBranches")}
          emptyLabel={t("agentManager.import.noMatchingBranches")}
          loadingLabel={t("agentManager.import.loadingBranches")}
          defaultLabel={t("agentManager.dialog.branchBadge.default")}
          remoteLabel={t("agentManager.dialog.branchBadge.remote")}
          defaultName={props.selected ?? props.detected}
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
