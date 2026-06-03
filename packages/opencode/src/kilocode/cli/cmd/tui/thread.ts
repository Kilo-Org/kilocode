import { UI } from "@/cli/ui"
import type { NetworkOptions } from "@/cli/network"
import { errorMessage } from "@/util/error"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { validateSession } from "@/cli/cmd/tui/validate-session"
import { importCloudSession } from "@/kilocode/cloud-session"
import { DaemonClient } from "@/kilocode/daemon/client"
import { createKiloClient } from "@kilocode/sdk/v2"

type TuiInput = Parameters<typeof import("@/cli/cmd/tui/app").tui>[0]

type Args = NetworkOptions & {
  prompt?: string
  session?: string
  cloudFork?: boolean
  continue?: boolean
  agent?: string
  model?: string
  fork?: boolean
}

type Input = {
  args: Args
  cwd: string
  input: () => Promise<string | undefined>
  start: (input: TuiInput) => Promise<void>
}

async function session(input: Input, daemon: DaemonClient.Connection) {
  if (!input.args.cloudFork || !input.args.session) return { ok: true as const, id: input.args.session }

  UI.println("Importing session from cloud...")
  const client = createKiloClient({
    baseUrl: daemon.url,
    directory: input.cwd,
    headers: daemon.headers,
  })
  const id = await importCloudSession(client, input.args.session).catch(() => undefined)
  if (id) return { ok: true as const, id }

  UI.error("Failed to import session from cloud")
  process.exitCode = 1
  return { ok: false as const }
}

export namespace KiloTuiThreadDaemon {
  export async function attach(input: Input) {
    const daemon = await DaemonClient.maybe()
    if (!daemon) return false

    const prompt = await input.input()
    const config = await TuiConfig.get()

    try {
      await validateSession({
        url: daemon.url,
        sessionID: input.args.session,
        directory: input.cwd,
        headers: daemon.headers,
      })
    } catch (error) {
      UI.error(errorMessage(error))
      process.exitCode = 1
      return true
    }

    const fork = await session(input, daemon)
    if (!fork.ok) return true

    await input.start({
      url: daemon.url,
      config,
      directory: input.cwd,
      headers: daemon.headers,
      args: {
        continue: input.args.continue,
        sessionID: fork.id,
        agent: input.args.agent,
        model: input.args.model,
        prompt,
        fork: input.args.fork,
      },
    })
    return true
  }
}
