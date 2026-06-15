import { createKiloClient, type KiloClient } from "@kilocode/sdk/v2"
import { Filesystem } from "@/util/filesystem"
import { DaemonClient } from "@/kilocode/daemon/client"

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
