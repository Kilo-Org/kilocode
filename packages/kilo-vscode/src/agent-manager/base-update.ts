import { randomUUID } from "crypto"
import type { ProjectContext } from "./project/context"
import type { LifecycleHost } from "./provider-lifecycle"
import type { Worktree } from "./WorktreeStateManager"
import { prompt } from "./orchestration-domain"
import { startSession } from "./mcp-warmup"
import { PLATFORM } from "./constants"

import type { BaseUpdateRequest } from "../../webview-ui/src/types/messages/agent-manager"

type Host = Pick<LifecycleHost, "client" | "metadata" | "register" | "sessions" | "push" | "notify" | "log">
const pending = new WeakSet<Worktree>()

export function baseUpdatePrompt(worktree: Worktree): string {
  return [
    `Update the current branch in worktree ${JSON.stringify(worktree.path)} from its saved base branch ${JSON.stringify(worktree.parentBranch)}. Do not use today's project default or the worktree's own upstream.`,
    worktree.remote
      ? `Use the recorded remote ${JSON.stringify(worktree.remote)} and exact base ref ${JSON.stringify(`refs/heads/${worktree.parentBranch}`)}.`
      : `Resolve the upstream of the saved base branch ${JSON.stringify(worktree.parentBranch)} to its remote and exact branch ref. If the base is local-only or cannot be resolved, stop and ask me which source to use. Do not guess a remote or silently use a local branch.`,
    "Check the worktree's current branch and Git status first. Do not switch branches. If HEAD is detached or a merge or rebase is already in progress, stop and ask rather than starting a competing operation.",
    "Fetch the exact remote base, then resolve FETCH_HEAD^{commit} and merge that freshly fetched commit ID. If fetch or ref resolution fails, stop. Never merge a stale tracking ref, switch sources silently, or use git pull.",
    "Do not use the shared stash stack or --autostash to preserve edits. Disable merge.autoStash for the merge. Git's internal temporary merge state is allowed if it does not change the shared stash stack.",
    "Preserve all staged, unstaged, and untracked changes in a verified recovery copy unique to this worktree and this update before changing them. Never restore or remove another worktree's recovery data. If preservation cannot be verified, stop and ask before clearing any edits. You may temporarily clear backed-up edits to merge the base. Resolve conflicts, restore local changes and their staging state, and leave unfinished work uncommitted. Keep pre-existing edits out of the merge commit. Keep the recovery copy until restoration is verified. Do not ask me to choose a preservation method.",
    "Resolve conflicts while preserving both branches' intent. If the intended resolution is unclear, stop and ask. Then run relevant tests, lint, and type checks. Keep normal tool permissions and approvals. Do not push, merge a PR, or apply this worktree into the base.",
  ].join("\n\n")
}

export async function handleBaseUpdate(msg: BaseUpdateRequest, ctx: ProjectContext, host: Host): Promise<null> {
  const state = ctx.peekState()
  const worktree = state?.getWorktree(msg.worktreeId)
  if (!state || !worktree || (msg.projectId && msg.projectId !== ctx.id)) {
    host.notify("Select an available managed worktree to update from base.")
    return null
  }
  if (pending.has(worktree)) return null
  pending.add(worktree)
  try {
    const generation = ctx.generation
    const client = host.client()
    const target = await (async () => {
      const statuses = await client.session.status({ directory: worktree.path }, { throwOnError: true })
      const sessions = state.getSessions(worktree.id)
      const selected = msg.sessionId ? state.getSession(msg.sessionId) : undefined
      if (msg.sessionId && selected?.worktreeId !== worktree.id)
        throw new Error("The target session changed worktrees.")
      const busy = sessions
        .filter((session) => (statuses.data[session.id]?.type ?? "idle") !== "idle")
        .map((session) => session.id)
      const id = selected?.id ?? sessions.find((session) => busy.includes(session.id))?.id ?? sessions.at(0)?.id
      if (busy.some((item) => item !== id))
        throw new Error("Another session in this worktree is busy. Wait for it to finish.")
      return id
    })()
    const current = () => {
      if (!ctx.isCurrent(generation) || state.getWorktree(worktree.id) !== worktree)
        throw new Error("The worktree is no longer available.")
    }
    current()
    const id =
      target ??
      (await (async () => {
        const metadata = await host.metadata(client, worktree.path)
        const { data } = await startSession(
          client,
          worktree.path,
          () => {
            current()
            if (state.getSessions(worktree.id).length)
              throw new Error("A session was added. Try Update from base again.")
            return client.session.create(
              { directory: worktree.path, platform: PLATFORM, metadata },
              { throwOnError: true },
            )
          },
          host.log,
        )
        current()
        state.addSession(data.id, worktree.id)
        host.register(data.id, worktree.path)
        ctx.invalidateSessions()
        host.push()
        return data.id
      })())
    current()
    if (state.getSession(id)?.worktreeId !== worktree.id) throw new Error("The target session changed worktrees.")
    host.sessions.registerSessionRoute?.({ projectId: ctx.id, sessionId: id }, worktree.path, generation)
    await prompt({
      client,
      root: ctx.root,
      state,
      sessionID: id,
      text: baseUpdatePrompt(worktree),
      messageID: randomUUID(),
      questions: "dismiss",
    })
  } catch (err) {
    host.log("Update from base failed:", err)
    host.notify(err instanceof Error ? err.message : String(err))
  } finally {
    pending.delete(worktree)
  }
  return null
}
