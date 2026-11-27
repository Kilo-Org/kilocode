/** @jsxImportSource solid-js */
import { Show } from "solid-js"
import type { PRStatus, WorktreeState } from "../../src/types/messages/agent-manager"
import { useBridge } from "../v2/vscode"
import { PRPanel } from "./PRPanel"
import type { PRComment } from "./pr-types"
import { openFile, openUrl } from "./pr-panel-actions"
import type { BaseUpdateTarget } from "../base-update-target"

interface Props {
  pr: PRStatus
  projectId?: string
  worktree?: WorktreeState
  worktreeId: string
  activeTerminalId?: string
  baseTarget?: BaseUpdateTarget
  onOpenDiff?: (comment: PRComment) => void
  jump?: number
  onJump?: (id: number) => void
  onClose: () => void
}

export function PRPanelHost(props: Props) {
  const vscode = useBridge()
  return (
    <Show when={props.pr}>
      <PRPanel
        pr={props.pr}
        projectId={props.projectId}
        worktree={props.worktree}
        worktreeId={props.worktreeId}
        activeTerminalId={props.activeTerminalId}
        baseTarget={props.baseTarget}
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
        onOpenFile={(file, line) => openFile(vscode.postMessage, props.worktreeId, file, line)}
        onOpenDiff={props.onOpenDiff}
        onOpenUrl={(url) => openUrl(vscode.postMessage, props.worktreeId, url)}
      />
    </Show>
  )
}
