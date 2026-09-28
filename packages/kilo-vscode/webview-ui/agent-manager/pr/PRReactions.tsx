/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useLanguage } from "../../src/context/language"
import { PR_REACTION_CONTENT, type PRReaction, type PRReactionContent } from "./pr-types"

const EMOJI: Record<PRReactionContent, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😂",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
}

interface Props {
  reactions?: PRReaction[]
  pending?: (content: PRReactionContent) => boolean
  onToggle: (content: PRReactionContent, add: boolean) => void
}

export function PRReactions(props: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = createSignal(false)
  const find = (content: PRReactionContent) => props.reactions?.find((value) => value.content === content)
  const toggle = (content: PRReactionContent) => props.onToggle(content, find(content)?.viewerHasReacted !== true)
  /**
   * Keyed by reaction name, not by the reaction objects: a pick and a poll both
   * allocate fresh objects, and `For` would rebuild every pill from scratch,
   * which drops the pressed button mid-animation.
   */
  const shown = createMemo(() => (props.reactions ?? []).map((item) => item.content))

  return (
    <div class="am-pr-reactions am-pr-row">
      <For each={shown()}>
        {(content) => {
          const active = () => find(content)?.viewerHasReacted === true
          const busy = () => props.pending?.(content) === true
          return (
            <Button
              variant="ghost"
              size="small"
              class="am-pr-reaction"
              classList={{ "am-pr-reaction-active": active() }}
              aria-label={`${t(active() ? "agentManager.pr.comment.removeReaction" : "agentManager.pr.comment.react")}: ${EMOJI[content]}`}
              aria-pressed={active()}
              aria-busy={busy()}
              onClick={() => toggle(content)}
            >
              <span aria-hidden="true">{EMOJI[content]}</span>
              {/* Fixed-width slot: the spinner takes the count's place instead of resizing the pill. */}
              <span class="am-pr-reaction-count">
                <Show when={busy()} fallback={find(content)?.count}>
                  <Spinner class="am-pr-reaction-spinner" />
                </Show>
              </span>
            </Button>
          )
        }}
      </For>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        contentLabel={t("agentManager.pr.comment.reactionPicker")}
        trigger={
          <IconButton icon="plus-small" size="small" variant="ghost" label={t("agentManager.pr.comment.react")} />
        }
      >
        <div class="am-pr-reaction-picker" role="menu">
          <For each={PR_REACTION_CONTENT}>
            {(content) => (
              <Button
                variant="ghost"
                size="small"
                class="am-pr-reaction-option"
                role="menuitem"
                aria-label={`${t("agentManager.pr.comment.react")}: ${EMOJI[content]}`}
                onClick={() => {
                  setOpen(false)
                  toggle(content)
                }}
              >
                <span aria-hidden="true">{EMOJI[content]}</span>
              </Button>
            )}
          </For>
        </div>
      </Popover>
    </div>
  )
}
