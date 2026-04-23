import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { NamedError } from "@opencode-ai/shared/util/error"

const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },
  { name: "Visual Studio Code" as const, cmd: "code" },
  { name: "Cursor" as const, cmd: "cursor" },
  { name: "VSCodium" as const, cmd: "codium" },
]

export const Event = {
  Installed: BusEvent.define(
    "ide.installed",
    z.object({
      ide: z.string(),
    }),
  ),
}

export const AlreadyInstalledError = NamedError.create("AlreadyInstalledError", z.object({}))

export const InstallFailedError = NamedError.create(
  "InstallFailedError",
  z.object({
    stderr: z.string(),
  }),
)

export function ide() {
  if (process.env["TERM_PROGRAM"] === "vscode") {
    const v = process.env["GIT_ASKPASS"]
    for (const ide of SUPPORTED_IDES) {
      if (v?.includes(ide.name)) return ide.name
    }
  }
  return "unknown"
}

export function alreadyInstalled() {
  return process.env["KILO_CALLER"] === "vscode" || process.env["KILO_CALLER"] === "vscode-insiders"
}

// kilocode_change start - Kilo's VS Code extension bundles the CLI; auto-install from CLI is not applicable
export async function install(_ide: (typeof SUPPORTED_IDES)[number]["name"]) {
  throw new AlreadyInstalledError({})
}
// kilocode_change end

export * as Ide from "."
