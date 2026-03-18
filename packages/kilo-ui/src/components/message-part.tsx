export * from "@opencode-ai/ui/message-part"

import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { PART_MAPPING } from "@opencode-ai/ui/message-part"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import type { ReasoningPart } from "@kilocode/sdk/v2"
import type { MessagePartProps } from "@opencode-ai/ui/message-part"

// Track part IDs that have been rendered while streaming.
// Persists across component instances so that when reasoning-end replaces the
// store object (causing <For> to recreate the component) the new instance
// knows the part was just streaming and can animate the collapse.
const streamed = new Set<string>()

// Override: streaming reasoning block with auto-collapse
PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props: MessagePartProps) {
  const i18n = useI18n()

  const text = () => {
    const p = props.part as unknown as ReasoningPart
    return (p.text ?? "").replace("[REDACTED]", "").trim()
  }

  // time.end is set by the processor on reasoning-end.
  // v1 parts lack time entirely → treat as historical.
  const done = () => {
    const t = (props.part as any).time
    return !t || !!t.end
  }

  const id = (props.part as any).id as string

  // Check before adding — order matters
  const was = streamed.has(id)
  if (!done()) streamed.add(id)

  // Streaming → open. Just finished (was streaming, now done) → open briefly
  // then collapse. Historical → collapsed from the start.
  const [open, setOpen] = createSignal(!done() || was)

  // Auto-collapse after reasoning finishes
  createEffect(() => {
    if (done() && open()) {
      const timer = setTimeout(() => setOpen(false), 500)
      onCleanup(() => clearTimeout(timer))
    }
  })

  onCleanup(() => {
    if (done()) streamed.delete(id)
  })

  // Auto-scroll the content container while streaming
  let ref: HTMLDivElement | undefined
  createEffect(() => {
    text()
    if (!done() && ref) {
      ref.scrollTop = ref.scrollHeight
    }
  })

  return (
    <Show when={text()}>
      <div data-component="reasoning-part" data-streaming={!done() ? "" : undefined}>
        <Collapsible open={open()} onOpenChange={setOpen} class="tool-collapsible">
          <Collapsible.Trigger>
            <div data-slot="reasoning-header">
              <Icon name="brain" size="small" />
              <span data-slot="reasoning-label">{i18n.t("ui.reasoning.label" as never)}</span>
            </div>
            <Collapsible.Arrow />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div data-slot="reasoning-content" ref={ref}>
              <Markdown text={text()} cacheKey={id} />
            </div>
          </Collapsible.Content>
        </Collapsible>
      </div>
    </Show>
  )
}
