import { For } from "solid-js"
import { ShortcutKeys } from "../components/shared/ShortcutKeys"
import { useLanguage } from "../context/language"
import { sendShortcuts } from "./pending-actions"

/** The send shortcuts of a running session as keycaps. The textarea keeps the plain placeholder for screen readers. */
export function RunningHint() {
  const language = useLanguage()
  const keys = sendShortcuts()
  const items = [
    { binding: keys.steer, label: language.t("prompt.hint.steer") },
    { binding: keys.queue, label: language.t("prompt.hint.queue") },
    { binding: keys.now, label: language.t("prompt.hint.stopAndSend") },
  ]
  return (
    <div class="prompt-input-placeholder" aria-hidden="true">
      <For each={items}>
        {(item, index) => (
          <>
            {index() > 0 ? " · " : ""}
            <span class="prompt-input-keys-wrap">
              <ShortcutKeys binding={item.binding} /> {item.label}
            </span>
          </>
        )}
      </For>
    </div>
  )
}
