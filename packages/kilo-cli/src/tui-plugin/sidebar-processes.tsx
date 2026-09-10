import { Plugin } from "@opencode-ai/plugin/tui"
import type { SessionMessageInfo, ShellInfo } from "@opencode-ai/client"
import { For, Show, createEffect, createMemo, on, onCleanup } from "solid-js"

/** The session's running shells: the durable shell messages of this session's
 * history joined with the live shell registry. A part without a live shell —
 * the server restarted, or the shell finished while the session was away —
 * is not running and never renders, so resumed sessions report live truth
 * instead of replaying stale history rows. Membership comes from the
 * session's own durable history, so only shells that session recorded are
 * shown — a data-scoping property of the durable producer, not a permission
 * boundary. The durable `metadata.background` flag is deliberately not a
 * filter: background tool shells do not set it and session-shell mode sets it
 * even when the submitting client waits, so the honest predicate is the live
 * running status of every shell this session owns. */
export function runningShells(
  parts: ReadonlyArray<SessionMessageInfo>,
  live: (shellID: string) => ShellInfo | undefined,
): Array<{ readonly command: string; readonly pid: number | undefined }> {
  return parts.flatMap((part) => {
    if (part.type !== "shell") return []
    const info = live(part.shellID)
    if (info?.status !== "running") return []
    return [{ command: part.command, pid: typeof info.pid === "number" ? info.pid : undefined }]
  })
}

/** Render the running shells of the viewed session: one row per durable shell
 * message whose live registry entry is still running, with its command and
 * real PID when the producer reports one. */
export function ProcessSidebar(props: {
  readonly context: Plugin.Context
  readonly sessionID: string
  readonly signal?: AbortSignal
}) {
  const theme = props.context.theme
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location ?? props.context.location)
  const running = createMemo(() =>
    runningShells(props.context.data.session.message.list(props.sessionID) ?? [], (shellID) =>
      props.context.data.shell.get(shellID),
    ),
  )

  // Re-keying reconciles both caches from their authoritative sources: plain
  // sync is a no-op for an already-completed key, so a resumed session (or a
  // session revisited after its shell ended elsewhere) would otherwise render
  // stale rows.
  createEffect(
    on(
      () => {
        const ref = location()
        return ref && props.sessionID
          ? `${props.sessionID}\u0000${ref.directory}\u0000${ref.workspaceID ?? ""}`
          : undefined
      },
      () => {
        const ref = location()
        if (!ref) return
        props.context.data.shell.invalidate(ref)
        props.context.data.session.message.invalidate(props.sessionID)
        void props.context.data.shell.sync(ref).catch(() => undefined)
        void props.context.data.session.message.sync(props.sessionID).catch(() => undefined)
      },
    ),
  )

  // The created event's shell record predates the spawned process, so it
  // carries no PID, and the exited/deleted events remove the registry entry —
  // both are reconciled by re-syncing the authoritative shell list for the
  // viewed location.
  const refreshShells = () => {
    const ref = location()
    if (!ref) return
    props.context.data.shell.invalidate(ref)
    void props.context.data.shell.sync(ref).catch(() => undefined)
  }
  const disposers = [
    props.context.data.on("shell.created", refreshShells),
    props.context.data.on("shell.exited", refreshShells),
    props.context.data.on("shell.deleted", refreshShells),
  ]
  // The install-level signal tears the subscriptions down with the plugin;
  // onCleanup covers section remounts so handlers never accumulate.
  const onSignalAbort = () => {
    for (const dispose of disposers) dispose()
  }
  props.signal?.addEventListener("abort", onSignalAbort, { once: true })
  onCleanup(() => {
    props.signal?.removeEventListener("abort", onSignalAbort)
    for (const dispose of disposers) dispose()
  })

  // The slot root must stay mounted; only the running rows are conditional.
  return (
    <box>
      <Show when={running().length > 0}>
        <For each={running()}>
          {(shell) => (
            <box>
              <text>{shell.command}</text>
              <Show when={shell.pid !== undefined}>
                <text fg={theme.text.subdued}>PID {shell.pid}</text>
              </Show>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

/** Append the session's running shells to the host's existing sidebar
 * content. */
export function installProcessSidebar(ctx: Plugin.Context, options: { signal?: AbortSignal } = {}) {
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props) => <ProcessSidebar context={ctx} sessionID={props.sessionID} signal={options.signal} />,
  })
}
