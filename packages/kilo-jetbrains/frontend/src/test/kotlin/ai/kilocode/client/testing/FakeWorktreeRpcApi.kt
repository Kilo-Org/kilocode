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
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Fake [KiloWorktreeRpcApi] for testing. Serves canned [listed] entries and records calls.
 * Every `suspend` method asserts it is NOT called on the EDT.
 */
class FakeWorktreeRpcApi : KiloWorktreeRpcApi {
    val listed = CopyOnWriteArrayList<WorktreeDto>()
    val branchesList = CopyOnWriteArrayList<String>()
    var statsResult = WorktreeStatsListDto()
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
    val opens = CopyOnWriteArrayList<String>()
    val ghCalls = CopyOnWriteArrayList<String>()
    var beforeCreate: suspend () -> Unit = {}
    var beforeRemove: suspend () -> Unit = {}
    var beforeRename: suspend () -> Unit = {}
    var beforeGhStatus: suspend () -> Unit = {}
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
        return statsResult
    }

    override suspend fun ghStatus(directory: String): GhAvailability {
        assertNotEdt("ghStatus")
        ghCalls.add(directory)
        beforeGhStatus()
        return ghResult
    }

    override suspend fun prStatus(directory: String): WorktreePrListDto {
        assertNotEdt("prStatus")
        return prResult
    }

    override suspend fun branchStatus(directory: String): BranchStatusDto {
        assertNotEdt("branchStatus")
        branchThrows?.let { throw it }
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
}
