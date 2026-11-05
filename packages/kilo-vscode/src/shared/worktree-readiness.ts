import type { ReadinessFix } from "../../webview-ui/src/types/messages/agent-manager"

export const SETUP_TIMEOUT_MS = 5 * 60_000
/** Installing a package can exceed the setup script's five-minute budget. */
export const INSTALL_TIMEOUT_MS = 30 * 60_000
export const APPLE_LAUNCH_TIMEOUT_MS = 60_000
/** How long a check may take before creation proceeds as if it had not run. */
export const READINESS_DEADLINE_MS = 3_000
export const FIX_DEADLINE_MS = 10 * 60_000
export const MARGIN_MS = 5 * 60_000
/** Longer than the two chained install tasks so the task's own error wins. */
export const INSTALL_DEADLINE_MS = INSTALL_TIMEOUT_MS * 2 + MARGIN_MS

/** The two installable tools and their fix names. */
export const TOOL_FIXES = {
  git: { install: "installGit", download: "downloadGit" },
  lfs: { install: "installLfs", download: "downloadLfs" },
} as const

export type Tool = keyof typeof TOOL_FIXES
export type InstallFix = (typeof TOOL_FIXES)[Tool]["install"]
export type DownloadFix = (typeof TOOL_FIXES)[Tool]["download"]

export const VERSION_OPTIONS = [1, 2, 3, 4] as const
export type VersionCount = (typeof VERSION_OPTIONS)[number]

export const TOOL_LABELS: Record<Tool, string> = { git: "Git", lfs: "Git LFS" }
export const TOOL_CODES = { git: "git_not_found", lfs: "lfs_missing" } as const

const TOOLS = Object.keys(TOOL_FIXES) as Tool[]

export function toolForCode(code: string | undefined): Tool | undefined {
  return TOOLS.find((tool) => TOOL_CODES[tool] === code)
}

export function toolFor(fix: ReadinessFix | undefined): Tool | undefined {
  if (!fix) return undefined
  return TOOLS.find((tool) => TOOL_FIXES[tool].install === fix || TOOL_FIXES[tool].download === fix)
}

export function isInstall(fix: ReadinessFix | undefined): fix is InstallFix {
  return TOOLS.some((tool) => TOOL_FIXES[tool].install === fix)
}

export function isDownload(fix: ReadinessFix | undefined): fix is DownloadFix {
  return TOOLS.some((tool) => TOOL_FIXES[tool].download === fix)
}

export function toolForInstall(fix: InstallFix): Tool {
  const tool = TOOLS.find((item) => TOOL_FIXES[item].install === fix)
  if (!tool) throw new Error(`Unknown install fix: ${fix}`)
  return tool
}

export function installFix(tool: Tool): InstallFix {
  return TOOL_FIXES[tool].install
}

export function downloadFix(tool: Tool): DownloadFix {
  return TOOL_FIXES[tool].download
}

export function labelForFix(fix: ReadinessFix | undefined): string {
  const tool = toolFor(fix)
  return tool ? TOOL_LABELS[tool] : TOOL_LABELS.lfs
}

export function codeForTool(tool: Tool) {
  return TOOL_CODES[tool]
}

export function stderrText(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const data = error as { stderr?: unknown }
  return typeof data.stderr === "string" && data.stderr.trim() ? data.stderr.trim() : undefined
}

export function errorText(error: unknown): string {
  const stderr = stderrText(error)
  if (stderr) return stderr
  if (error && typeof error === "object") {
    const data = error as { message?: unknown }
    if (typeof data.message === "string" && data.message.trim()) return data.message.trim()
  }
  return String(error)
}
