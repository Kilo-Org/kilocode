export * from "@opencode-ai/ui/message-part"

import { Show, createSignal } from "solid-js"
import { PART_MAPPING } from "@opencode-ai/ui/message-part"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import type { ReasoningPart } from "@kilocode/sdk/v2"
import type { MessagePartProps } from "@opencode-ai/ui/message-part"

// Override: collapsible reasoning block with brain icon + label
// Replaces the upstream flat markdown render with a clearly distinguished, collapsed-by-default block
PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props: MessagePartProps) {
  const part = props.part as unknown as ReasoningPart
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  // Filter out redacted reasoning chunks from OpenRouter (encrypted reasoning data appears as [REDACTED])
  const text = () => (part.text ?? "").replace("[REDACTED]", "").trim()

  return (
    <Show when={text()}>
      <div data-component="reasoning-part">
        <Collapsible open={open()} onOpenChange={setOpen} class="tool-collapsible">
          <Collapsible.Trigger>
            <div data-slot="reasoning-header">
              <Icon name="brain" size="small" />
              <span data-slot="reasoning-label">{i18n.t("ui.reasoning.label" as never)}</span>
            </div>
            <Collapsible.Arrow />
          </Collapsible.Trigger>
          <Collapsible.Content>
            <div data-slot="reasoning-content">
              <Markdown text={text()} cacheKey={part.id} />
            </div>
          </Collapsible.Content>
        </Collapsible>
      </div>
    </Show>
  )
}
