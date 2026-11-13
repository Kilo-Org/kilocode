import type { LocationRef } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { route } from "../memory-command"
import { MemoryTuiState } from "../memory-state"

export function memoryRow(input: { enabled?: boolean; loading?: boolean; active: boolean }): {
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

export function MemorySidebar(props: { context: Plugin.Context; sessionID: string }) {
  const theme = () => props.context.theme
  const rpc = props.context.client.rpc(KiloMemoryRpc.Definition)
  const location = (): LocationRef =>
    props.context.data.session.get(props.sessionID)?.location ??
    props.context.location ??
    props.context.data.location.default()
  const [tick, setTick] = createSignal(0)
  const [data] = createResource(
    () => ({ directory: location().directory, sessionID: props.sessionID, tick: tick() }),
    (key) => rpc.status({ sessionID: key.sessionID }, route(key)).catch(() => undefined),
  )
  const [saved, setSaved] = createSignal(false)
  const pulse = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  onCleanup(() => {
    if (pulse.id) clearTimeout(pulse.id)
  })
  const state = createMemo(() =>
    memoryRow({
      enabled: data() && MemoryTuiState.enabled(data()?.state),
      loading: data.loading,
      active: MemoryTuiState.active({ markers: data()?.marker ? 1 : 0, saved: saved() }),
    }),
  )

  onMount(() => {
    const bump = () => {
      setTick((value) => value + 1)
    }
    const save = (event: KiloMemoryRpc.Event) => {
      if (event.sessionID !== props.sessionID) return
      if (event.detail?.type !== "saved") return
      setSaved(true)
      if (pulse.id) clearTimeout(pulse.id)
      pulse.id = setTimeout(() => {
        setSaved(false)
        pulse.id = undefined
      }, 5_000)
    }
    const offs = [
      rpc.events.on("status", (event) => {
        bump()
        save(event.data)
      }),
      rpc.events.on("updated", (event) => {
        bump()
        save(event.data)
      }),
      rpc.events.on("error", bump),
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
            <text fg={theme().text.base}>
              <b>Memory</b>
            </text>
            <box flexDirection="row" gap={1}>
              <text
                flexShrink={0}
                fg={
                  row().tone === "success"
                    ? theme().text.feedback.success.base
                    : row().tone === "error"
                      ? theme().text.feedback.error.base
                      : theme().text.muted
                }
              >
                •
              </text>
              <text fg={theme().text.base}>{row().label}</text>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}
