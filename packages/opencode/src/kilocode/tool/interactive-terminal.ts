import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { InteractiveTerminal } from "@/kilocode/interactive-terminal"
import { Plugin } from "@/plugin"
import { Shell } from "@/shell/shell"
import { ShellPermission } from "@/tool/shell"
import { Tool } from "@/tool/tool"
import type { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Schema } from "effect"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import path from "path"
import DESCRIPTION from "./interactive-terminal.txt"

export const Params = Schema.Struct({
  command: Schema.String.annotate({ description: "Command to run in an interactive terminal" }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory. Defaults to the project directory.",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Short label shown in the terminal dialog",
  }),
}).check(
  Schema.makeFilter((params: { command: string }) =>
    params.command.trim() ? undefined : "command must contain a non-whitespace character",
  ),
)

export type Params = Schema.Schema.Type<typeof Params>

type Meta = {
  terminalID?: InteractiveTerminal.ID
  exitCode?: number
  closedBy?: InteractiveTerminal.ClosedBy
}

export const InteractiveTerminalTool = Tool.define<
  typeof Params,
  Meta,
  Config.Service | Plugin.Service | AppFileSystem.Service | ChildProcessSpawner,
  "interactive_terminal"
>(
  "interactive_terminal",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const permission = yield* ShellPermission

    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const inst = yield* InstanceState.context
          const command = params.command.trim()
          const cwd = path.resolve(inst.directory, params.workdir ?? inst.directory)
          const cfg = yield* config.get()
          const shell = Shell.acceptable(cfg.shell)
          yield* permission.ask(ctx, { command, cwd, shell, description: params.description })
          const extra = yield* plugin.trigger(
            "shell.env",
            { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
            { env: {} },
          )
          const result = yield* Effect.promise(() =>
            InteractiveTerminal.run({
              sessionID: ctx.sessionID,
              command,
              cwd,
              description: params.description,
              shell,
              env: { ...process.env, ...extra.env },
              abort: ctx.abort,
            }),
          )
          const reason =
            result.closedBy === "exit"
              ? `Process exited${result.exitCode === undefined ? "" : ` with code ${result.exitCode}`}.`
              : result.closedBy === "user"
                ? "The user closed the interactive terminal before the process exited."
                : "The interactive terminal was closed because the tool run was cancelled."

          return {
            title: params.description ?? command,
            output: `${result.output || "(no output)"}\n\n${reason}`,
            metadata: {
              terminalID: result.id,
              exitCode: result.exitCode,
              closedBy: result.closedBy,
            },
          }
        }),
    }
  }),
)
