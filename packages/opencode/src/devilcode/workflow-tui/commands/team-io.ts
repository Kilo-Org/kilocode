// packages/opencode/src/devilcode/workflow-tui/commands/team-io.ts
// Phase 6 — /team export <path> and /team import <path> command handlers + registry bindings.
import path from "path"
import type { Command } from "@devilcode/keybind"
import {
  exportTeamToFile,
  importTeamFromFile,
  TeamImportError,
  TeamVersionMismatchError,
  TeamChecksumError,
  TeamSchemaValidationError,
} from "../../team"
import type { CanonicalTeamConfig } from "../../team/config"

type RegisterFn = (cmd: Command) => () => void

export type TeamIOCommandHandlers = {
  getActiveTeam: () => CanonicalTeamConfig | undefined
  onImported: (config: CanonicalTeamConfig) => Promise<void>
  prompt: (placeholder: string) => Promise<string | undefined>
  toast: {
    success: (msg: string) => void
    error: (msg: string) => void
    warning: (msg: string) => void
  }
}

export async function exportCommand(
  args: { path: string },
  handlers: TeamIOCommandHandlers,
): Promise<void> {
  if (!args.path) {
    handlers.toast.warning("Usage: team export <path>")
    return
  }
  const config = handlers.getActiveTeam()
  if (!config) {
    handlers.toast.warning("No active team to export")
    return
  }
  const resolvedPath = path.resolve(args.path)
  try {
    const envelope = await exportTeamToFile(resolvedPath, config, { exportedBy: undefined })
    handlers.toast.success(
      `Team exported to ${resolvedPath} (${envelope.checksum.slice(0, 12)}...)`,
    )
  } catch (err) {
    handlers.toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function importCommand(
  args: { path: string },
  handlers: TeamIOCommandHandlers,
): Promise<void> {
  if (!args.path) {
    handlers.toast.warning("Usage: team import <path>")
    return
  }
  const resolvedPath = path.resolve(args.path)
  try {
    const imported = await importTeamFromFile(resolvedPath)
    await handlers.onImported(imported)
    handlers.toast.success("Team imported")
  } catch (err) {
    if (err instanceof TeamVersionMismatchError) {
      handlers.toast.error(`Version mismatch: ${err.found} (need ${err.required})`)
    } else if (err instanceof TeamChecksumError) {
      handlers.toast.error("Checksum failed — file may be corrupted")
    } else if (err instanceof TeamSchemaValidationError) {
      handlers.toast.error(`Schema invalid (${err.layer}): ${err.issues.length} issue(s)`)
    } else if (err instanceof TeamImportError && err.kind === "file-not-found") {
      handlers.toast.error(`File not found: ${resolvedPath}`)
    } else if (err instanceof TeamImportError && err.kind === "json-parse-failed") {
      handlers.toast.error("Invalid JSON")
    } else {
      handlers.toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export function registerTeamIOCommands(
  register: RegisterFn,
  handlers: TeamIOCommandHandlers,
): () => void {
  const unregisterExport = register({
    id: "workflow.team.export",
    title: "Team: Export",
    scope: "workflow",
    aliases: ["team export"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => {
      handlers.toast.warning("Type 'team export <path>' in the prompt to execute")
    },
  } as Command)

  const unregisterImport = register({
    id: "workflow.team.import",
    title: "Team: Import",
    scope: "workflow",
    aliases: ["team import"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => {
      handlers.toast.warning("Type 'team import <path>' in the prompt to execute")
    },
  } as Command)

  return () => {
    unregisterExport()
    unregisterImport()
  }
}
