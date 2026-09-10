import * as path from "path"
import { sameDirectory } from "../kilo-provider-utils"

export type RequirementStatus = "ready" | "missing" | "error"

export type RequirementState = "disabled" | "ready" | "blocked" | "error"

export type RequirementErrorCode =
  | "unknown_agent"
  | "malformed_declaration"
  | "discovery_failed"
  | "mcp_status_failed"
  | "scope_mismatch"
  | "request_failed"

export type RequirementItem = {
  name: string
  status: RequirementStatus
  message?: string
}

export type BackendVSCodeExtensionRequirement = {
  name: string
  id: string
  message?: string
}

export type BackendAgentRequirementResult = {
  agent: string
  directory: string
  enabled: boolean
  state: RequirementState
  skills: RequirementItem[]
  mcps: RequirementItem[]
  vscode_extensions: BackendVSCodeExtensionRequirement[]
  error?: {
    code: RequirementErrorCode
    message: string
  }
}

export type HostVSCodeExtensionRequirement = BackendVSCodeExtensionRequirement & {
  status: RequirementStatus
}

export type HostAgentRequirementResult = Omit<BackendAgentRequirementResult, "vscode_extensions"> & {
  vscode_extensions: HostVSCodeExtensionRequirement[]
}

export type RequirementDirectoryInput = {
  requested: string
  sessionID?: string
  workspaceDirectory: string
  workspaceDirectories?: readonly string[]
  projectDirectory?: string | null
  sessionDirectories: ReadonlyMap<string, string>
  worktreeDirectories?: () => readonly string[]
}

export type VSCodeExtensionLookup = (id: string) => unknown

function normalize(directory: string): string {
  if (!directory) return ""
  const resolved = path.resolve(directory)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function requirementKey(agent: string, directory: string): string {
  return `${normalize(directory)}\0${agent}`
}

export function requirementDirectory(input: RequirementDirectoryInput): string | undefined {
  if (!input.requested) return undefined

  const dirs = [
    input.sessionID ? input.sessionDirectories.get(input.sessionID) : undefined,
    input.workspaceDirectory,
    ...(input.workspaceDirectories ?? []),
    input.projectDirectory ?? undefined,
    ...input.sessionDirectories.values(),
    ...(input.worktreeDirectories?.() ?? []),
  ].filter((dir): dir is string => !!dir)

  return dirs.find((dir) => sameDirectory(dir, input.requested))
}

export function applyVSCodeExtensionRequirements(
  result: BackendAgentRequirementResult,
  lookup: VSCodeExtensionLookup,
): HostAgentRequirementResult {
  const extensions = result.vscode_extensions.map((extension) => {
    const status: RequirementStatus = lookup(extension.id) ? "ready" : "missing"
    return { ...extension, status }
  })
  const blocked =
    result.enabled && result.state === "ready" && extensions.some((extension) => extension.status !== "ready")

  return {
    ...result,
    state: blocked ? "blocked" : result.state,
    vscode_extensions: extensions,
  }
}
