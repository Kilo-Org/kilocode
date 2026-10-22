import type { BranchListItem } from "../git-import"
import { normalizeBaseBranch } from "../base-branch"
import { initContextState } from "./init"
import type { ProjectContext } from "./context"
import type { ProjectContexts, ProjectSnapshot } from "./contexts"

export interface SettingsProject {
  id: string
  root: string
  label: string
  pinned: boolean
  missing: boolean
  defaultBaseBranch?: string
  defaultBranch?: string
  setupScriptPath?: string
}

export interface SettingsBranches {
  projectId: string
  branches: BranchListItem[]
  defaultBranch: string
  configuredBaseBranch?: string
  setupScriptPath?: string
}

export interface SettingsHandler {
  projects(projectId?: string): Promise<SettingsProject[]>
  projectDirectory(projectId: string): string | undefined
  defaultBranch(projectId: string): Promise<string | undefined>
  branches(projectId: string): Promise<SettingsBranches | undefined>
  setDefaultBaseBranch(projectId: string, branch?: string): Promise<void>
  configureSetupScript(projectId: string): Promise<void>
}

export function createSettingsHandler(opts: {
  contexts: ProjectContexts
  open: (path: string) => Promise<void>
  push: (ctx: ProjectContext) => void
  log: (...args: unknown[]) => void
}): SettingsHandler {
  return {
    projects: (projectId) => loadSettingsProjects(opts.contexts, projectId, opts.log),
    projectDirectory: (id) => settingsDirectory(opts.contexts, id),
    defaultBranch: (id) => settingsDefaultBranch(opts.contexts, id, opts.log),
    branches: (id) => settingsBranches(opts.contexts, id, opts.log, opts.push),
    setDefaultBaseBranch: (id, branch) => setSettingsDefaultBaseBranch(opts.contexts, id, branch, opts.log, opts.push),
    configureSetupScript: (id) => configureSettingsSetupScript(opts.contexts, id, opts.open, opts.log),
  }
}

export function settingsProjects(contexts: ProjectContexts): SettingsProject[] {
  return contexts.snapshots().map((project) => settingsProject(contexts, project))
}

async function loadSettingsProjects(
  contexts: ProjectContexts,
  projectId: string | undefined,
  log: (...args: unknown[]) => void,
): Promise<SettingsProject[]> {
  const snapshots = contexts.snapshots()
  const selected = snapshots.some((project) => project.id === projectId) ? projectId : snapshots.at(0)?.id
  const ctx = selected ? contexts.resolve(selected) : undefined
  if (ctx && !ctx.missing()) {
    const init = await initContextState(ctx, log)
    if (init.ok && init.current) ctx.setupService()
  }
  return settingsProjects(contexts)
}

function settingsProject(contexts: ProjectContexts, project: ProjectSnapshot): SettingsProject {
  const ctx = contexts.get(project.id)
  return {
    id: project.id,
    root: project.root,
    label: project.label,
    pinned: project.pinned,
    missing: project.missing,
    defaultBaseBranch: ctx?.peekState()?.getDefaultBaseBranch(),
    setupScriptPath: ctx?.peekSetup()?.resolveScript()?.path,
  }
}

export function settingsDirectory(contexts: ProjectContexts, projectId: string): string | undefined {
  return contexts.resolve(projectId)?.root
}

export async function settingsDefaultBranch(
  contexts: ProjectContexts,
  projectId: string,
  log: (...args: unknown[]) => void,
): Promise<string | undefined> {
  const ctx = contexts.resolve(projectId)
  if (!ctx || ctx.missing()) return undefined
  return ctx
    .worktreeManager()
    .defaultBranch()
    .catch((err) => {
      log(`Failed to load settings default branch for ${projectId}:`, err)
      return undefined
    })
}

export async function settingsBranches(
  contexts: ProjectContexts,
  projectId: string,
  log: (...args: unknown[]) => void,
  push: (ctx: ProjectContext) => void,
): Promise<SettingsBranches | undefined> {
  const ctx = contexts.resolve(projectId)
  if (!ctx || ctx.missing()) return undefined
  const init = await initContextState(ctx, log)
  if (!init.ok || !init.current) return undefined
  const result = await ctx
    .worktreeManager()
    .listBranches()
    .catch((err) => {
      log(`Failed to load settings branches for ${projectId}:`, err)
      return undefined
    })
  if (!result) return undefined
  const configured = ctx.peekState()?.getDefaultBaseBranch()
  const valid = configured && result.branches.some((branch) => branch.name === configured)
  if (configured && !valid) {
    ctx.peekState()?.setDefaultBaseBranch(undefined)
    push(ctx)
  }
  return {
    projectId,
    branches: result.branches,
    defaultBranch: result.defaultBranch,
    configuredBaseBranch: valid ? configured : undefined,
    setupScriptPath: ctx.setupService().resolveScript()?.path,
  }
}

export async function setSettingsDefaultBaseBranch(
  contexts: ProjectContexts,
  projectId: string,
  branch: string | undefined,
  log: (...args: unknown[]) => void,
  push: (ctx: ProjectContext) => void,
): Promise<void> {
  const ctx = contexts.resolve(projectId)
  if (!ctx || ctx.missing()) return
  const init = await initContextState(ctx, log)
  if (!init.ok || !init.current) return
  ctx.peekState()?.setDefaultBaseBranch(normalizeBaseBranch(branch))
  push(ctx)
}

export async function configureSettingsSetupScript(
  contexts: ProjectContexts,
  projectId: string,
  open: (path: string) => Promise<void>,
  log: (...args: unknown[]) => void,
): Promise<void> {
  const ctx = contexts.resolve(projectId)
  if (!ctx || ctx.missing()) return
  const service = ctx.setupService()
  try {
    if (!service.hasScript()) await service.createDefaultScript()
    const script = service.resolveScript()
    if (!script) return
    await open(script.path)
  } catch (err) {
    log(`Failed to open setup script for ${projectId}:`, err)
  }
}
