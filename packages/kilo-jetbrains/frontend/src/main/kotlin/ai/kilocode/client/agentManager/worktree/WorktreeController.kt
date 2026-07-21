package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.CollectionListModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Owns the worktree list model and drives the [KiloWorktreeService] off the EDT. Model mutations
 * are marshalled back onto the EDT via [edt]. Mirrors the History stack's controller shape.
 */
class WorktreeController(
    private val service: KiloWorktreeService,
    private val directory: String,
    private val cs: CoroutineScope,
    private val telemetry: (String, Map<String, String>) -> Unit = { event, props -> Telemetry.send(event, props) },
) {
    val model = CollectionListModel<WorktreeDto>()

    /** Branch checked out in the main worktree; used as the base for quick worktree creation. */
    @Volatile
    var defaultBranch: String = "main"
        private set

    /** Local branches, for the base-branch picker. Refreshed alongside the worktree list. */
    @Volatile
    var branches: List<String> = emptyList()
        private set

    fun reload() {
        cs.launch {
            val result = service.list(directory)
            val branchInfo = service.listBranches(directory)
            edt {
                model.replaceAll(result.worktrees)
                defaultBranch = result.worktrees.firstOrNull { it.main }?.branch
                    ?.takeIf { it.isNotBlank() && it != "(detached)" } ?: "main"
                branches = branchInfo.branches
                telemetry("Worktree List Loaded", mapOf("count" to result.worktrees.size.toString()))
            }
        }
    }

    /** A generated friendly branch name not already used by an existing worktree. */
    fun suggestName(): String =
        WorktreeNames.generate((0 until model.size).mapTo(HashSet()) { model.getElementAt(it).branch })

    /** Creates a worktree immediately with a generated friendly name, based on [defaultBranch]. */
    fun quickCreate() = create(suggestName(), defaultBranch)

    fun create(branch: String, base: String?) {
        cs.launch {
            val result = service.create(directory, CreateWorktreeRequestDto(branch, base))
            val created = result.worktree
            if (created != null) {
                edt {
                    model.add(created)
                    telemetry("Worktree Created", mapOf("branch" to branch))
                }
            }
        }
    }

    fun remove(dto: WorktreeDto) {
        cs.launch {
            service.remove(directory, dto.path, dto.branch)
            edt {
                model.remove(dto)
                telemetry("Worktree Deleted", mapOf("branch" to dto.branch))
            }
        }
    }
}

private fun edt(block: () -> Unit) {
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) {
        block()
        return
    }
    app.invokeLater(block)
}
