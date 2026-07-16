import { createMemo, createResource, For, onCleanup, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { Part } from "@kilocode/sdk/v2"
import * as Log from "@opencode-ai/core/util/log"
import { useEvent } from "@tui/context/event"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { route } from "@/kilocode/cli/cmd/tui/memory-command"
import { MemoryTuiEvents } from "@/kilocode/cli/cmd/tui/memory-events"
import { MemoryTuiMeta } from "@/kilocode/cli/cmd/tui/memory-meta"
import { MemoryTuiState } from "@/kilocode/cli/cmd/tui/memory-state"

const log = Log.create({ service: "memory-tui" })

export namespace MemorySessionTui {
  export function attach(input: Parameters<typeof MemoryTuiEvents.attach>[0]) {
    return MemoryTuiEvents.attach(input)
  }

  export function verbose(input: { sessionID(): string }) {
    const sdk = useSDK()
    const project = useProject()
    const sync = useSync()
    const event = useEvent()
    const session = createMemo(() => sync.session.get(input.sessionID()))
    const [state, api] = createResource(
      () => {
        const item = session()
        if (!item) return
        return `${item.workspaceID ?? "__default__"}:${item.directory}`
      },
      async () => {
        try {
          const item = session()
          const result = await sdk.client.memory.status(
            route({ workspace: item?.workspaceID ?? project.workspace.current(), directory: item?.directory }),
          )
          return result.data?.state
        } catch (err) {
          log.warn("memory status unavailable", { err })
          return undefined
        }
      },
    )
    const refresh = (value: { properties: { sessionID?: string } }) => {
      if (value.properties.sessionID && value.properties.sessionID !== input.sessionID()) return
      void api.refetch()
    }
    const offs = [
      event.on("memory.status", refresh),
      event.on("memory.updated", refresh),
      event.on("memory.error", refresh),
    ]
    onCleanup(() => offs.forEach((off) => off()))
    return () => MemoryTuiState.verbose(state())
  }
}

export function MemoryMessageMeta(props: { parts: Part[]; color: string | RGBA; verbose(): boolean }) {
  const item = createMemo(() => MemoryTuiMeta.fromParts(props.parts))

  return (
    <Show when={item()}>
      {(meta) => {
        const snippets = createMemo(() =>
          meta().type === "recall"
            ? MemoryTuiMeta.items(meta())
                .slice(0, 2)
                .map((text) => text.trim().slice(0, 80))
                .filter(Boolean)
            : [],
        )
        return (
          <span style={{ fg: props.color }}>
            {" "}
            · memory · {meta().type === "startup" ? "Startup Context" : `recalled ${meta().count}`}
            <Show when={props.verbose() && snippets().length > 0}>
              <For each={snippets()}>{(text) => <> · {text}</>}</For>
            </Show>
          </span>
        )
      }}
    </Show>
  )
}
