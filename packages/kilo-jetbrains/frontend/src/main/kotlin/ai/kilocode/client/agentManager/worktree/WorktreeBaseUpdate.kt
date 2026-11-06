package ai.kilocode.client.agentManager.worktree

import com.intellij.openapi.components.Service
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * Prompt text for the worktree row's "Update from base" action. Mirrors the VS Code Agent Manager
 * request: use the saved base and remote, fetch the exact remote ref, merge the freshly fetched
 * commit, and preserve uncommitted work without touching the shared stash stack.
 */
internal fun worktreeBaseUpdatePrompt(path: String, parentBranch: String, remote: String?, recorded: Boolean): String = buildList {
    if (recorded) {
        add("Update the current branch in worktree ${quote(path)} from its saved base branch ${quote(parentBranch)}. Do not use today's project default or the worktree's own upstream.")
    } else {
        add("Update the current branch in worktree ${quote(path)} from the base branch candidate ${quote(parentBranch)}. No saved base branch was recorded for this worktree, so treat ${quote(parentBranch)} as a candidate only.")
        add("Before merging, confirm with me that this candidate is the intended base. If it is not, stop and ask which branch to use. Never merge an unconfirmed base.")
    }
    add(
        if (remote != null) {
            "Use the recorded remote ${quote(remote)} and exact base ref ${quote("refs/heads/$parentBranch")}."
        } else {
            "Resolve the upstream of the base branch ${quote(parentBranch)} to its remote and exact branch ref. If the base is local-only or cannot be resolved, stop and ask me which source to use. Do not guess a remote or silently use a local branch."
        },
    )
    add("Check the worktree's current branch and Git status first. Do not switch branches. If HEAD is detached or a merge or rebase is already in progress, stop and ask rather than starting a competing operation.")
    add("Fetch the exact remote base, then resolve FETCH_HEAD^{commit} and merge that freshly fetched commit ID. If fetch or ref resolution fails, stop. Never merge a stale tracking ref, switch sources silently, or use git pull.")
    add("Do not use the shared stash stack or --autostash to preserve edits. Disable merge.autoStash for the merge. Git's internal temporary merge state is allowed if it does not change the shared stash stack.")
    add("Preserve all staged, unstaged, and untracked changes in a verified recovery copy unique to this worktree and this update before changing them. Never restore or remove another worktree's recovery data. If preservation cannot be verified, stop and ask before clearing any edits. You may temporarily clear backed-up edits to merge the base. Resolve conflicts, restore local changes and their staging state, and leave unfinished work uncommitted. Keep pre-existing edits out of the merge commit. Keep the recovery copy until restoration is verified. Do not ask me to choose a preservation method.")
    add("Resolve conflicts while preserving both branches' intent. If the intended resolution is unclear, stop and ask. Then run relevant tests, lint, and type checks. Keep normal tool permissions and approvals. Do not push, merge a PR, or apply this worktree into the base.")
}.joinToString("\n\n")

private fun quote(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

/**
 * Project-level handoff from the worktree row action to an open worktree session editor. When the
 * editor is not open yet, the action queues the prompt for the editor to consume after it starts.
 */
@Service(Service.Level.PROJECT)
class WorktreeBaseUpdatePrompts {
    private val managers = HashMap<String, WorktreeSessionEditorManager>()

    @RequiresEdt
    fun register(path: String, manager: WorktreeSessionEditorManager) {
        managers[normalizeWorktreePath(path)] = manager
    }

    @RequiresEdt
    fun unregister(path: String, manager: WorktreeSessionEditorManager) {
        val key = normalizeWorktreePath(path)
        if (managers[key] === manager) managers.remove(key)
    }

    /**
     * Sends [text] into the open editor for [path]. Returns false when no editor is open, so the
     * caller can queue the prompt and open one.
     */
    @RequiresEdt
    fun submit(path: String, text: String, title: String): Boolean {
        val manager = managers[normalizeWorktreePath(path)] ?: return false
        manager.submitPrompt(text, title)
        return true
    }
}
