import { createClient, type RpcCallOptions } from "@kilocode/client"
import type { LocationRef } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { parseMemoryCommand } from "../memory-command"
import { MemoryRpc } from "../memory-rpc"
import { showMemoryDialog, showMemoryHelpDialog } from "./memory-dialog"

export type MemoryUiClient = Pick<ReturnType<typeof createClient>, "rpc">

export type MemoryUiOptions = {
  readonly client?: MemoryUiClient
  readonly signal?: AbortSignal
}

type MemoryUiRefreshListener = () => void

const refreshListeners = new WeakMap<Plugin.Context, Set<MemoryUiRefreshListener>>()

/** Subscribe to local-memory changes made by this TUI activation. */
export function subscribeMemoryUiRefresh(ctx: Plugin.Context, listener: MemoryUiRefreshListener) {
  let listeners = refreshListeners.get(ctx)
  if (!listeners) {
    listeners = new Set()
    refreshListeners.set(ctx, listeners)
  }
  listeners.add(listener)
  const unsubscribe = () => listeners?.delete(listener)
  return unsubscribe
}

/** Notify sidebar readers after a local-memory command changes persisted state. */
export function refreshMemoryUi(ctx: Plugin.Context) {
  for (const listener of refreshListeners.get(ctx) ?? []) listener()
}

export function memoryUiRequestOptions(
  ctx: Pick<Plugin.Context, "location" | "data">,
  signal?: AbortSignal,
  location?: LocationRef,
): RpcCallOptions {
  const ref = location ?? ctx.location ?? ctx.data.location.default()
  return {
    ...(signal ? { signal } : {}),
    location: {
      directory: ref.directory,
      ...(ref.workspaceID === undefined ? {} : { workspace: ref.workspaceID }),
    },
  }
}

/** Add the local-memory slash/palette command without admitting a session item. */
export function installMemoryUi(ctx: Plugin.Context, options: MemoryUiOptions = {}) {
  const rpc = options.client?.rpc(MemoryRpc.Definition)

  const dispatch = async (parsed: Exclude<ReturnType<typeof parseMemoryCommand>, undefined>) => {
    if (options.signal?.aborted) return
    if (!rpc) return
    if (parsed.kind === "show") {
      showMemoryDialog({ context: ctx, rpc, signal: options.signal }, "show")
      return
    }
    if (parsed.kind !== "operation") return
    if (parsed.operation === "enable") {
      const state = await rpc.enable({}, memoryUiRequestOptions(ctx, options.signal))
      refreshMemoryUi(ctx)
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Memory ${state.enabled ? "enabled" : "disabled"}.`,
        variant: "success",
      })
      return
    }
    if (parsed.operation === "disable") {
      const state = await rpc.disable({}, memoryUiRequestOptions(ctx, options.signal))
      refreshMemoryUi(ctx)
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Memory ${state.enabled ? "enabled" : "disabled"}.`,
        variant: "info",
      })
      return
    }
    if (parsed.operation === "auto") {
      const state = await rpc.auto({ mode: parsed.mode }, memoryUiRequestOptions(ctx, options.signal))
      refreshMemoryUi(ctx)
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Automatic consolidation ${state.autoConsolidate ? "enabled" : "disabled"}.`,
        variant: "info",
      })
      return
    }
    if (parsed.operation === "status") {
      showMemoryDialog({ context: ctx, rpc, signal: options.signal }, "status")
      return
    }
    if (parsed.operation === "inspect") {
      const paths = await rpc.inspect({}, memoryUiRequestOptions(ctx, options.signal))
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Memory folder: ${paths[0] ?? "unavailable"}`,
        variant: "info",
      })
      return
    }
    if (parsed.operation === "rebuild") {
      const index = await rpc.rebuild({}, memoryUiRequestOptions(ctx, options.signal))
      refreshMemoryUi(ctx)
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Memory index rebuilt (${index.tokens} estimated tokens).`,
        variant: "success",
      })
      return
    }
    if (parsed.operation === "remember") {
      const change = await rpc.remember({ text: parsed.text }, memoryUiRequestOptions(ctx, options.signal))
      refreshMemoryUi(ctx)
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Memory saved (${change.added} change).`,
        variant: "success",
      })
      return
    }
    if (parsed.operation === "correct") {
      const change = await rpc.correct({ text: parsed.text }, memoryUiRequestOptions(ctx, options.signal))
      refreshMemoryUi(ctx)
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Correction saved (${change.added} change).`,
        variant: "success",
      })
      return
    }
    if (parsed.operation === "forget") {
      const change = await rpc.forget({ query: parsed.query }, memoryUiRequestOptions(ctx, options.signal))
      refreshMemoryUi(ctx)
      ctx.ui.toast.show({
        title: "Kilo memory",
        message: `Memory updated (${change.removed} removed).`,
        variant: "success",
      })
      return
    }
    const purged = await rpc.purge({ confirm: true }, memoryUiRequestOptions(ctx, options.signal))
    refreshMemoryUi(ctx)
    ctx.ui.toast.show({
      title: "Kilo memory",
      message: purged ? "Memory purged." : "No memory files found.",
      variant: "success",
    })
  }

  const menu = async () => {
    const selected = await ctx.ui.dialog.select<string>({
      title: "Memory",
      placeholder: "Select a local memory action",
      options: [
        { title: "Status", value: "status", description: "View state, activity, and index size" },
        { title: "Show", value: "show", description: "View stored project memory" },
        { title: "Inspect", value: "inspect", description: "Reveal the isolated memory folder" },
        { title: "Enable", value: "enable", description: "Enable local project memory" },
        { title: "Disable", value: "disable", description: "Disable memory and cancel automatic capture" },
        { title: "Automatic consolidation on", value: "auto on", description: "Allow auxiliary capture" },
        { title: "Automatic consolidation off", value: "auto off", description: "Stop auxiliary capture" },
        { title: "Remember", value: "remember", description: "Save an explicit project note" },
        { title: "Correct", value: "correct", description: "Save an explicit correction" },
        { title: "Forget", value: "forget", description: "Remove an exact saved item" },
        { title: "Rebuild index", value: "rebuild", description: "Rebuild local recall context" },
        { title: "Purge", value: "purge", description: "Delete all isolated memory files" },
      ],
    })
    if (selected === undefined || options.signal?.aborted) return
    if (selected === "remember" || selected === "correct" || selected === "forget") {
      const text = await ctx.ui.dialog.prompt({
        title: `Memory ${selected}`,
        description:
          selected === "forget"
            ? "Enter an exact key or source-qualified key to remove."
            : "Enter local project memory.",
        placeholder: selected === "forget" ? "project.md:Facts:memory_key" : "Durable project fact",
      })
      if (!text?.trim() || options.signal?.aborted) return
      const parsed = parseMemoryCommand(`/memory ${selected} ${text}`)
      if (parsed) await dispatch(parsed)
      return
    }
    if (selected === "purge") {
      const confirmed = await ctx.ui.dialog.confirm({
        title: "Purge local memory",
        message: "Delete all isolated project memory files? This cannot be undone.",
        label: { confirm: "Purge", cancel: "Cancel" },
      })
      if (confirmed !== true || options.signal?.aborted) return
    }
    const parsed = parseMemoryCommand(`/memory ${selected === "purge" ? "purge confirm" : selected}`)
    if (parsed) await dispatch(parsed)
  }

  ctx.keymap.layer(() => ({
    mode: "global",
    priority: 2,
    commands: [
      {
        id: "kilo.memory",
        title: "Memory",
        description: "Manage explicit local project memory",
        group: "Kilo",
        bind: false,
        palette: true,
        // Suggested palette items are intentionally duplicated by the host's
        // palette (once in Suggested and once in the full command list).
        suggested: false,
        slash: { name: "memory", aliases: ["mem"], arguments: true },
        run: async (input?: string) => {
          if (options.signal?.aborted) return
          if (!rpc) {
            await ctx.ui.dialog.alert({
              title: "Kilo memory",
              message: "Restart this preview to enable Kilo memory controls.",
            })
            return
          }
          const parsed = parseMemoryCommand(`/memory ${input?.trim() ?? ""}`)
          if (!parsed) return
          try {
            if (parsed.kind === "usage") {
              showMemoryHelpDialog(ctx, parsed.reason)
              return
            }
            if (parsed.kind === "help") {
              await menu()
              return
            }
            await dispatch(parsed)
          } catch (error) {
            if (options.signal?.aborted) return
            ctx.ui.toast.show({ title: "Kilo memory failed", message: message(error), variant: "error" })
          }
        },
      },
    ],
  }))
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return "Unable to complete the memory operation"
}
