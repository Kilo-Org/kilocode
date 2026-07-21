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

    /** Branches eligible as a base, i.e. local branches not already checked out in a worktree. */
    @Volatile
    var branches: List<String> = emptyList()
        private set

    /** Every known branch name, used to keep generated worktree names collision-free. */
    @Volatile
    private var known: Set<String> = emptySet()

    fun reload() {
        cs.launch {
            val result = service.list(directory)
            val branchInfo = service.listBranches(directory)
            edt {
                val main = result.worktrees.firstOrNull { it.main }
                val extra = result.worktrees.filter { !it.main }
                model.replaceAll(extra)
                defaultBranch = main?.branch?.takeIf { it.isNotBlank() && it != "(detached)" } ?: "main"
                val worktreeBranches = extra.mapTo(HashSet()) { it.branch }
                branches = branchInfo.branches.filter { it !in worktreeBranches }
                known = branchInfo.branches.toMutableSet().apply { addAll(result.worktrees.map { it.branch }) }
                telemetry("Worktree List Loaded", mapOf("count" to extra.size.toString()))
            }
        }
    }

    /** A generated friendly branch name not already used by any branch or worktree. */
    fun suggestName(): String = WorktreeNames.generate(known)

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
