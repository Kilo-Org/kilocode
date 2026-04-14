import type { KiloClient } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"

const promises = new Map<string, Promise<unknown>>()

export function clearCommandsCache(): void {
  promises.clear()
}

export async function loadCommands(client: KiloClient, dir: string): Promise<unknown> {
  const pending = promises.get(dir)
  if (pending) return pending

  const promise = retry(() => client.command.list({ directory: dir }, { throwOnError: true })).then(({ data }) => ({
    type: "commandsLoaded",
    commands: data.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      source: cmd.source,
      hints: cmd.hints,
    })),
  }))

  promises.set(dir, promise)
  try {
    return await promise
  } finally {
    if (promises.get(dir) === promise) promises.delete(dir)
  }
}
