import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { WorkspaceScopeMessage } from "../../types/messages"

type State = Record<string, unknown> & { workspaceScopeDismissed?: string }

export function WorkspaceScopeHint() {
  const vscode = useVSCode()
  const language = useLanguage()
  const [folder, setFolder] = createSignal<WorkspaceScopeMessage["folder"]>()
  const [dismissed, setDismissed] = createSignal(vscode.getState<State>()?.workspaceScopeDismissed)
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "workspaceScope") setFolder(message.folder)
  })
  onCleanup(unsubscribe)
  onMount(() => vscode.postMessage({ type: "requestWorkspaceScope" }))

  const visible = () => {
    const current = folder()
    return current && current.path !== dismissed() ? current : undefined
  }

  return (
    <Show when={visible()}>
      {(current) => (
        <div class="workspace-scope-hint" role="note">
          <div class="workspace-scope-hint-text">
            <p title={current().path}>{language.t("session.workspaceScope.description", { folder: current().name })}</p>
            <p>{language.t("session.workspaceScope.alternatives")}</p>
          </div>
          <IconButton
            icon="close"
            variant="ghost"
            size="small"
            aria-label={language.t("session.workspaceScope.dismiss")}
            title={language.t("session.workspaceScope.dismiss")}
            onClick={() => {
              const path = current().path
              setDismissed(path)
              vscode.setState({ ...vscode.getState<State>(), workspaceScopeDismissed: path })
            }}
          />
        </div>
      )}
    </Show>
  )
}
