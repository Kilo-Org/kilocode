import { getErrorMessage } from "../kilo-provider-utils"
import { PLATFORM } from "./constants"
import type { ProjectContext } from "./project/context"
import type { AgentManagerInMessage } from "./types"
import { versionedName } from "./branch-name"
import { resolveVersionModels, buildInitialMessages, type CreatedVersion } from "./multi-version"
import { ensureSandbox } from "./sandbox-bootstrap"
import type { LifecycleHost } from "./provider-lifecycle"
import { Semaphore } from "./semaphore"

const PROVISION_CONCURRENCY = 2

/**
 * Multi-version creation needs the lifecycle capabilities plus three provider
 * services of its own: worktree discard for failed versions, the branch
 * naming controller for the initial prompt, and user-facing error reporting.
 */
export interface MultiVersionHost extends LifecycleHost {
  discard: (id: string, dir: string, branch: string, sessionId?: string) => Promise<void>
  promptName: (input: { sessionID: string; text: string; providerID?: string; modelID?: string }) => void
  error: (message: string) => void
}

/**
 * Create N worktrees, provision their sessions with bounded concurrency, then
 * send each initial prompt as soon as that session is ready. State is reached
 * through the project context; everything else goes through the host.
 */
export async function createMultiVersion(
  ctx: ProjectContext,
  host: MultiVersionHost,
  msg: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>,
): Promise<null> {
  const text = msg.text?.trim() || undefined

  const worktreeName = msg.name?.trim() || undefined
  const agent = msg.agent
  const files = msg.files
  const baseBranch = msg.baseBranch
  const branchName = msg.branchName?.trim() || undefined

  const fallback = msg.providerID && msg.modelID ? { providerID: msg.providerID, modelID: msg.modelID } : undefined
  const resolved = resolveVersionModels(msg.modelAllocations, fallback, Number(msg.versions) || 1)
  const { models, versions, providerID, modelID } = resolved

  // Generate a shared group ID for multi-version worktrees
  const groupId = versions > 1 ? `grp-${Date.now()}` : undefined

  host.log(
    `Creating ${versions} worktrees${models.length > 0 ? " (model comparison)" : ""}${text ? ` for: ${text.slice(0, 60)}` : ""}${groupId ? ` (group=${groupId})` : ""}`,
  )

  // Notify webview that multi-version creation has started
  host.post({
    type: "agentManager.multiVersionProgress",
    projectId: ctx.id,
    status: "creating",
    total: versions,
    completed: 0,
    groupId,
  })

  // Phase 1: finish every shared-repository Git mutation before setup scripts
  // or agents can run their own Git commands in the new worktrees.
  const created: CreatedVersion[] = []

  const specs = Array.from({ length: versions }, (_, index) => ({
    index,
    versions,
    groupId,
    baseBranch,
    branchName,
    worktreeName,
    models,
    providerID,
    modelID,
    sandbox: msg.sandbox,
  }))
  const prepared: PreparedVersion[] = []
  for (const spec of specs) {
    const version = await prepareVersion(host, spec)
    if (version) prepared.push(version)
  }

  // Phase 2: Git creation is complete, so independent setup/session pipelines
  // can overlap without racing the shared worktree metadata mutation.
  const provision = async (version: PreparedVersion) => {
    const ready = await provisionVersion(ctx, host, version)
    if (!ready) return
    created.push(ready)

    sendInitialPrompt(
      host,
      ctx.id,
      ready,
      models,
      { providerID, modelID },
      {
        text,
        agent,
        variant: msg.variant,
        files,
      },
    )

    host.post({
      type: "agentManager.multiVersionProgress",
      projectId: ctx.id,
      status: "creating",
      total: versions,
      completed: created.length,
      groupId,
    })
  }

  const gate = new Semaphore(PROVISION_CONCURRENCY)
  await Promise.all(prepared.map((version) => gate.run(() => provision(version))))

  // Notify completion
  host.post({
    type: "agentManager.multiVersionProgress",
    projectId: ctx.id,
    status: "done",
    total: versions,
    completed: created.length,
    groupId,
  })

  if (created.length === 0) {
    host.error(`Failed to create any of the ${versions} multi-version worktrees.`)
  }

  host.log(`Multi-version creation complete: ${created.length}/${versions} versions`)
  return null
}

interface VersionSpec {
  index: number
  versions: number
  groupId: string | undefined
  baseBranch: string | undefined
  branchName: string | undefined
  worktreeName: string | undefined
  models: ReturnType<typeof resolveVersionModels>["models"]
  providerID: string | undefined
  modelID: string | undefined
  sandbox: boolean | undefined
}

interface PreparedVersion {
  spec: VersionSpec
  wt: NonNullable<Awaited<ReturnType<MultiVersionHost["createOnDisk"]>>>
}

/** Create one version's worktree while the shared-repository Git barrier is active. */
async function prepareVersion(host: MultiVersionHost, spec: VersionSpec): Promise<PreparedVersion | null> {
  host.log(`Creating worktree ${spec.index + 1}/${spec.versions}`)

  const version = versionedName(spec.branchName || spec.worktreeName, spec.index, spec.versions)
  const wt = await host.createOnDisk({
    groupId: spec.groupId,
    baseBranch: spec.baseBranch,
    branchName: version.branch,
    name: version.branch,
    label: version.label,
  })
  if (!wt) {
    host.log(`Failed to create worktree for version ${spec.index + 1}`)
    return null
  }
  return { spec, wt }
}

/** Set up one prepared worktree, create its session, and expose it to the UI. */
async function provisionVersion(
  ctx: ProjectContext,
  host: MultiVersionHost,
  prepared: PreparedVersion,
): Promise<CreatedVersion | null> {
  const { spec, wt } = prepared

  await host.runSetup(wt.result.path, wt.result.branch, wt.worktree.id)

  const session = await host.createSession(wt.result.path, wt.result.branch, wt.worktree.id)
  if (!session) {
    ctx.peekState()?.removeWorktree(wt.worktree.id)
    await ctx.worktreeManager().removeWorktree(wt.result.path)
    host.log(`Failed to create session for version ${spec.index + 1}`)
    return null
  }

  const state = ctx.stateManager()
  state.addSession(session.id, wt.worktree.id)
  if (!spec.branchName && !spec.worktreeName && host.autoName().enabled) {
    state.armAutoName(wt.worktree.id, session.id)
  }

  // Sandbox must match the user's choice before this session is exposed or
  // receives its initial prompt. A failed reconciliation aborts this version.
  if (spec.sandbox !== undefined && !(await reconcileSandbox(host, spec, wt, session.id))) return null

  host.register(session.id, wt.result.path)
  host.notifyReady(session.id, wt.result, wt.worktree.id)
  host.sessions.register(session)

  // Set the per-version model immediately so the UI selector reflects
  // the correct model as soon as the worktree appears, before Phase 2.
  // Uses a dedicated message type to avoid clearing the busy state.
  const versionModel = spec.models[spec.index]
  const earlyProviderID = versionModel?.providerID ?? spec.providerID
  const earlyModelID = versionModel?.modelID ?? spec.modelID
  if (earlyProviderID && earlyModelID) {
    host.post({
      type: "agentManager.setSessionModel",
      projectId: ctx.id,
      sessionId: session.id,
      providerID: earlyProviderID,
      modelID: earlyModelID,
    })
  }

  host.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    worktreeId: wt.worktree.id,
    branch: wt.result.branch,
    multiVersion: true,
    version: spec.index + 1,
    totalVersions: spec.versions,
    groupId: spec.groupId,
  })
  host.log(`Version ${spec.index + 1} worktree ready: session=${session.id}`)

  return {
    worktreeId: wt.worktree.id,
    sessionId: session.id,
    path: wt.result.path,
    branch: wt.result.branch,
    parentBranch: wt.result.parentBranch,
    versionIndex: spec.index,
  }
}

/** Reconcile the sandbox preference for one version; rolls the worktree back on failure. */
async function reconcileSandbox(
  host: MultiVersionHost,
  spec: VersionSpec,
  wt: NonNullable<Awaited<ReturnType<MultiVersionHost["createOnDisk"]>>>,
  sessionId: string,
): Promise<boolean> {
  try {
    await ensureSandbox(host.client(), sessionId, wt.result.path, spec.sandbox!)
    return true
  } catch (error) {
    const err = getErrorMessage(error)
    host.log(`Failed to configure sandbox for ${sessionId}: ${err}`)
    host.post({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: `Failed to configure sandbox: ${err}`,
      worktreeId: wt.worktree.id,
    })
    host.capture("Agent Manager Session Error", {
      source: PLATFORM,
      error: err,
      context: "configureSandbox",
    })
    await host.discard(wt.worktree.id, wt.result.path, wt.result.branch, sessionId)
    return false
  }
}

/** Send one version's initial prompt as soon as its session is ready. */
function sendInitialPrompt(
  host: MultiVersionHost,
  projectId: string,
  created: CreatedVersion,
  models: VersionSpec["models"],
  resolved: { providerID: string | undefined; modelID: string | undefined },
  input: {
    text: string | undefined
    agent: string | undefined
    variant: string | undefined
    files: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>["files"]
  },
): void {
  const msg = buildInitialMessages([created], models, resolved, input.text, input.agent, input.variant, input.files)[0]!
  if (input.text) {
    host.log(`Sending initial message to version ${created.versionIndex + 1} (session=${msg.sessionId})`)
    host.promptName({
      sessionID: msg.sessionId,
      text: input.text,
      providerID: msg.providerID,
      modelID: msg.modelID,
    })
  }
  host.post({ type: "agentManager.sendInitialMessage", projectId, ...msg })
}
