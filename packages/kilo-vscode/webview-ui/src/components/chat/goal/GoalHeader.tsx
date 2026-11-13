import { type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../../context/language"

/** Shown above the composer in goal mode: the next send sets the session goal instead of sending a prompt. */
export const GoalHeader: Component<{ onCancel: () => void }> = (props) => {
  const language = useLanguage()
  return (
    <div class="prompt-goal-header">
      <Icon name="target" size="small" />
      <span>{language.t("prompt.goal.set")}</span>
      <Button variant="ghost" size="small" onClick={props.onCancel}>
        {language.t("common.cancel")}
      </Button>
    </div>
  )
}
