package ai.kilocode.client.agentManager.worktree

import com.intellij.openapi.components.Service
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * One-shot handoff of an initial prompt from the New Worktree dialog to the freshly-opened worktree
 * session editor. The dialog creates the worktree, stashes the typed prompt keyed by worktree path,
 * and the editor consumes it once when it creates that worktree's first session — mirroring the VS
 * Code flow of create worktree → create session → send the initial prompt.
 */
@Service(Service.Level.APP)
class PendingWorktreePrompt {
    private val prompts = HashMap<String, String>()

    @RequiresEdt
    fun put(path: String, text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        prompts[normalizeWorktreePath(path)] = body
    }

    /** Returns and clears the pending prompt for [path], or null when none is queued. */
    @RequiresEdt
    fun take(path: String): String? = prompts.remove(normalizeWorktreePath(path))
}
