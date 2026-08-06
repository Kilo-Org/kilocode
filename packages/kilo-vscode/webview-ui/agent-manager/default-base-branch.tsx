/** @jsxImportSource solid-js */

import { createSignal, createMemo, onCleanup } from "solid-js"
import type { AgentManagerBranchesMessage, BranchInfo } from "../src/types/messages"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { BranchSelect } from "../src/components/shared/BranchSelect"
import type { useVSCode } from "../src/context/vscode"
import type { useLanguage } from "../src/context/language"
import type { Accessor, Setter } from "solid-js"

interface Deps {
  vscode: ReturnType<typeof useVSCode>
  dialog: ReturnType<typeof useDialog>
  t: ReturnType<typeof useLanguage>["t"]
  defaultBaseBranch: Accessor<string | undefined>
  setDefaultBaseBranch: (v: Parameters<Setter<string | undefined>>[0]) => void
  setRepoDetectedBranch: Setter<string | undefined>
  repoDetectedBranch: Accessor<string | undefined>
  hasConfiguredBranch: Accessor<boolean>
}

export function createChangeDefaultBaseBranch(deps: Deps) {
  const { vscode, dialog, t, defaultBaseBranch, setDefaultBaseBranch, setRepoDetectedBranch, repoDetectedBranch, hasConfiguredBranch } = deps

  return () => {
    const [search, setSearch] = createSignal("")
    const [branches, setBranches] = createSignal<BranchInfo[]>([])
    const [loading, setLoading] = createSignal(true)
    const [highlighted, setHighlighted] = createSignal(-1)

    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.branches") {
        const ev = msg as AgentManagerBranchesMessage
        setBranches(ev.branches)
        if (ev.defaultBranch) setRepoDetectedBranch(ev.defaultBranch)
        setLoading(false)
      }
    })

    vscode.postMessage({ type: "agentManager.requestBranches" })

    const filtered = createMemo(() => {
      const s = search().toLowerCase()
      if (!s) return branches()
      return branches().filter((b) => b.name.toLowerCase().includes(s))
    })

    const selectBranch = (name: string | undefined) => {
      vscode.postMessage({ type: "agentManager.setDefaultBaseBranch", branch: name })
      setDefaultBaseBranch(name)
      dialog.close()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const items = filtered()
      // offset by 1 for auto-detect option (-1 = auto-detect)
      const total = items.length + 1
      if (e.key === "ArrowDown") {
        e.preventDefault()
        e.stopPropagation()
        setHighlighted((prev) => Math.min(prev + 1, total - 2))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        setHighlighted((prev) => Math.max(prev - 1, -1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        const idx = highlighted()
        if (idx === -1) {
          selectBranch(undefined)
        } else {
          const branch = items[idx]
          if (branch) selectBranch(branch.name)
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        dialog.close()
      }
    }

    dialog.show(() => {
      onCleanup(unsub)
      return (
        <Dialog title={t("agentManager.worktree.defaultBaseBranch")} fit>
          <div class="am-default-base-branch">
            <BranchSelect
              branches={filtered()}
              loading={loading()}
              search={search()}
              onSearch={(v) => {
                setSearch(v)
                setHighlighted(-1)
              }}
              onSelect={(b) => selectBranch(b.name)}
              onSearchKeyDown={handleKeyDown}
              selected={defaultBaseBranch()}
              highlighted={highlighted()}
              onHighlight={setHighlighted}
              searchPlaceholder={t("agentManager.dialog.searchBranches")}
              emptyLabel={t("agentManager.import.noMatchingBranches")}
              loadingLabel={t("agentManager.import.loadingBranches")}
              defaultLabel={t("agentManager.dialog.branchBadge.default")}
              remoteLabel={t("agentManager.dialog.branchBadge.remote")}
              defaultName={defaultBaseBranch()}
              autoOption={{
                label: t("agentManager.worktree.defaultBaseBranchAuto"),
                hint: repoDetectedBranch(),
                active: !hasConfiguredBranch(),
                highlighted: highlighted() === -1,
                onSelect: () => selectBranch(undefined),
              }}
            />
          </div>
        </Dialog>
      )
    })
  }
}
