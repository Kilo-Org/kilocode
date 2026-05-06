// Individual chat message bubble

import { Show, createMemo } from "solid-js"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { TextShimmer } from "@kilocode/kilo-ui/text-shimmer"
import type { ChatMessage } from "../lib/types"
import { useKiloClawLanguage } from "../context/language"

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function MessageBubble(props: { message: ChatMessage }) {
  const { t } = useKiloClawLanguage()
  const empty = createMemo(() => !props.message.text || !props.message.text.trim())

  return (
    <div class={`kiloclaw-msg ${props.message.bot ? "kiloclaw-msg-bot" : "kiloclaw-msg-user"}`}>
      <div class="kiloclaw-msg-header">
        <span class="kiloclaw-msg-author">
          {props.message.bot ? t("kiloClaw.message.bot") : t("kiloClaw.message.you")}
        </span>
        <span class="kiloclaw-msg-time">{formatTime(props.message.created)}</span>
      </div>
      <div class="kiloclaw-msg-body">
        <Show when={!empty()} fallback={<TextShimmer text={t("kiloClaw.message.thinking")} />}>
          <Show when={props.message.bot} fallback={<span>{props.message.text}</span>}>
            <Markdown text={props.message.text} />
          </Show>
        </Show>
      </div>
    </div>
  )
}
