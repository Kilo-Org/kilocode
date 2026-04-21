// packages/opencode/src/devilcode/workflow-tui/commands/team-registry.ts
// Phase 8 — team publish/install/trust/untrust command handlers + registry bindings.
import fs from "fs/promises"
import path from "path"
import type { Command } from "@devilcode/keybind"
import { publishManifest, installManifest } from "../../team/registry/io"
import { addTrustedPublisher, removeTrustedPublisher } from "../../team/registry/trust-store"
import {
  TeamSignatureError,
  TeamPublisherNotTrusted,
  TeamManifestFetchFailed,
  TeamManifestInvalid,
} from "../../team/registry/errors"
import type { CanonicalTeamConfig } from "../../team/config"

type RegisterFn = (cmd: Command) => () => void

export type TeamRegistryCommandHandlers = {
  getActiveTeam: () => CanonicalTeamConfig | undefined
  onInstalled: (config: CanonicalTeamConfig) => Promise<void>
  toast: {
    success: (msg: string, duration?: number) => void
    error: (msg: string, duration?: number) => void
    warning: (msg: string, duration?: number) => void
  }
}

export async function publishCommand(
  args: { path: string; name: string; author: string; publisherId?: string; version: string; sign?: string },
  handlers: TeamRegistryCommandHandlers,
): Promise<void> {
  const config = handlers.getActiveTeam()
  if (!config) {
    handlers.toast.error("No active team to publish")
    return
  }

  const resolvedPath = path.resolve(args.path)
  const publisherId = args.publisherId ?? "550e8400-e29b-41d4-a716-446655440000"

  try {
    let privateKey: string | undefined
    if (args.sign) {
      const keyPath = path.resolve(args.sign)
      privateKey = await fs.readFile(keyPath, "utf-8")
    }

    const manifest = await publishManifest(config, resolvedPath, {
      name: args.name,
      author: args.author,
      publisherId,
      version: args.version,
      privateKey,
    })

    const sigNote = manifest.signature ? " (signed)" : " (unsigned)"
    handlers.toast.success(`Team manifest published to ${resolvedPath}${sigNote}`)
  } catch (err) {
    handlers.toast.error(`Publish failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function installCommand(
  args: { source: string },
  handlers: TeamRegistryCommandHandlers,
): Promise<void> {
  try {
    const { config, warnings } = await installManifest(args.source)

    for (const w of warnings) {
      handlers.toast.warning(w)
    }

    await handlers.onInstalled(config)
    handlers.toast.success("Team installed successfully")
  } catch (err) {
    if (err instanceof TeamPublisherNotTrusted) {
      handlers.toast.error(`Publisher not trusted: ${err.publisherId}. Use 'team trust' to add them.`)
    } else if (err instanceof TeamSignatureError) {
      handlers.toast.error(`Signature verification failed: ${err.message}`)
    } else if (err instanceof TeamManifestFetchFailed) {
      handlers.toast.error(`Failed to fetch manifest: ${err.message}`)
    } else if (err instanceof TeamManifestInvalid) {
      handlers.toast.error(`Invalid manifest: ${err.message}`)
    } else {
      handlers.toast.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export async function trustCommand(
  args: { keyFile: string; publisherId: string },
  handlers: TeamRegistryCommandHandlers,
): Promise<void> {
  try {
    const keyPath = path.resolve(args.keyFile)
    const publicKey = await fs.readFile(keyPath, "utf-8")
    await addTrustedPublisher(args.publisherId, publicKey)
    handlers.toast.success(`Publisher "${args.publisherId}" added to trust store`)
  } catch (err) {
    handlers.toast.error(`Trust failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function untrustCommand(
  args: { publisherId: string },
  handlers: TeamRegistryCommandHandlers,
): Promise<void> {
  try {
    const removed = await removeTrustedPublisher(args.publisherId)
    if (removed) {
      handlers.toast.success(`Publisher "${args.publisherId}" removed from trust store`)
    } else {
      handlers.toast.warning(`Publisher "${args.publisherId}" was not in the trust store`)
    }
  } catch (err) {
    handlers.toast.error(`Untrust failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function registerTeamRegistryCommands(
  register: RegisterFn,
  handlers: TeamRegistryCommandHandlers,
): () => void {
  const unregisterPublish = register({
    id: "workflow.team.publish",
    title: "Team: Publish Manifest",
    scope: "workflow",
    aliases: ["team publish"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => {
      handlers.toast.warning(
        "Type 'team publish <path> --name=<n> --author=<a> --version=<v> [--sign=<keyfile>]' in the prompt to execute",
      )
    },
  } as Command)

  const unregisterInstall = register({
    id: "workflow.team.install",
    title: "Team: Install from Registry",
    scope: "workflow",
    aliases: ["team install"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => {
      handlers.toast.warning("Type 'team install <url-or-path>' in the prompt to execute")
    },
  } as Command)

  const unregisterTrust = register({
    id: "workflow.team.trust",
    title: "Team: Trust Publisher",
    scope: "workflow",
    aliases: ["team trust"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => {
      handlers.toast.warning("Type 'team trust <keyfile> <publisher-id>' in the prompt to execute")
    },
  } as Command)

  const unregisterUntrust = register({
    id: "workflow.team.untrust",
    title: "Team: Untrust Publisher",
    scope: "workflow",
    aliases: ["team untrust"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => {
      handlers.toast.warning("Type 'team untrust <publisher-id>' in the prompt to execute")
    },
  } as Command)

  return () => {
    unregisterPublish()
    unregisterInstall()
    unregisterTrust()
    unregisterUntrust()
  }
}
