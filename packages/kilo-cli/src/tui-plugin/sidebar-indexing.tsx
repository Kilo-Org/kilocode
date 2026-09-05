import type { IndexingStatus } from "@kilocode/indexing/status"
import type { createClient } from "@kilocode/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { IndexingRpc } from "../indexing-rpc"

export function installIndexingSidebar(
  ctx: Plugin.Context,
  options: { client?: Pick<ReturnType<typeof createClient>, "rpc">; signal?: AbortSignal },
) {
  const rpc = options.client?.rpc(IndexingRpc)
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props) => {
      const location = createMemo(() => ctx.data.session.get(props.sessionID)?.location)
      const [status, setStatus] = createSignal<IndexingStatus>()
      const [unavailable, setUnavailable] = createSignal(false)

      createEffect(
        on(location, (ref) => {
          setStatus(undefined)
          setUnavailable(false)
          if (!ref) return
          const controller = new AbortController()
          const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
          let timer: ReturnType<typeof setTimeout> | undefined
          const refresh = async () => {
            if (signal.aborted) return
            if (!rpc) {
              setUnavailable(true)
              return
            }
            try {
              const value = await rpc.status({}, { location: ref, signal })
              if (signal.aborted) return
              setStatus(value)
              setUnavailable(false)
              // Even a complete index can change after file-watcher activity.
              if (value.state !== "Disabled") timer = setTimeout(refresh, value.state === "In Progress" ? 1000 : 5000)
            } catch {
              if (signal.aborted) return
              setStatus(undefined)
              setUnavailable(true)
              timer = setTimeout(refresh, 5000)
            }
          }
          void refresh()
          onCleanup(() => {
            controller.abort()
            clearTimeout(timer)
          })
        }),
      )

      const tone = () => {
        if (status()?.state === "Error" || unavailable()) return ctx.theme.text.feedback.warning.default
        if (status()?.state === "Complete") return ctx.theme.text.feedback.success.default
        return ctx.theme.text.subdued
      }
      return (
        <box>
          <text fg={ctx.theme.text.default}>
            <b>Code Indexing</b>
          </text>
          <text fg={tone()}>{unavailable() ? "Unavailable" : (status()?.state ?? "Loading")}</text>
          <Show when={status()?.state === "In Progress" && (status()?.totalFiles ?? 0) > 0}>
            <text fg={ctx.theme.text.subdued}>
              {status()?.processedFiles} / {status()?.totalFiles} files ({status()?.percent}%)
            </text>
          </Show>
        </box>
      )
    },
  })
}
