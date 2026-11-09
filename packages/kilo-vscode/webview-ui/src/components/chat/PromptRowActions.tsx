import { Show } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"

/** The trailing "open file" and "remove" actions of a composer chip row. A missing handler hides its action. */
export function PromptRowActions(props: { onOpen?: () => void; onRemove?: () => void; disabled?: boolean }) {
  const language = useLanguage()
  return (
    <>
      <Show when={props.onOpen}>
        <Tooltip value={language.t("agentManager.diff.openFile")} placement="top">
          <IconButton
            icon="go-to-file"
            size="small"
            variant="ghost"
            aria-label={language.t("agentManager.diff.openFile")}
            onClick={() => props.onOpen?.()}
          />
        </Tooltip>
      </Show>
      <Show when={props.onRemove}>
        <button
          type="button"
          class="prompt-review-row-remove"
          onClick={() => props.onRemove?.()}
          aria-label={language.t("common.delete")}
          disabled={props.disabled}
        >
          ×
        </button>
      </Show>
    </>
  )
}
