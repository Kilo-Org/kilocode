import { Show, type Component } from "solid-js"
import { useLanguage } from "../../context/language"

interface PromptShowMoreProps {
  hidden: number
  all: boolean
  onToggle: () => void
}

/** Shared "show more/less" toggle for prompt attachment lists. */
export const PromptShowMore: Component<PromptShowMoreProps> = (props) => {
  const language = useLanguage()
  return (
    <Show when={props.hidden > 0}>
      <button type="button" class="prompt-review-more" onClick={() => props.onToggle()}>
        {props.all
          ? language.t("agentManager.review.showLess")
          : language.t("agentManager.review.showMore", { count: props.hidden })}
      </button>
    </Show>
  )
}
