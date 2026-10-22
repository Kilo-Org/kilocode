package ai.kilocode.client.agentManager.worktree

import com.intellij.openapi.components.Service
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * An initial worktree prompt plus the mode / model / reasoning the New Worktree dialog picked for
 * it. Carrying the selection alongside the text lets the first turn run with exactly what the user
 * chose, instead of relying on the freshly-opened session resolving its own defaults.
 */
data class PendingPrompt(
    val text: String,
    val agent: String? = null,
    val provider: String? = null,
    val model: String? = null,
    val variant: String? = null,
)

/**
 * One-shot handoff of an initial prompt from the New Worktree dialog to the freshly-opened worktree
 * session editor. The dialog creates the worktree, stashes the typed prompt (with its picked
 * mode/model) keyed by worktree path, and the editor consumes it once when it creates that
 * worktree's first session — mirroring the VS Code flow of create worktree → create session → send
 * the initial prompt.
 */
@Service(Service.Level.APP)
class PendingWorktreePrompt {
    private val prompts = HashMap<String, PendingPrompt>()

    @RequiresEdt
    fun put(path: String, prompt: PendingPrompt) {
        if (prompt.text.isBlank()) return
        prompts[normalizeWorktreePath(path)] = prompt.copy(text = prompt.text.trim())
    }

    /** Returns and clears the pending prompt for [path], or null when none is queued. */
    @RequiresEdt
    fun take(path: String): PendingPrompt? = prompts.remove(normalizeWorktreePath(path))
}
