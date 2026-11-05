// Prompts queued for after the running turn, as a compact list above the composer. They stay out of the transcript, so
// the live response keeps its place at the bottom of the scroll area however many prompts wait.
import type { UserMessagePending } from "@kilocode/kilo-ui/message-part"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { createSignal, For, Show } from "solid-js"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"

export function QueuedDock(props: {
  session: string | undefined
  pending: (messageID: string) => UserMessagePending | undefined
}) {
  const v2 = useV2()
  const language = useLanguage()
  const [open, setOpen] = createSignal(true)
  const items = () => {
    const id = props.session
    if (!id) return []
    return v2.data.session.pending.list(id).filter((item) => item.type === "user" && item.delivery === "queue")
  }
  return (
    <Show when={items().length > 0}>
      <div class="queued-dock" data-open={open() ? "" : undefined}>
        <button
          type="button"
          class="queued-dock-head"
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron-down" size="small" class="queued-dock-chevron" />
          {language.t("session.queued.count", { count: items().length })}
        </button>
        <Show when={open()}>
          <ol class="queued-dock-list">
            <For each={items()}>
              {(item, index) => {
                const text = () => (item.type === "user" ? item.payload.text : "")
                return (
                  // Focusable, so keyboard users can reach the controls that appear on focus.
                  <li class="queued-dock-row" data-row-key={`queued:${item.id}`} tabIndex={0}>
                    <span class="queued-dock-index">{index() + 1}</span>
                    <span class="queued-dock-text" title={text()}>
                      {text()}
                    </span>
                    <span class="queued-dock-actions">
                      <For each={props.pending(item.id)?.actions ?? []}>
                        {(action) => (
                          <Tooltip value={action.label} placement="top" gutter={4}>
                            <IconButton
                              data-action={action.key}
                              icon={action.icon}
                              size="small"
                              variant="ghost"
                              disabled={action.disabled}
                              onClick={action.onClick}
                              aria-label={action.label}
                            />
                          </Tooltip>
                        )}
                      </For>
                    </span>
                  </li>
                )
              }}
            </For>
          </ol>
        </Show>
      </div>
    </Show>
  )
}
