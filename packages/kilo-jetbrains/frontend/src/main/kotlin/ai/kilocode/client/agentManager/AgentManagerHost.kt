package ai.kilocode.client.agentManager

import ai.kilocode.client.KILO_TOOL_WINDOW_ID
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * Project-level seam between a worktree session editor tab and the Agent Manager tool window panel,
 * which the editor cannot reach directly (it lives inside [ai.kilocode.client.KiloToolWindowSetupService]).
 * The tool window binds its two worktree flows here once it is created; an editor calls [move] /
 * [newWorktree] the same way the chat branch dock does. When nothing is bound yet -- a tab restored
 * before the tool window has been shown, or after a plugin reload -- the request is queued (the latest
 * call wins) and the tool window is activated, which creates its content and flushes the queue via
 * [bind].
 */
@Service(Service.Level.PROJECT)
class AgentManagerHost(private val project: Project) {
    private var onMove: ((String?, String, String) -> Unit)? = null
    private var onNew: (() -> Unit)? = null
    private var queued: (() -> Unit)? = null
    // Which bind owns the callbacks currently installed. A tool window is not guaranteed to be
    // disposed before its replacement is created -- a plugin reload creates the new one first -- so a
    // disposer that cleared unconditionally would take the live callbacks down with the dead window.
    private var generation = 0

    /**
     * Registers the tool window's worktree flows for the lifetime of [parent] (the tool window's
     * disposable). A later [bind] call from a fresh tool window setup replaces the callbacks and
     * flushes anything queued while none were bound.
     */
    @RequiresEdt
    fun bind(parent: Disposable, move: (String?, String, String) -> Unit, newWorktree: () -> Unit) {
        val gen = ++generation
        onMove = move
        onNew = newWorktree
        Disposer.register(parent) {
            if (gen != generation) return@register
            onMove = null
            onNew = null
        }
        val pending = queued
        queued = null
        pending?.invoke()
    }

    /** Moves [sessionId] (or just the local changes in [directory] when null) into a new worktree. */
    @RequiresEdt
    fun move(sessionId: String?, directory: String, surface: String) {
        val handler = onMove
        if (handler != null) {
            handler(sessionId, directory, surface)
            return
        }
        queued = { onMove?.invoke(sessionId, directory, surface) }
        activate()
    }

    /** Opens the New Worktree dialog. */
    @RequiresEdt
    fun newWorktree() {
        val handler = onNew
        if (handler != null) {
            handler()
            return
        }
        queued = { onNew?.invoke() }
        activate()
    }

    private fun activate() {
        ToolWindowManager.getInstance(project).getToolWindow(KILO_TOOL_WINDOW_ID)?.activate(null)
    }
}
