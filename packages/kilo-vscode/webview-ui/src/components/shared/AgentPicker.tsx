import { For, onMount } from "solid-js"
import type { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { ONBOARDING_AGENTS } from "../../../../src/shared/work-style-presets"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useWorkStyle } from "../../context/work-style"

const details = {
  code: ["default", "tasks", "changes"],
  data: ["analysis", "notebooks", "requirement"],
} as const

export const AgentPicker: Component = () => {
  const language = useLanguage()
  const vscode = useVSCode()
  const work = useWorkStyle()
  let heading: HTMLHeadingElement | undefined
  onMount(() => heading?.focus())
  const open = (event: MouseEvent) => {
    event.preventDefault()
    vscode.postMessage({ type: "openSettingsPanel", tab: "agentBehaviour" })
  }

  return (
    <Card class="onboarding-picker">
      <h2 ref={heading} tabIndex={-1} data-slot="onboarding-title">
        {language.t("workStyle.onboarding.agentTitle")}
      </h2>

      <div data-slot="onboarding-options">
        <For each={ONBOARDING_AGENTS}>
          {(agent) => (
            <Button
              class="onboarding-option"
              variant="ghost"
              disabled={work.applying()}
              onClick={() => work.complete(agent)}
            >
              <div data-slot="onboarding-option-copy">
                <h3 data-slot="onboarding-option-title">{language.t(`workStyle.agent.${agent}.title`)}</h3>
                <ul data-slot="onboarding-option-details">
                  <For each={details[agent]}>
                    {(detail) => <li>{language.t(`workStyle.agent.${agent}.${detail}`)}</li>}
                  </For>
                </ul>
              </div>
            </Button>
          )}
        </For>
      </div>

      <p data-slot="onboarding-settings-note">
        <span>{language.t("workStyle.onboarding.agentSettingsNote")}</span>
        <a href="#" onClick={open}>
          <Icon name="settings-gear" size="small" />
          <span>{language.t("workStyle.onboarding.settings")}</span>
        </a>
      </p>
    </Card>
  )
}
