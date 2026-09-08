/** @jsxImportSource solid-js */
import { Show, batch, createEffect, createSignal, untrack } from "solid-js"
import type { PRStatus, WorktreeState } from "../../src/types/messages"
import { useVSCode } from "../../src/context/vscode"
import { PRPanel } from "./PRPanel"
import type { PRComment } from "./pr-types"
import { openFile, openUrl } from "./pr-panel-actions"

interface Props {
  pr: PRStatus
  projectId?: string
  worktree?: WorktreeState
  worktreeId: string
  activeTerminalId?: string
  sessionId?: string
  onOpenDiff?: (comment: PRComment) => void
  jump?: number
  onJump?: (id: number) => void
  onClose: () => void
}

interface Target {
  projectId?: string
  worktreeId: string
}

export function createPRNavigation(opts: {
  project: () => string | undefined
  active: () => string | undefined
  selection: () => string | null
  select: (target: Target) => void
  visible: () => boolean
  open: () => void
  refresh: (target: Target) => void
}) {
  const [pending, setPending] = createSignal<Target & { id: number; opened: boolean }>()
  let next = 0
  const matches = (target: Target) =>
    opts.project() === target.projectId && opts.active() === target.projectId && opts.selection() === target.worktreeId

  createEffect(() => {
    const value = pending()
    if (!value) return
    const selected = matches(value)
    if (value.opened) {
      if (!selected || !opts.visible()) setPending(undefined)
      return
    }
    if (!selected) return
    untrack(() =>
      batch(() => {
        setPending({ ...value, opened: true })
        opts.open()
        opts.refresh(value)
      }),
    )
  })

  return {
    open: (target: Target) =>
      batch(() => {
        opts.select(target)
        setPending({ ...target, id: ++next, opened: false })
      }),
    cancel: () => setPending(undefined),
    jump: () => {
      const value = pending()
      return value?.opened && matches(value) && opts.visible() ? value.id : undefined
    },
    complete: (id: number) => {
      if (pending()?.id === id) setPending(undefined)
    },
  }
}

export function PRPanelHost(props: Props) {
  const vscode = useVSCode()
  return (
    <Show when={props.pr}>
      <PRPanel
        pr={props.pr}
        projectId={props.projectId}
        worktree={props.worktree}
        worktreeId={props.worktreeId}
        activeTerminalId={props.activeTerminalId}
        jump={props.jump}
        onJump={props.onJump}
        onClose={props.onClose}
        onRefresh={() =>
          vscode.postMessage({
            type: "agentManager.refreshPR",
            projectId: props.projectId,
            worktreeId: props.worktreeId,
          })
        }
        onOpenExternal={() => openUrl(vscode.postMessage, props.worktreeId, props.pr.url)}
        onOpenFile={(file, line) => openFile(vscode.postMessage, props.sessionId, file, line)}
        onOpenDiff={props.onOpenDiff}
        onOpenUrl={(url) => openUrl(vscode.postMessage, props.worktreeId, url)}
      />
    </Show>
  )
}
