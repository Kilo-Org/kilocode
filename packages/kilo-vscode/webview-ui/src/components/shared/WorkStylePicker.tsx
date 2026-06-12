import { For } from "solid-js"
import type { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useWorkStyle } from "../../context/work-style"
import { WORK_STYLE_CHOICES } from "../../../../src/shared/work-style-presets"

const details = ["permissions", "bash", "visibility"] as const

export const WorkStylePicker: Component = () => {
  const language = useLanguage()
  const work = useWorkStyle()

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
    </Card>
  )
}
