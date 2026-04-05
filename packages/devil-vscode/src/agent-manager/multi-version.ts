import { MAX_MULTI_VERSIONS } from "./constants"

export interface ModelAllocation {
  providerID: string
  modelID: string
  count: number
}

interface ModelRef {
  providerID: string
  modelID: string
}

/**
 * Expand model allocations into a flat per-version model list,
 * compute the final version count, and derive the fallback model.
 *
 * Pure function — no vscode imports.
 */
export function resolveVersionModels(
  allocations: ModelAllocation[] | undefined,
  fallback: ModelRef | undefined,
  requested: number,
): {
  models: Array<ModelRef | undefined>
  versions: number
  providerID: string | undefined
  modelID: string | undefined
} {
  const models: Array<ModelRef | undefined> = []
  if (allocations && allocations.length > 0) {
    for (const alloc of allocations) {
      const clamped = Math.min(Math.max(Math.floor(alloc.count) || 0, 0), MAX_MULTI_VERSIONS)
      for (let c = 0; c < clamped; c++) {
        models.push({ providerID: alloc.providerID, modelID: alloc.modelID })
      }
      if (models.length >= MAX_MULTI_VERSIONS) break
    }
  }

  const compare = models.length > 0
  const versions = compare
    ? Math.min(models.length, MAX_MULTI_VERSIONS)
    : Math.min(Math.max(requested, 1), MAX_MULTI_VERSIONS)

  return {
    models,
    versions,
    providerID: compare ? undefined : fallback?.providerID,
    modelID: compare ? undefined : fallback?.modelID,
  }
}

export interface CreatedVersion {
  worktreeId: string
  sessionId: string
  path: string
  branch: string
  parentBranch: string
  versionIndex: number
}

export interface InitialMessage {
  sessionId: string
  worktreeId: string
  text?: string
  providerID?: string
  modelID?: string
  agent?: string
  files?: Array<{ mime: string; url: string }>
}

/**
 * Build the list of initial messages to send for each created version.
 *
 * Pure function — no vscode imports.
 */
export function buildInitialMessages(
  created: CreatedVersion[],
  models: Array<ModelRef | undefined>,
  fallback: { providerID?: string; modelID?: string },
  prompt?: string,
  agent?: string,
  files?: Array<{ mime: string; url: string }>,
): InitialMessage[] {
  return created.map((entry) => {
    const model = models[entry.versionIndex]
    const pid = model?.providerID ?? fallback.providerID
    const mid = model?.modelID ?? fallback.modelID
    const msg: InitialMessage = {
      sessionId: entry.sessionId,
      worktreeId: entry.worktreeId,
      providerID: pid,
      modelID: mid,
    }
    if (prompt) {
      msg.text = prompt
      msg.agent = agent
      msg.files = files
    }
    return msg
  })
}
