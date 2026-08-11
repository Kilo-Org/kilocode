package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.util.edt
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.ui.CollectionListModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.Collections

/**
 * Owns the worktree list model and drives the [KiloWorktreeService] off the EDT. Model mutations
 * are marshalled back onto the EDT via [edt]. Mirrors the History stack's controller shape.
 */
class WorktreeController(
    private val service: KiloWorktreeService,
    val directory: String,
    private val cs: CoroutineScope,
    activity: StateFlow<Map<String, SessionActivityDto>> = MutableStateFlow(emptyMap()),
    private val telemetry: (String, Map<String, String>) -> Unit = { event, props -> Telemetry.send(event, props) },
) {
    val model = CollectionListModel<WorktreeDto>()
    private val pending = LinkedHashMap<String, WorktreeDto>()
    private val deleting = Collections.synchronizedSet(LinkedHashSet<String>())
    var onSelect: ((String) -> Unit)? = null
    var onCreateFailure: ((String?) -> Unit)? = null
    var onRemoveSuccess: ((WorktreeDto, Int) -> Unit)? = null
    var onActivityChanged: (() -> Unit)? = null

    @Volatile
    private var kinds: Map<String, SessionActivityKind> = emptyMap()

    init {
        cs.launch {
            activity.collect { snap ->
                edt {
                    kinds = aggregateWorktreeActivity(snap)
                    onActivityChanged?.invoke()
                }
            }
        }
    }

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

    fun isDeleting(id: String): Boolean = id in deleting

    fun kind(path: String): SessionActivityKind? = kinds[normalizeWorktreePath(path)]

    fun reload() {
        cs.launch {
            val listing = async { service.list(directory) }
            val branchInfo = service.listBranches(directory)
            val result = listing.await()
            edt {
                val main = result.worktrees.firstOrNull { it.main }
                val extra = result.worktrees.filter { !it.main }
                val rows = extra + pending.values
                model.replaceAll(rows)
                cache().putAll(rows)
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

    /** Imports a worktree that checks out an existing local branch. */
    fun importBranch(branch: String) = create(branch, base = null, existingBranch = true)

    /**
     * Creates a worktree. When [prompt] is set, it is stashed for the worktree's first session so the
     * editor auto-sends it once it opens with its picked mode/model (see [PendingWorktreePrompt]).
     */
    fun create(branch: String, base: String?, existingBranch: Boolean = false, prompt: PendingPrompt? = null) {
        val id = "pending:$branch:${System.nanoTime()}"
        val temp = WorktreeDto(id, branch, branch, id)
        edt {
            pending[temp.id] = temp
            model.add(temp)
            onSelect?.invoke(temp.id)
        }
        cs.launch {
            val result = service.create(directory, CreateWorktreeRequestDto(branch, base, existingBranch))
            finishCreate(temp, branch, prompt, result)
        }
    }

    fun importPr(url: String) {
        val id = "pending:pr:${System.nanoTime()}"
        val temp = WorktreeDto(id, KiloBundle.message("worktree.import.pr.section"), "", id)
        edt {
            pending[temp.id] = temp
            model.add(temp)
            onSelect?.invoke(temp.id)
        }
        cs.launch {
            val result = service.importPr(directory, url)
            finishCreate(temp, "pr", null, result)
        }
    }

    private fun finishCreate(
        temp: WorktreeDto,
        branch: String,
        prompt: PendingPrompt?,
        result: CreateWorktreeResultDto,
    ) {
        val created = result.worktree
        edt {
            pending.remove(temp.id)
            val idx = model.getElementIndex(temp)
            if (created != null) {
                if (idx >= 0) model.setElementAt(created, idx) else model.add(created)
                cache().put(created)
                prompt?.let { service<PendingWorktreePrompt>().put(created.path, it) }
                onSelect?.invoke(created.id)
                telemetry("Worktree Created", mapOf("branch" to branch))
                return@edt
            }
            if (idx >= 0) model.remove(temp)
            telemetry("Worktree Create Failed", mapOf("branch" to branch))
            onCreateFailure?.invoke(result.error)
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
        if (!deleting.add(dto.id)) return
        edt { refresh(dto) }
        cs.launch {
            val result = service.remove(directory, dto.path, dto.branch, force)
            if (result.ok) {
                edt {
                    deleting.remove(dto.id)
                    val index = model.getElementIndex(dto)
                    model.remove(dto)
                    cache().remove(dto.path)
                    onRemoveSuccess?.invoke(dto, index)
                    onSuccess()
                    telemetry("Worktree Deleted", mapOf("branch" to dto.branch, "force" to force.toString()))
                }
                return@launch
            }
            // Removal failed: git still tracks the worktree. Keep the row and reconcile with
            // ground truth so a stale optimistic delete can't make the entry reappear later.
            edt {
                deleting.remove(dto.id)
                refresh(dto)
                telemetry(
                    "Worktree Delete Failed",
                    mapOf("branch" to dto.branch, "force" to force.toString(), "locked" to result.locked.toString()),
                )
                onFailure(result)
            }
            reload()
        }
    }

    fun rename(
        dto: WorktreeDto,
        name: String,
        onSuccess: (WorktreeDto) -> Unit = {},
        onFailure: (String?) -> Unit = {},
    ) {
        val title = name.trim()
        if (title.isEmpty() || title == dto.name) return
        edt {
            val idx = index(dto.id)
            if (idx < 0) return@edt
            val row = dto.copy(name = title)
            model.setElementAt(row, idx)
            cache().put(row)
        }
        cs.launch {
            val result = service.rename(directory, dto.path, title)
            edt {
                val updated = result.worktree
                if (updated != null) {
                    index(dto.id).takeIf { it >= 0 }?.let { model.setElementAt(updated, it) }
                    cache().put(updated)
                    telemetry("Worktree Renamed", mapOf("path" to dto.path))
                    onSuccess(updated)
                    return@edt
                }
                index(dto.id).takeIf { it >= 0 }?.let { model.setElementAt(dto, it) }
                cache().put(dto)
                telemetry("Worktree Rename Failed", mapOf("path" to dto.path))
                onFailure(result.error)
                reload()
            }
        }
    }

    /**
     * Applies a name recorded elsewhere (e.g. adopted from a session title in an editor tab) to the
     * matching row, so the worktree list reflects it live. No-ops when the path is not in this list
     * or the name already matches, which also makes it safe against the cache echoing our own writes.
     */
    fun applyName(path: String, name: String?) {
        if (name.isNullOrBlank()) return
        val idx = (0 until model.size).firstOrNull { model.getElementAt(it).path == path } ?: return
        val row = model.getElementAt(idx)
        if (row.name == name) return
        model.setElementAt(row.copy(name = name), idx)
    }

    private fun refresh(dto: WorktreeDto) {
        val idx = model.getElementIndex(dto)
        if (idx >= 0) model.setElementAt(dto, idx)
    }

    private fun index(id: String): Int {
        return (0 until model.size).firstOrNull { model.getElementAt(it).id == id } ?: -1
    }

    private fun cache(): WorktreeNameCache {
        return ApplicationManager.getApplication().service()
    }
}
