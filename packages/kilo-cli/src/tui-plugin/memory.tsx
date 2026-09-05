import { createClient, type RpcCallOptions } from "@kilocode/client"
import type { LocationRef } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { MEMORY_HELP, parseMemoryCommand } from "../memory-command"
import { MemoryRpc, type MemoryRpcShow, type MemoryRpcStatus } from "../memory-rpc"

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
        suggested: true,
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
              await ctx.ui.dialog.alert({ title: "Kilo memory", message: parsed.reason })
              return
            }
            if (parsed.kind === "help") {
              await ctx.ui.dialog.alert({ title: "Kilo memory", message: MEMORY_HELP })
              return
            }
            if (parsed.kind === "show") {
              const result = await rpc.show({}, memoryUiRequestOptions(ctx, options.signal))
              await ctx.ui.dialog.alert({ title: "Kilo memory", message: showMessage(result) })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "enable") {
              const state = await rpc.enable({}, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({
                title: "Kilo memory",
                message: `Memory ${state.enabled ? "enabled" : "disabled"}.`,
              })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "disable") {
              const state = await rpc.disable({}, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({
                title: "Kilo memory",
                message: `Memory ${state.enabled ? "enabled" : "disabled"}.`,
              })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "auto") {
              const state = await rpc.auto({ mode: parsed.mode }, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({
                title: "Kilo memory",
                message: `Automatic consolidation ${state.autoConsolidate ? "enabled" : "disabled"}.`,
              })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "status") {
              const status = await rpc.status({}, memoryUiRequestOptions(ctx, options.signal))
              await ctx.ui.dialog.alert({ title: "Kilo memory", message: statusMessage(status) })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "inspect") {
              const paths = await rpc.inspect({}, memoryUiRequestOptions(ctx, options.signal))
              await ctx.ui.dialog.alert({ title: "Kilo memory", message: paths.join("\n") })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "rebuild") {
              const index = await rpc.rebuild({}, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({
                title: "Kilo memory",
                message: `Memory index rebuilt (${index.tokens} estimated tokens).`,
              })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "remember") {
              const change = await rpc.remember({ text: parsed.text }, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({ title: "Kilo memory", message: `Memory saved (${change.added} change).` })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "correct") {
              const change = await rpc.correct({ text: parsed.text }, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({ title: "Kilo memory", message: `Correction saved (${change.added} change).` })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "forget") {
              const change = await rpc.forget({ query: parsed.query }, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({
                title: "Kilo memory",
                message: `Memory updated (${change.removed} removed).`,
              })
              return
            }
            if (parsed.kind === "operation" && parsed.operation === "purge") {
              const purged = await rpc.purge({ confirm: true }, memoryUiRequestOptions(ctx, options.signal))
              refreshMemoryUi(ctx)
              await ctx.ui.dialog.alert({
                title: "Kilo memory",
                message: purged ? "Memory purged." : "No memory files found.",
              })
              return
            }
          } catch (error) {
            if (options.signal?.aborted) return
            await ctx.ui.dialog.alert({ title: "Kilo memory failed", message: message(error) })
          }
        },
      },
    ],
  }))
}

function statusMessage(input: MemoryRpcStatus) {
  return [
    `Memory ${input.state.enabled ? "enabled" : "disabled"}.`,
    `Automatic consolidation ${input.state.autoConsolidate ? "enabled" : "disabled"}.`,
    `Root: ${input.root}`,
    `Index: ${input.index.bytes} bytes, ${input.index.tokens} estimated tokens${input.index.truncated ? " (truncated)" : ""}.`,
  ].join("\n")
}

function showMessage(input: MemoryRpcShow) {
  return [
    `Memory ${input.state.enabled ? "enabled" : "disabled"}.`,
    `Automatic consolidation ${input.state.autoConsolidate ? "enabled" : "disabled"}.`,
    `Root: ${input.root}`,
    ...Object.entries(input.sources).flatMap(([source, text]) => {
      const lines = text
        .split("\n")
        .filter((line) => line.trim().startsWith("- "))
        .slice(0, 8)
      return [`${source}: ${lines.length} entr${lines.length === 1 ? "y" : "ies"}`, ...lines]
    }),
  ].join("\n")
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return "Unable to complete the memory operation"
}
