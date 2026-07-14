import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { Part } from "@kilocode/sdk/v2"
import * as Log from "@opencode-ai/core/util/log"
import { useEvent } from "@tui/context/event"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { MemoryTuiEvents } from "@/kilocode/cli/cmd/tui/memory-events"
import { route } from "@/kilocode/cli/cmd/tui/memory-command"
import { MemoryTuiMeta } from "@/kilocode/cli/cmd/tui/memory-meta"
import { errorMessage } from "@/util/error"

type Event = Parameters<typeof MemoryTuiEvents.attach>[0]["event"]
type Toast = Parameters<typeof MemoryTuiEvents.attach>[0]["toast"]
const log = Log.create({ service: "tui.memory-message" })

export namespace MemorySessionTui {
  export function attach(input: { event: Event; toast: Toast; sessionID: string }) {
    return MemoryTuiEvents.attach(input)
  }

  export function verbose(input: { sessionID(): string }) {
    const sdk = useSDK()
    const event = useEvent()
    const project = useProject()
    const sync = useSync()
    const [tick, setTick] = createSignal(0)
    const session = createMemo(() => sync.session.get(input.sessionID()))
    const workspace = createMemo(() => session()?.workspaceID ?? project.workspace.current())
    const dir = createMemo(() => session()?.directory ?? project.instance.path().directory)
    const [data] = createResource(
      () => [workspace(), dir(), tick()] as const,
      async ([workspace, directory]) => {
        const result = await sdk.client.memory.status(route({ workspace, directory })).catch((err: unknown) => {
          log.warn("memory verbose status unavailable", { error: errorMessage(err) })
          return undefined
        })
        if (!result?.data || result.error) return false
        return result.data.state.verbose
      },
    )
    const dispose = event.on("memory.status", () => setTick((value) => value + 1))
    onCleanup(dispose)
    return createMemo(() => data() ?? false)
  }
}

export function MemoryMessageMeta(props: { parts: Part[]; color: string | RGBA; verbose: boolean }) {
  return (
    <Show when={MemoryTuiMeta.fromParts(props.parts)}>
      {(item) => {
        const label = () =>
          item().type === "startup" ? "Startup Context" : `${item().count} ${item().count === 1 ? "Item" : "Items"}`
        return (
          <span style={{ fg: props.color }}>
            {" "}
            · Memory · {label()} · {item().tokens.toLocaleString()} Tokens
            <For each={MemoryTuiMeta.snippets(item(), props.verbose).slice(0, 2)}>{(value) => <> · {value}</>}</For>
          </span>
        )
      }}
    </Show>
  )
}
