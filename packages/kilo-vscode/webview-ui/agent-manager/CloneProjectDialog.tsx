/** @jsxImportSource solid-js */

import { type Component, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../src/context/vscode"
import { useLanguage } from "../src/context/language"
import { joinPath, repoName } from "./project-utils"
import { ProjectParentField } from "./ProjectParentField"

interface CloneProjectDialogProps {
  /** Roots already attached to Agent Manager, used for the "already added" hint. */
  roots?: string[]
  onClose: () => void
}

/** Clone a repository: choose a URL and parent folder, then show the destination. */
export const CloneProjectDialog: Component<CloneProjectDialogProps> = (props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const [parent, setParent] = createSignal("")
  const [url, setUrl] = createSignal("")

  const unsub = vscode.onMessage((message) => {
    if (message.type !== "agentManager.projectParent" || !message.parent) return
    setParent(message.parent)
  })
  onCleanup(unsub)
  onMount(() => vscode.postMessage({ type: "agentManager.requestProjectParent" }))

  const destination = () => {
    const name = repoName(url())
    return parent() && name ? joinPath(parent(), name) : ""
  }
  const added = () => Boolean(destination()) && (props.roots ?? []).includes(destination())
  const clone = () => {
    if (!parent() || !url().trim()) return
    vscode.postMessage({ type: "agentManager.cloneProject", url: url().trim(), parent: parent() })
    props.onClose()
  }

  return (
    <Dialog title={t("agentManager.project.cloneTitle")} fit>
      <div class="am-project-dialog">
        <div class="am-project-dialog-content">
          <label class="am-project-dialog-field">
            <span class="am-nv-config-label">{t("agentManager.project.urlLabel")}</span>
            <input
              class="am-nv-name-input"
              type="text"
              placeholder={t("agentManager.project.urlPlaceholder")}
              value={url()}
              autofocus
              onInput={(event) => setUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") clone()
              }}
            />
          </label>
          <ProjectParentField parent={parent()} />
          <Show when={destination()}>
            <label class="am-project-dialog-field">
              <span class="am-nv-config-label">{t("agentManager.project.destination")}</span>
              <input class="am-nv-name-input" type="text" value={destination()} readOnly title={destination()} />
            </label>
            <Show when={added()}>
              <p class="am-project-dialog-note">{t("agentManager.project.alreadyAdded")}</p>
            </Show>
          </Show>
        </div>
        <div class="am-project-dialog-footer">
          <Button variant="secondary" size="large" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={!parent() || !url().trim()} onClick={clone}>
            {t("agentManager.project.cloneTitle")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
