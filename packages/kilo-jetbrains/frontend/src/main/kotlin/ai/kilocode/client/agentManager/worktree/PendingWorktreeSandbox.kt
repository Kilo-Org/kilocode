package ai.kilocode.client.agentManager.worktree

import com.intellij.openapi.components.Service
import java.util.concurrent.ConcurrentHashMap

/** One-shot handoff of a New Worktree dialog's explicit sandbox choice to its first session. */
@Service(Service.Level.APP)
class PendingWorktreeSandbox {
    data class Choice(val enabled: Boolean, val rollback: () -> Unit)

    private val choices = ConcurrentHashMap<String, Choice>()

    fun put(path: String, enabled: Boolean, rollback: () -> Unit) {
        choices[normalizeWorktreePath(path)] = Choice(enabled, rollback)
    }

    fun take(path: String): Choice? = choices.remove(normalizeWorktreePath(path))
}
