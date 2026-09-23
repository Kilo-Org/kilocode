import type { KiloClient } from "@kilocode/sdk/v2"
import { KiloRunDrain } from "../run-drain"
import { UI } from "@/cli/ui"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { DaemonClient } from "@/kilocode/daemon/client"
import { isBuiltinCommand, type BuiltinCommand } from "@/kilocode/session/builtin-commands"
import { Provider } from "@/provider/provider"
import { Filesystem } from "@/util/filesystem"

export namespace KiloRun {
  export async function resolveBuiltin(sdk: KiloClient, command?: string, directory?: string) {
    if (!isBuiltinCommand(command)) return
    const result = await sdk.command.list({ directory })
    if (result.error) return
    if (result.data?.some((item) => item.name === command)) return
    return command
  }

  export function validateBuiltin(args: { command?: BuiltinCommand; continue?: boolean; session?: string }) {
    if (!args.command) return
    if (args.continue || args.session) return
    UI.error(`--command ${args.command} requires --continue or --session`)
    process.exit(1)
  }

  const GOAL_CONTROLS = ["", "pause", "clear", "status", "tasks", "budget"]

  /**
   * Headless goal arguments. Status controls are always allowed. Start and
   * resume need the autonomous engine, because the standard goal loop expects an
   * interactive client; pass `autonomous` when the server config enables it.
   */
  export function validateGoal(text: string, autonomous = false) {
    const action = text.trim()
    if (GOAL_CONTROLS.includes(action)) return undefined
    if (autonomous) return undefined
    return "Goal start and resume require the TUI. Run kilo, then use /goal <text> or /goal resume."
  }

  export const goalControl = (text: string) => GOAL_CONTROLS.includes(text.trim())

  export async function goalEnabled(sdk: KiloClient) {
    const cfg = await sdk.config.get()
    return cfg.data?.autonomous_goal?.enabled === true
  }

  type GoalStatus = { status: string; reason?: string }

  const goalState = (metadata: unknown): GoalStatus | undefined => {
    const goal = (metadata as Record<string, unknown> | undefined)?.["kilo.goal"]
    if (!goal || typeof goal !== "object" || typeof (goal as { status?: unknown }).status !== "string") return undefined
    const value = goal as { status: string; reason?: unknown }
    return { status: value.status, ...(typeof value.reason === "string" ? { reason: value.reason } : {}) }
  }

  /** Poll the session goal row until the engine settles, then print the final status. */
  export async function goalWait(
    sdk: KiloClient,
    sessionID: string,
    emit: (type: string, data: Record<string, unknown>) => boolean,
    opts: { interval?: number; signal?: AbortSignal } = {},
  ) {
    const interval = opts.interval ?? 2000
    for (;;) {
      if (opts.signal?.aborted) return
      const session = await sdk.session.get({ sessionID }, { throwOnError: true })
      const goal = goalState(session.data.metadata)
      if (!goal || goal.status !== "active") {
        const result = await sdk.session.command({ sessionID, command: "goal", arguments: "status" }, { throwOnError: true })
        for (const part of result.data.parts) {
          if (part.type !== "text") continue
          if (!emit("text", { part })) process.stdout.write(part.text + "\n")
        }
        if (!goal || goal.status !== "complete") process.exitCode = 1
        return
      }
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }

  export async function goal(
    sdk: KiloClient,
    sessionID: string,
    text: string,
    emit: (type: string, data: Record<string, unknown>) => boolean,
    opts: { autonomous?: boolean; wait?: boolean; signal?: AbortSignal } = {},
  ) {
    try {
      const action = text.trim()
      const autonomous = opts.autonomous ?? false
      const error = validateGoal(action, autonomous)
      if (error) throw new Error(error)
      const result = await sdk.session.command(
        { sessionID, command: "goal", arguments: action },
        { throwOnError: true },
      )
      for (const part of result.data.parts) {
        if (part.type !== "text") continue
        if (!emit("text", { part })) process.stdout.write(part.text + "\n")
      }
      if (autonomous && opts.wait !== false) await goalWait(sdk, sessionID, emit, { signal: opts.signal })
    } catch (err) {
      const error = FormatError(err) ?? (err instanceof Error ? err.message : FormatUnknownError(err))
      if (!emit("error", { error })) UI.error(error)
      process.exitCode = 1
    }
  }

  export async function runBuiltin(
    sdk: KiloClient,
    sessionID: string,
    command: BuiltinCommand,
    model?: string,
    current?: { id: string; providerID: string },
    directory?: string,
  ) {
    const selected = resolve(model, current)
    if (!selected) {
      UI.error("No model specified and session has no model")
      process.exit(1)
    }

    switch (command) {
      case "compact":
      case "summarize":
        return sdk.session.summarize({
          sessionID,
          directory,
          providerID: selected.providerID,
          modelID: selected.modelID,
        })
    }
  }
}

export namespace KiloRunDaemon {
  export type Input = {
    directory?: string
    execute: (client: KiloClient) => Promise<void>
  }

  export async function attach(input: Input) {
    const daemon = await DaemonClient.maybe()
    if (!daemon) return false
    const dir = input.directory ?? Filesystem.resolve(process.cwd())
    const client = KiloRunDrain.client({ baseUrl: daemon.url, directory: dir, headers: daemon.headers })
    await input.execute(client)
    return true
  }
}

function resolve(model?: string, current?: { id: string; providerID: string }) {
  if (model) {
    const parsed = Provider.parseModel(model)
    return { providerID: parsed.providerID, modelID: parsed.modelID }
  }
  if (!current) return
  return { providerID: current.providerID, modelID: current.id }
}
