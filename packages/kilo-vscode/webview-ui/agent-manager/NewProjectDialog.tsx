/** @jsxImportSource solid-js */

import { type Component, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../src/context/vscode"
import { useLanguage } from "../src/context/language"
import { joinPath } from "./project-utils"
import { ProjectParentField } from "./ProjectParentField"
import { validName } from "../../src/agent-manager/project/validation"

interface NewProjectDialogProps {
  onClose: () => void
}

/** Create a new local project: choose a parent folder and name, then show the destination. */
export const NewProjectDialog: Component<NewProjectDialogProps> = (props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const [parent, setParent] = createSignal("")
  const [name, setName] = createSignal("")

  const unsub = vscode.onMessage((message) => {
    if (message.type !== "agentManager.projectParent" || !message.parent) return
    setParent(message.parent)
  })
  onCleanup(unsub)
  onMount(() => vscode.postMessage({ type: "agentManager.requestProjectParent" }))

  const destination = () => (parent() && name().trim() ? joinPath(parent(), name().trim()) : "")
  const create = () => {
    if (!parent() || !validName(name().trim())) return
    vscode.postMessage({ type: "agentManager.createProject", parent: parent(), name: name().trim() })
    props.onClose()
  }

  return (
    <Dialog title={t("agentManager.project.newTitle")} fit>
      <div class="am-project-dialog">
        <div class="am-project-dialog-content">
          <label class="am-project-dialog-field">
            <span class="am-nv-config-label">{t("agentManager.project.nameLabel")}</span>
            <input
              class="am-nv-name-input"
              type="text"
              placeholder={t("agentManager.project.namePlaceholder")}
              value={name()}
              autofocus
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") create()
              }}
            />
          </label>
          <ProjectParentField parent={parent()} />
          <Show when={destination()}>
            <label class="am-project-dialog-field">
              <span class="am-nv-config-label">{t("agentManager.project.destination")}</span>
              <input class="am-nv-name-input" type="text" value={destination()} readOnly title={destination()} />
            </label>
          </Show>
        </div>
        <div class="am-project-dialog-footer">
          <Button variant="secondary" size="large" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={!parent() || !validName(name().trim())} onClick={create}>
            {t("agentManager.project.create")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
