/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useVSCode } from "../src/context/vscode"
import { useLanguage } from "../src/context/language"

interface ProjectParentFieldProps {
  parent: string
}

/** Read-only parent folder field with a native folder picker trigger. */
export const ProjectParentField: Component<ProjectParentFieldProps> = (props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  return (
    <div class="am-project-dialog-field">
      <span class="am-nv-config-label">{t("agentManager.project.parentLabel")}</span>
      <div class="am-project-dialog-parent">
        <input class="am-nv-name-input" type="text" value={props.parent} readOnly />
        <Button
          variant="secondary"
          size="small"
          class="am-project-dialog-browse"
          onClick={() =>
            vscode.postMessage({ type: "agentManager.pickProjectParent", defaultPath: props.parent || undefined })
          }
        >
          {t("agentManager.project.browse")}
        </Button>
      </div>
    </div>
  )
}
