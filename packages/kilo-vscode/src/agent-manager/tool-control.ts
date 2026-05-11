import type { KiloClient } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"
import type { PanelContext } from "./host"
import type { WorktreeStateManager } from "./WorktreeStateManager"

export interface ControlRequest {
  requestID: string
  sessionID?: string
  directory?: string
  action: "prompt" | "stop" | "create_section" | "rename_section" | "remove_section" | "move_to_section" | "ungroup"
  targetSessionID?: string
  prompt?: string
  worktreeID?: string
  sectionID?: string
  sectionName?: string
  newSectionName?: string
  color?: string
  createIfMissing?: boolean
}

export interface ControlDeps {
  getClient: () => KiloClient
  getRoot: () => string | undefined
  getState: () => WorktreeStateManager | undefined
  getPanel: () => PanelContext | undefined
  openPanel: (preserveFocus?: boolean) => void
  waitReady: (context: string) => Promise<void>
  respond: (requestID: string, res: ControlResult) => Promise<void>
  push: () => void
  post: (msg: unknown) => void
  capture: (event: string, props?: Record<string, unknown>) => void
  log: (...args: unknown[]) => void
  error: (msg: string) => void
}

export interface ControlResult {
  action: ControlRequest["action"]
  applied: boolean
  message: string
  sessionID?: string
  worktreeID?: string
  sectionID?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function color(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function directory(deps: ControlDeps, sid: string, req: ControlRequest): string | undefined {
  const state = deps.getState()
  const session = state?.getSession(sid)
  if (!session) return undefined
  if (!session.worktreeId) return deps.getRoot()
  return state?.getWorktree(session.worktreeId)?.path
}

function worktree(deps: ControlDeps, req: ControlRequest): string | undefined {
  const state = deps.getState()
  if (!state) return undefined
  const wid = text(req.worktreeID)
  if (wid) return state.getWorktree(wid) ? wid : undefined
  const sid = text(req.targetSessionID)
  const session = sid ? state.getSession(sid) : undefined
  return session?.worktreeId ?? undefined
}

function section(deps: ControlDeps, req: ControlRequest): string | null | undefined {
  const state = deps.getState()
  if (!state) return undefined
  const sid = text(req.sectionID)
  if (sid) return state.getSection(sid) ? sid : undefined
  const name = text(req.sectionName)
  if (!name) return null
  const found = state.getSections().find((sec) => sec.name.toLowerCase() === name.toLowerCase())
  if (found) return found.id
  if (!req.createIfMissing) return undefined
  return state.addSection(name, color(req.color) ?? null).id
}

async function prompt(deps: ControlDeps, req: ControlRequest): Promise<ControlResult> {
  const sid = text(req.targetSessionID)
  const body = text(req.prompt)
  if (!sid || !body) {
    return { action: req.action, applied: false, message: "Agent Manager prompt requires sessionID and prompt." }
  }
  const dir = directory(deps, sid, req)
  if (!dir) {
    return {
      action: req.action,
      applied: false,
      message: `Agent Manager prompt could not resolve directory for session ${sid}.`,
      sessionID: sid,
    }
  }
  await deps.getClient().session.promptAsync(
    {
      sessionID: sid,
      directory: dir,
      parts: [{ type: "text", text: body }],
    },
    { throwOnError: true },
  )
  deps.capture("Agent Manager Session Prompted", { sessionId: sid, tool: true })
  deps.log(`Prompted Agent Manager session ${sid} for request ${req.requestID}`)
  return { action: req.action, applied: true, message: `Prompted session ${sid}.`, sessionID: sid }
}

async function stop(deps: ControlDeps, req: ControlRequest): Promise<ControlResult> {
  const sid = text(req.targetSessionID)
  if (!sid) {
    return { action: req.action, applied: false, message: "Agent Manager stop requires sessionID." }
  }
  const dir = directory(deps, sid, req)
  await deps
    .getClient()
    .session.abort(dir ? { sessionID: sid, directory: dir } : { sessionID: sid }, { throwOnError: true })
  deps.capture("Agent Manager Session Stopped", { sessionId: sid, tool: true })
  deps.log(`Stopped Agent Manager session ${sid} for request ${req.requestID}`)
  return { action: req.action, applied: true, message: `Stopped session ${sid}.`, sessionID: sid }
}

function createSection(deps: ControlDeps, req: ControlRequest): ControlResult {
  const state = deps.getState()
  const name = text(req.sectionName)
  if (!state || !name) {
    return { action: req.action, applied: false, message: "Agent Manager create_section requires a section name." }
  }
  const found = state.getSections().find((sec) => sec.name.toLowerCase() === name.toLowerCase())
  if (found) {
    deps.log(`Agent Manager section already exists: ${found.id} (${found.name})`)
    return { action: req.action, applied: true, message: `Section already exists: ${found.name}.`, sectionID: found.id }
  }
  const sec = state.addSection(name, color(req.color) ?? null)
  deps.push()
  deps.capture("Agent Manager Section Created", { sectionId: sec.id, name: sec.name, tool: true })
  deps.log(`Created Agent Manager section ${sec.id} (${sec.name}) for request ${req.requestID}`)
  return { action: req.action, applied: true, message: `Created section ${sec.name}.`, sectionID: sec.id }
}

function sectionID(deps: ControlDeps, req: ControlRequest): string | undefined {
  const state = deps.getState()
  if (!state) return undefined
  const sid = text(req.sectionID)
  if (sid) return state.getSection(sid) ? sid : undefined
  const name = text(req.sectionName)
  if (!name) return undefined
  return state.getSections().find((sec) => sec.name.toLowerCase() === name.toLowerCase())?.id
}

function renameSection(deps: ControlDeps, req: ControlRequest): ControlResult {
  const state = deps.getState()
  const sid = sectionID(deps, req)
  const name = text(req.newSectionName)
  if (!state || !sid || !name) {
    return {
      action: req.action,
      applied: false,
      message: "Agent Manager rename_section requires a known section and newSectionName.",
    }
  }
  state.renameSection(sid, name)
  deps.push()
  deps.capture("Agent Manager Section Renamed", { sectionId: sid, name, tool: true })
  deps.log(`Renamed Agent Manager section ${sid} to ${name} for request ${req.requestID}`)
  return { action: req.action, applied: true, message: `Renamed section to ${name}.`, sectionID: sid }
}

function removeSection(deps: ControlDeps, req: ControlRequest): ControlResult {
  const state = deps.getState()
  const sid = sectionID(deps, req)
  if (!state || !sid) {
    return { action: req.action, applied: false, message: "Agent Manager remove_section requires a known section." }
  }
  state.deleteSection(sid)
  deps.push()
  deps.capture("Agent Manager Section Removed", { sectionId: sid, tool: true })
  deps.log(`Removed Agent Manager section ${sid} for request ${req.requestID}`)
  return { action: req.action, applied: true, message: `Removed section ${sid}.`, sectionID: sid }
}

function move(deps: ControlDeps, req: ControlRequest): ControlResult {
  const state = deps.getState()
  if (!state) {
    return { action: req.action, applied: false, message: "Agent Manager move_to_section requires Agent Manager state." }
  }
  const wid = worktree(deps, req)
  if (!wid) {
    return {
      action: req.action,
      applied: false,
      message: "Agent Manager move_to_section target is not a known worktree-backed card.",
    }
  }
  const sec = section(deps, req)
  if (sec === undefined) {
    return { action: req.action, applied: false, message: "Agent Manager move_to_section could not resolve target section." }
  }
  state.moveToSection([wid], sec)
  deps.push()
  deps.capture("Agent Manager Card Moved", { worktreeId: wid, sectionId: sec, tool: true })
  deps.log(`Moved Agent Manager worktree ${wid} to ${sec ?? "ungrouped"} for request ${req.requestID}`)
  return { action: req.action, applied: true, message: `Moved worktree ${wid}.`, worktreeID: wid, sectionID: sec ?? undefined }
}

function ungroup(deps: ControlDeps, req: ControlRequest): ControlResult {
  const state = deps.getState()
  if (!state) {
    return { action: req.action, applied: false, message: "Agent Manager ungroup requires Agent Manager state." }
  }
  const wid = worktree(deps, req)
  if (!wid) {
    return {
      action: req.action,
      applied: false,
      message: "Agent Manager ungroup target is not a known worktree-backed card.",
    }
  }
  state.moveToSection([wid], null)
  deps.push()
  deps.capture("Agent Manager Card Ungrouped", { worktreeId: wid, tool: true })
  deps.log(`Ungrouped Agent Manager worktree ${wid} for request ${req.requestID}`)
  return { action: req.action, applied: true, message: `Ungrouped worktree ${wid}.`, worktreeID: wid }
}

export async function controlFromTool(deps: ControlDeps, req: ControlRequest): Promise<void> {
  deps.openPanel(true)
  await deps.getPanel()?.waitForReady()
  await deps.waitReady("controlFromTool")
  try {
    const res =
      req.action === "prompt"
        ? await prompt(deps, req)
        : req.action === "stop"
          ? await stop(deps, req)
          : req.action === "create_section"
            ? createSection(deps, req)
            : req.action === "rename_section"
              ? renameSection(deps, req)
              : req.action === "remove_section"
                ? removeSection(deps, req)
                : req.action === "ungroup"
                  ? ungroup(deps, req)
                  : move(deps, req)
    if (!res.applied) deps.log(`Agent Manager control request ${req.requestID} did not apply: ${res.message}`)
    await deps.respond(req.requestID, res)
  } catch (err) {
    const msg = getErrorMessage(err)
    deps.log("Agent Manager control request failed", msg)
    deps.post({ type: "error", message: `Agent Manager control request failed: ${msg}` })
    await deps.respond(req.requestID, { action: req.action, applied: false, message: msg })
  }
}

export function parseControlRequest(value: unknown): ControlRequest | undefined {
  if (!record(value)) return undefined
  const action = value.action
  if (
    action !== "prompt" &&
    action !== "stop" &&
    action !== "create_section" &&
    action !== "rename_section" &&
    action !== "remove_section" &&
    action !== "move_to_section" &&
    action !== "ungroup"
  ) {
    return undefined
  }
  return {
    requestID: text(value.requestID) ?? `am-${Date.now()}`,
    sessionID: text(value.sessionID),
    directory: text(value.directory),
    action,
    targetSessionID: text(value.targetSessionID),
    prompt: text(value.prompt),
    worktreeID: text(value.worktreeID),
    sectionID: text(value.sectionID),
    sectionName: text(value.sectionName),
    newSectionName: text(value.newSectionName),
    color: color(value.color),
    createIfMissing: bool(value.createIfMissing),
  }
}
