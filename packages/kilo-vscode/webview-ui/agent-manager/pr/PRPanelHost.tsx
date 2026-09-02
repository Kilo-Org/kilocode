/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import type { PRStatus, WorktreeState } from "../../src/types/messages"
import { useVSCode } from "../../src/context/vscode"
import { PRPanel } from "./PRPanel"
import { openFile, openUrl } from "./pr-panel-actions"

interface Props {
  pr: PRStatus
  projectId?: string
  worktree?: WorktreeState
  worktreeId: string
  activeTerminalId?: string
  sessionId?: string
  onClose: () => void
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
        onClose={props.onClose}
        onOpenExternal={() => openUrl(vscode.postMessage, props.worktreeId, props.pr.url)}
        onOpenFile={(file, line) => openFile(vscode.postMessage, props.sessionId, file, line)}
        onOpenUrl={(url) => openUrl(vscode.postMessage, props.worktreeId, url)}
      />
    </Show>
  )
}
