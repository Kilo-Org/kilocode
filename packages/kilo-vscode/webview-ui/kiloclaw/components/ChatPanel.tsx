// KiloClaw chat panel — message list + input

import { createSignal, createEffect, For, Show, createMemo, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useClaw } from "../context/claw"
import { useKiloClawLanguage } from "../context/language"
import { MessageBubble } from "./MessageBubble"

export function ChatPanel() {
  const claw = useClaw()
  const { t } = useKiloClawLanguage()
  const [text, setText] = createSignal("")
  let list!: HTMLDivElement
  let input!: HTMLTextAreaElement

  const disabled = createMemo(() => {
    const s = claw.status()
    return !s || s.status !== "running" || !claw.connected()
  })

  const placeholder = createMemo(() => {
    if (!claw.connected()) return t("kiloClaw.chat.connecting")
    const s = claw.status()
    if (!s || s.status !== "running") return t("kiloClaw.chat.notRunning")
    return t("kiloClaw.chat.placeholder")
  })

  // Auto-scroll to bottom when messages change
  createEffect(() => {
    claw.messages()
    if (list) {
      requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight
      })
    }
  })

  // Focus input on mount
  onMount(() => {
    if (input && !disabled()) input.focus()
  })

  const submit = () => {
    const val = text().trim()
    if (!val || disabled()) return
    claw.send(val)
    setText("")
    if (input) {
      input.style.height = "auto"
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const onInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    setText(target.value)
    // Auto-resize
    target.style.height = "auto"
    target.style.height = Math.min(target.scrollHeight, 120) + "px"
  }

  return (
    <div class="kiloclaw-chat">
      {/* Header */}
      <div class="kiloclaw-chat-header">
        <div class="kiloclaw-chat-header-left">
          <span class={`kiloclaw-dot ${claw.online() ? "kiloclaw-dot-online" : "kiloclaw-dot-offline"}`} />
          <span class="kiloclaw-chat-header-title">
            KiloClaw {claw.online() ? t("kiloClaw.chat.online") : t("kiloClaw.chat.offline")}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div class="kiloclaw-messages" ref={list} role="log" aria-live="polite">
        <Show when={claw.messages().length === 0 && claw.connected()}>
          <div class="kiloclaw-empty">{t("kiloClaw.chat.empty")}</div>
        </Show>
        <For each={claw.messages()}>{(msg) => <MessageBubble message={msg} />}</For>
      </div>

      {/* Input */}
      <div class="kiloclaw-input-wrap">
        <textarea
          ref={input}
          class="kiloclaw-input"
          placeholder={placeholder()}
          disabled={disabled()}
          value={text()}
          onInput={onInput}
          onKeyDown={onKeyDown}
          rows={1}
          aria-label={t("kiloClaw.chat.placeholder")}
        />
        <Button variant="primary" disabled={disabled() || !text().trim()} onClick={submit}>
          {t("kiloClaw.chat.send")}
        </Button>
      </div>
    </div>
  )
}
