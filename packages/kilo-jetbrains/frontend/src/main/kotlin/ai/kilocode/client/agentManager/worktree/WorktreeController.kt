package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
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
    private val pending = LinkedHashMap<String, WorktreeDto>()
    var onSelect: ((String) -> Unit)? = null
    var onCreateFailure: ((String?) -> Unit)? = null

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

    fun isPending(id: String): Boolean = id in pending

    fun reload() {
        cs.launch {
            val result = service.list(directory)
            val branchInfo = service.listBranches(directory)
            edt {
                val main = result.worktrees.firstOrNull { it.main }
                val extra = result.worktrees.filter { !it.main }
                val rows = extra + pending.values
                model.replaceAll(rows)
                defaultBranch = main?.branch?.takeIf { it.isNotBlank() && it != "(detached)" } ?: "main"
                val worktreeBranches = rows.mapTo(HashSet()) { it.branch }
                branches = branchInfo.branches.filter { it !in worktreeBranches }
                known = branchInfo.branches.toMutableSet().apply { addAll(rows.map { it.branch }) }
                telemetry("Worktree List Loaded", mapOf("count" to extra.size.toString()))
            }
        }
    }

    /** A generated friendly branch name not already used by any branch or worktree. */
    fun suggestName(): String = WorktreeNames.generate(known)

    /** Creates a worktree immediately with a generated friendly name, based on [defaultBranch]. */
    fun quickCreate() = create(suggestName(), defaultBranch)

    fun create(branch: String, base: String?) {
        val id = "pending:$branch:${System.nanoTime()}"
        val temp = WorktreeDto(id, branch, branch, id)
        edt {
            pending[temp.id] = temp
            model.add(temp)
            onSelect?.invoke(temp.id)
        }
        cs.launch {
            val result = service.create(directory, CreateWorktreeRequestDto(branch, base))
            val created = result.worktree
            edt {
                pending.remove(temp.id)
                val idx = model.getElementIndex(temp)
                if (created != null) {
                    if (idx >= 0) model.setElementAt(created, idx) else model.add(created)
                    onSelect?.invoke(created.id)
                    telemetry("Worktree Created", mapOf("branch" to branch))
                    return@edt
                }
                if (idx >= 0) model.remove(temp)
                telemetry("Worktree Create Failed", mapOf("branch" to branch))
                onCreateFailure?.invoke(result.error)
            }
        }
    }

    /**
     * Removes [dto]. Pass [force] to unlock a locked worktree before removing it. On failure the
     * row is kept and [onFailure] is invoked on the EDT so the caller can surface a follow-up
     * (e.g. a "force delete" notification), then the list reconciles with git ground truth.
     */
    fun remove(
        dto: WorktreeDto,
        force: Boolean = false,
        onSuccess: () -> Unit = {},
        onFailure: (RemoveWorktreeResultDto) -> Unit = {},
    ) {
        cs.launch {
            val result = service.remove(directory, dto.path, dto.branch, force)
            if (result.ok) {
                edt {
                    model.remove(dto)
                    onSuccess()
                    telemetry("Worktree Deleted", mapOf("branch" to dto.branch, "force" to force.toString()))
                }
                return@launch
            }
            // Removal failed: git still tracks the worktree. Keep the row and reconcile with
            // ground truth so a stale optimistic delete can't make the entry reappear later.
            edt {
                telemetry(
                    "Worktree Delete Failed",
                    mapOf("branch" to dto.branch, "force" to force.toString(), "locked" to result.locked.toString()),
                )
                onFailure(result)
            }
            reload()
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
