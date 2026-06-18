/**
 * Kilo-specific dialog for creating a new git worktree workspace.
 *
 * Mirrors the VS Code extension's NewWorktreeDialog flow: the user picks
 * (or types) a base branch and we create a `worktree`-typed workspace via
 * the existing `/experimental/workspace` endpoint, then activate it.
 */

// kilocode_change - new file

import { createMemo, createResource, createSignal, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useProject } from "@tui/context/project"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { errorMessage } from "@/util/error"

type BranchOption = { name: string; kind: "current" | "default" | "custom" }

function uniqueBranches(list: (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    if (!raw) continue
    const name = String(raw).trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function DialogWorktreeCreate() {
  const dialog = useDialog()
  const sdk = useSDK()
  const project = useProject()
  const route = useRoute()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const [filter, setFilter] = createSignal("")

  const [vcs] = createResource(async () => {
    const result = await sdk.client.vcs.get().catch(() => undefined)
    return result?.data
  })

  const branchOptions = createMemo<BranchOption[]>(() => {
    const info = vcs()
    const current = info?.branch
    const def = info?.default_branch
    return uniqueBranches([current, def]).map((name, i) => ({
      name,
      kind: i === 0 ? "current" : "default",
    }))
  })

  const customBranch = createMemo(() => filter().trim())

  const options = createMemo<DialogSelectOption<BranchOption>[]>(() => {
    const out: DialogSelectOption<BranchOption>[] = branchOptions().map((branch) => ({
      title: branch.name,
      value: branch,
      description: branch.kind === "current" ? "current branch" : "default branch",
      category: "Base branch",
    }))
    const typed = customBranch()
    if (typed && !out.some((opt) => opt.value.name === typed)) {
      out.push({
        title: typed,
        value: { name: typed, kind: "custom" },
        description: "create from typed branch",
        category: "Custom",
      })
    }
    return out
  })

  async function create(branch: string) {
    if (busy()) return
    setBusy(true)
    const result = await sdk.client.experimental.workspace
      .create({ type: "worktree", branch })
      .catch(() => undefined)
    setBusy(false)
    if (!result?.data || result.error) {
      toast.show({
        message: `Failed to create worktree: ${errorMessage(result?.error ?? "no response")}`,
        variant: "error",
      })
      return
    }
    const workspace = result.data
    await project.workspace.sync().catch(() => undefined)
    project.workspace.set(workspace.id)
    dialog.clear()
    route.navigate({ type: "home" })
    toast.show({ message: `Created worktree: ${workspace.name ?? branch}`, variant: "info" })
  }

  return (
    <Show
      when={!busy()}
      fallback={
        <box paddingLeft={4} paddingRight={4}>
          <text>Creating worktree…</text>
        </box>
      }
    >
      <DialogSelect<BranchOption>
        title="New worktree"
        options={options()}
        placeholder="Select a base branch or type a new one"
        onFilter={(q) => setFilter(q)}
        onSelect={(option) => {
          const branch = option.value?.name
          if (!branch) return
          void create(branch)
        }}
      />
    </Show>
  )
}
