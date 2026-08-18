import type { TuiPluginApi } from "@kilocode/plugin/tui"
import type { Event } from "@kilocode/sdk/v2"
import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import * as Log from "@opencode-ai/core/util/log"
import { route } from "@/kilocode/cli/cmd/tui/memory-command"
import { MemoryTuiMeta } from "@/kilocode/cli/cmd/tui/memory-meta"
import { MemoryTuiState } from "@/kilocode/cli/cmd/tui/memory-state"

export function memoryRow(input: {
  enabled?: boolean
  loading?: boolean
  active: boolean
}): {
  label: "Loading" | "Unavailable" | "Disabled" | "Enabled"
  tone: "muted" | "success" | "error"
} {
  if (input.enabled === undefined) {
    return input.loading ? { label: "Loading", tone: "muted" } : { label: "Unavailable", tone: "error" }
  }
  if (!input.enabled) return { label: "Disabled", tone: "muted" as const }
  return {
    label: "Enabled",
    tone: input.active ? ("success" as const) : ("muted" as const),
  }
}

export function MemorySidebar(props: { api: TuiPluginApi; sessionID: string }) {
  const [tick, setTick] = createSignal(0)
  const session = createMemo(() => props.api.state.session.get(props.sessionID))
  const workspace = createMemo(() => session()?.workspaceID)
  const dir = createMemo(() => session()?.directory ?? props.api.state.path.directory)
  const [data] = createResource(
    () => `${workspace() ?? "__default__"}:${dir()}:${tick()}`,
    async () => {
      try {
        const result = await props.api.client.memory.status(route({ workspace: workspace(), directory: dir() }))
        return result.data?.state
      } catch (err) {
        Log.Default.warn("memory status unavailable", { err })
        return undefined
      }
    },
  )
  const markers = createMemo(() =>
    props.api.state.session.messages(props.sessionID).flatMap((message) =>
      props.api.state.part(message.id).flatMap((part) => {
        const meta = MemoryTuiMeta.fromParts([part])
        if (!meta) return []
        return [{ id: part.id, meta }]
      }),
    ),
  )
  const [saved, setSaved] = createSignal(false)
  const pulse = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  onCleanup(() => {
    if (pulse.id) clearTimeout(pulse.id)
  })
  const state = createMemo(() =>
    memoryRow({
      enabled: data() && MemoryTuiState.enabled(data()),
      loading: data.loading,
      active: MemoryTuiState.active({ markers: markers().length, saved: saved() }),
    }),
  )

  onMount(() => {
    const bump = () => setTick((value) => value + 1)
    const save = (event: Extract<Event, { type: "memory.status" | "memory.updated" }>) => {
      if (event.properties.sessionID !== props.sessionID) return
      if (event.properties.detail?.type !== "saved") return
      setSaved(true)
      if (pulse.id) clearTimeout(pulse.id)
      pulse.id = setTimeout(() => {
        setSaved(false)
        pulse.id = undefined
      }, 5_000)
    }
    const offs = [
      props.api.event.on("memory.status", (event) => {
        bump()
        save(event)
      }),
      props.api.event.on("memory.updated", (event) => {
        bump()
        save(event)
      }),
      props.api.event.on("memory.error", bump),
    ]
    const id = setInterval(bump, 15_000).unref()
    onCleanup(() => {
      for (const off of offs) off()
      clearInterval(id)
    })
  })

  return (
    // sidebar slot roots must be stable; a conditional root never mounts
    <box>
      <Show when={state()}>
        {(row) => (
          <box>
            <text fg={props.api.theme.current.text}>
              <b>Memory</b>
            </text>
            <box flexDirection="row" gap={1}>
              <text
                fg={
                  row().tone === "success"
                    ? props.api.theme.current.success
                    : row().tone === "error"
                      ? props.api.theme.current.error
                      : props.api.theme.current.textMuted
                }
              >
                •
              </text>
              <text fg={props.api.theme.current.text}>
                {row().label}
              </text>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}
