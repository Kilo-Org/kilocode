import { For } from "solid-js"
import type { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useWorkStyle } from "../../context/work-style"
import { WORK_STYLE_CHOICES } from "../../../../src/shared/work-style-presets"

const details = ["permissions", "visibility"] as const

export const WorkStylePicker: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const work = useWorkStyle()
  const open = (event: MouseEvent) => {
    event.preventDefault()
    vscode.postMessage({ type: "openSettingsPanel", tab: "autoApprove" })
  }

  return (
    <Card class="work-style-picker">
      <h2 data-slot="work-style-title">{language.t("workStyle.onboarding.title")}</h2>

      <div data-slot="work-style-options">
        <For each={WORK_STYLE_CHOICES}>
          {(choice) => (
            <Button
              class="work-style-mode"
              variant="ghost"
              disabled={work.applying()}
              onClick={() => work.apply(choice)}
            >
              <div data-slot="work-style-mode-copy">
                <h3 data-slot="work-style-mode-title">{language.t(`workStyle.choice.${choice}.title`)}</h3>
                <p data-slot="work-style-mode-description">{language.t(`workStyle.choice.${choice}.description`)}</p>
              </div>
              <ul data-slot="work-style-mode-details">
                <For each={details}>{(detail) => <li>{language.t(`workStyle.choice.${choice}.${detail}`)}</li>}</For>
              </ul>
            </Button>
          )}
        </For>
      </div>

      <p data-slot="work-style-settings-note">
        <span>{language.t("workStyle.onboarding.settingsNote")}</span>
        <a href="#" onClick={open}>
          <Icon name="settings-gear" size="small" />
          <span>{language.t("workStyle.onboarding.settings")}</span>
        </a>
      </p>
    </Card>
  )
}
