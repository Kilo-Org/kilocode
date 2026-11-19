package ai.kilocode.client.agentManager.worktree

import com.intellij.openapi.components.Service
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * One-shot handoff of a session id to a freshly-opened worktree session editor, keyed by worktree
 * path. Used by "Move to Worktree" so the editor shows the forked conversation instead of starting a
 * new one.
 *
 * The session deliberately does not travel in the editor's VFS params: [WorktreeSessionEditorKind]
 * identity is the worktree path alone, so open / close / rename / delete all address the same tab.
 * Adding a second param would create a rival identity and leave duplicate tabs behind. Mirrors
 * [PendingWorktreePrompt].
 */
@Service(Service.Level.APP)
class PendingWorktreeSession {
    private val sessions = HashMap<String, String>()

    @RequiresEdt
    fun put(path: String, session: String) {
        if (session.isBlank()) return
        sessions[normalizeWorktreePath(path)] = session
    }

    /** Returns and clears the queued session for [path], or null when none is queued. */
    @RequiresEdt
    fun take(path: String): String? = sessions.remove(normalizeWorktreePath(path))
}
