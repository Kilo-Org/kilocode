import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2"
import { UI } from "@/cli/ui"
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
    const client = createKiloClient({ baseUrl: daemon.url, directory: dir, headers: daemon.headers })
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
