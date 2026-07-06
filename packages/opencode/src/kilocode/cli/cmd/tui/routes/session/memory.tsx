import { Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { Part } from "@kilocode/sdk/v2"
import { MemoryTuiEvents } from "@/kilocode/cli/cmd/tui/memory-events"
import { MemoryTuiMeta } from "@/kilocode/cli/cmd/tui/memory-meta"

type Event = Parameters<typeof MemoryTuiEvents.attach>[0]["event"]
type Toast = Parameters<typeof MemoryTuiEvents.attach>[0]["toast"]

export namespace MemorySessionTui {
  export function attach(input: { event: Event; toast: Toast; sessionID: string }) {
    return MemoryTuiEvents.attach(input)
  }
}

export function MemoryMessageMeta(props: { parts: Part[]; color: string | RGBA }) {
  return (
    <Show when={MemoryTuiMeta.fromParts(props.parts)}>
      {(item) => {
        const label = () =>
          item().type === "startup" ? "Startup Context" : `${item().count} ${item().count === 1 ? "Item" : "Items"}`
        return (
          <span style={{ fg: props.color }}>
            {" "}
            · Memory · {label()} · {item().tokens.toLocaleString()} Tokens
          </span>
        )
      }}
    </Show>
  )
}
