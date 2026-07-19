import { randomUUID } from "node:crypto"
import { UI } from "@/cli/ui"
import type { NetworkOptions } from "@/cli/network"
import { ServerAuth } from "@/server/auth"
import { Flag } from "@opencode-ai/core/flag/flag"
import { errorMessage } from "@opencode-ai/tui/util/error"
import { TuiConfig } from "@/config/tui"
import { validateSession } from "@/cli/tui/validate-session"
import { importCloudSession, reportCloudImportError } from "@/kilocode/cloud-session"
import { DaemonClient } from "@/kilocode/daemon/client"
import { createKiloClient } from "@kilocode/sdk/v2"

type TuiInput = import("@opencode-ai/tui").TuiInput
export type StartInput = Omit<TuiInput, "pluginHost">

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
  start: (input: StartInput) => Promise<void>
}

async function session(input: Input, daemon: DaemonClient.Connection) {
  if (!input.args.cloudFork || !input.args.session) return { ok: true as const, id: input.args.session }

  UI.println("Importing session from cloud...")
  const client = createKiloClient({
    baseUrl: daemon.url,
    directory: input.cwd,
    headers: daemon.headers,
  })
  try {
    const id = await importCloudSession(client, input.args.session)
    return { ok: true as const, id }
  } catch (err) {
    reportCloudImportError(err)
    process.exitCode = 1
    return { ok: false as const }
  }
}

export namespace KiloTuiThreadDaemon {
  // Protect TUI-owned HTTP routes from unauthenticated local callers: derive
  // worker credentials once so the spawned worker server and the TUI's SDK
  // clients share the same Basic auth material.
  export function workerAuth() {
    const password = Flag.KILO_SERVER_PASSWORD ?? randomUUID()
    const username = Flag.KILO_SERVER_USERNAME ?? "kilo"
    return {
      env: { KILO_SERVER_USERNAME: username, KILO_SERVER_PASSWORD: password },
      headers: ServerAuth.headers({ password, username }),
    }
  }

  export async function attach(input: Input) {
    const daemon = await DaemonClient.maybe()
    if (!daemon) return false

    const prompt = await input.input()
    const config = await TuiConfig.get()

    const fork = await session(input, daemon)
    if (!fork.ok) return true

    try {
      await validateSession({
        url: daemon.url,
        sessionID: fork.id,
        directory: input.cwd,
        headers: daemon.headers,
      })
    } catch (error) {
      UI.error(errorMessage(error))
      process.exitCode = 1
      return true
    }

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
