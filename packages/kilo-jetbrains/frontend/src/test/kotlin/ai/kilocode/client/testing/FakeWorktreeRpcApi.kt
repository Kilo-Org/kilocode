package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.MoveProgressDto
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeDirtyListDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Fake [KiloWorktreeRpcApi] for testing. Serves canned [listed] entries and records calls.
 * Every `suspend` method asserts it is NOT called on the EDT.
 */
class FakeWorktreeRpcApi : KiloWorktreeRpcApi {
    val listed = CopyOnWriteArrayList<WorktreeDto>()
    val branchesList = CopyOnWriteArrayList<String>()
    var statsResult = WorktreeStatsListDto()
    var dirtyResult = WorktreeDirtyListDto()
    var ghResult = GhAvailability.OK
    var prResult = WorktreePrListDto()
    var branchResult = BranchStatusDto()
    /** When set, [branchStatus] throws it instead of answering. */
    var branchThrows: Exception? = null
    var currentBranch: String? = null
    val moves = CopyOnWriteArrayList<Triple<String, String?, String>>()
    /** Progress events emitted by [moveToWorktree], in order. */
    var moveScript: List<MoveProgressDto> = emptyList()
    val creates = CopyOnWriteArrayList<CreateWorktreeRequestDto>()
    val removes = CopyOnWriteArrayList<Triple<String, String, String?>>()
    val removeForces = CopyOnWriteArrayList<Boolean>()
    val renames = CopyOnWriteArrayList<Triple<String, String, String>>()
    val adopts = CopyOnWriteArrayList<Triple<String, String, String>>()
    val reorders = CopyOnWriteArrayList<List<String>>()
    var reorderResult = true
    /** Stored session-list visibility per worktree path, plus the calls that touched it. */
    val sessionLists = ConcurrentHashMap<String, Boolean>()
    val sessionListReads = CopyOnWriteArrayList<String>()
    val sessionListWrites = CopyOnWriteArrayList<Pair<String, Boolean>>()
    /** When set, both session-list calls throw it instead of answering. */
    var sessionListThrows: Exception? = null
    val opens = CopyOnWriteArrayList<String>()
    val ghCalls = CopyOnWriteArrayList<String>()
    /** The `github` flag of each [ghStatus] call, positionally matching [ghCalls]. */
    val ghFlags = CopyOnWriteArrayList<Boolean>()
    /** The `maxAge` ceiling of each [ghStatus] call, positionally matching [ghCalls]. */
    val ghAges = CopyOnWriteArrayList<Long?>()
    /** Each [branchStatus] call as directory to `github` flag. */
    val branchCalls = CopyOnWriteArrayList<Pair<String, Boolean>>()
    val prCalls = CopyOnWriteArrayList<String>()
    /** The `maxAge` ceiling of each [prStatus] call, positionally matching [prCalls]. */
    val prAges = CopyOnWriteArrayList<Long?>()
    val statsCalls = CopyOnWriteArrayList<String>()
    val dirtyCalls = CopyOnWriteArrayList<String>()
    var beforeCreate: suspend () -> Unit = {}
    var beforeRemove: suspend () -> Unit = {}
    var beforeRename: suspend () -> Unit = {}
    var beforeGhStatus: suspend () -> Unit = {}
    /** Gate for holding a [prStatus] answer open while the test changes state around it. */
    var beforePrStatus: suspend () -> Unit = {}
    var adoptResult: (String, String) -> RenameWorktreeResultDto = { path, name ->
        RenameWorktreeResultDto(worktree = WorktreeDto(path, name, name, path))
    }
    var createResult: (CreateWorktreeRequestDto) -> CreateWorktreeResultDto = { req ->
        CreateWorktreeResultDto(WorktreeDto(req.branch, req.branch, req.branch, req.branch))
    }
    val prImports = CopyOnWriteArrayList<String>()
    var importPrResult: (String) -> CreateWorktreeResultDto = { url ->
        CreateWorktreeResultDto(WorktreeDto(url, "pr", "pr", url))
    }
    var openResult: (String) -> Boolean = { true }
    var removeResult: (String, String?, Boolean) -> RemoveWorktreeResultDto = { _, _, _ -> RemoveWorktreeResultDto(ok = true) }
    var renameResult: (String, String) -> RenameWorktreeResultDto = { path, name ->
        val idx = listed.indexOfFirst { it.path == path }
        if (idx < 0) RenameWorktreeResultDto(error = "missing") else {
            val item = listed[idx].copy(name = name)
            listed[idx] = item
            RenameWorktreeResultDto(worktree = item)
        }
    }

    override suspend fun list(directory: String): WorktreeListDto {
        assertNotEdt("list")
        return WorktreeListDto(listed.toList())
    }

    override suspend fun listBranches(directory: String): WorktreeBranchesDto {
        assertNotEdt("listBranches")
        return WorktreeBranchesDto(branchesList.toList(), currentBranch)
    }

    override suspend fun stats(directory: String): WorktreeStatsListDto {
        assertNotEdt("stats")
        statsCalls.add(directory)
        return statsResult
    }

    override suspend fun dirty(directory: String): WorktreeDirtyListDto {
        assertNotEdt("dirty")
        dirtyCalls.add(directory)
        return dirtyResult
    }

    override suspend fun ghStatus(directory: String, github: Boolean, maxAge: Long?): GhAvailability {
        assertNotEdt("ghStatus")
        ghCalls.add(directory)
        ghFlags.add(github)
        ghAges.add(maxAge)
        beforeGhStatus()
        if (!github) return if (ghResult == GhAvailability.GIT_MISSING) ghResult else GhAvailability.OK
        return ghResult
    }

    override suspend fun prStatus(directory: String, maxAge: Long?): WorktreePrListDto {
        assertNotEdt("prStatus")
        prCalls.add(directory)
        prAges.add(maxAge)
        // Snapshot before the gate so a call held open answers with what was configured when it
        // started, letting a test stage a newer result for the calls that follow.
        val answer = prResult
        beforePrStatus()
        return answer
    }

    override suspend fun branchStatus(directory: String, github: Boolean, maxAge: Long?): BranchStatusDto {
        assertNotEdt("branchStatus")
        branchCalls.add(directory to github)
        branchThrows?.let { throw it }
        if (!github) return branchResult.copy(pr = null)
        return branchResult
    }

    override suspend fun moveToWorktree(directory: String, sessionId: String?, branch: String): Flow<MoveProgressDto> {
        assertNotEdt("moveToWorktree")
        moves.add(Triple(directory, sessionId, branch))
        return moveScript.asFlow()
    }

    override suspend fun open(directory: String): Boolean {
        assertNotEdt("open")
        opens.add(directory)
        return openResult(directory)
    }

    override suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto {
        assertNotEdt("create")
        creates.add(request)
        beforeCreate()
        return createResult(request)
    }

    override suspend fun importPr(directory: String, url: String): CreateWorktreeResultDto {
        assertNotEdt("importPr")
        prImports.add(url)
        beforeCreate()
        return importPrResult(url)
    }

    override suspend fun remove(directory: String, path: String, branch: String?, force: Boolean): RemoveWorktreeResultDto {
        assertNotEdt("remove")
        removes.add(Triple(directory, path, branch))
        removeForces.add(force)
        beforeRemove()
        return removeResult(path, branch, force)
    }

    override suspend fun rename(directory: String, path: String, name: String): RenameWorktreeResultDto {
        assertNotEdt("rename")
        beforeRename()
        renames.add(Triple(directory, path, name))
        return renameResult(path, name)
    }

    override suspend fun adopt(directory: String, path: String, name: String): RenameWorktreeResultDto {
        assertNotEdt("adopt")
        adopts.add(Triple(directory, path, name))
        return adoptResult(path, name)
    }

    override suspend fun reorder(directory: String, paths: List<String>): Boolean {
        assertNotEdt("reorder")
        reorders.add(paths)
        return reorderResult
    }

    override suspend fun sessionList(directory: String): Boolean? {
        assertNotEdt("sessionList")
        sessionListReads.add(directory)
        sessionListThrows?.let { throw it }
        return sessionLists[directory]
    }

    override suspend fun setSessionList(directory: String, visible: Boolean): Boolean {
        assertNotEdt("setSessionList")
        sessionListWrites.add(directory to visible)
        sessionListThrows?.let { throw it }
        sessionLists[directory] = visible
        return true
    }
}
