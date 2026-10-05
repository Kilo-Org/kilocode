// Identity of the subagent a prompt is steering, so a subagent view does not look like the
// parent's prompt: the prompt takes the subagent's color (matching the subagent footer) and
// replaces the primary agent/model row with "Steering <agent> · <model>".
import type { RGBA } from "@opentui/core"
import { createMemo, Show, type Accessor } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { KiloSteer } from "./steer"

export type Subagent = {
  label: string
  color: RGBA
  model?: { name: string; provider: string }
}

/** The subagent a prompt for session `id` would steer, or undefined for a primary session. */
export function useSubagent(id: Accessor<string | undefined>) {
  const sync = useSync()
  const local = useLocal()
  return createMemo((): Subagent | undefined => {
    const session = sync.session.get(id() ?? "")
    if (!KiloSteer.steering(session)) return undefined
    const last = (sync.data.message[id() ?? ""] ?? []).findLast((item) => item.role === "assistant")?.agent
    const name = KiloSteer.agent(session, last) ?? "subagent"
    const info = sync.data.agent.find((item) => item.name === name)
    return {
      label: info?.displayName ?? Locale.titlecase(name),
      color: local.agent.color(name),
      model: KiloSteer.model(session?.model, sync.data.provider),
    }
  })
}

export function SteerLabel(props: { subagent: Subagent }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      <text fg={props.subagent.color} wrapMode="none" flexShrink={0}>
        Steering {props.subagent.label}
      </text>
      <Show when={props.subagent.model}>
        {(item) => (
          <>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.text} flexShrink={0}>
              {item().name}
            </text>
            <text fg={theme.textMuted}>{item().provider}</text>
          </>
        )}
      </Show>
    </box>
  )
}
