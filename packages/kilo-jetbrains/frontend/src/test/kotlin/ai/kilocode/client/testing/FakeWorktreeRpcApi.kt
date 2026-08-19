package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.RemoveWorktreeResultDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import ai.kilocode.rpc.dto.WorktreePrListDto
import ai.kilocode.rpc.dto.WorktreeStatsListDto
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
    var currentBranch: String? = null
    val creates = CopyOnWriteArrayList<CreateWorktreeRequestDto>()
    val removes = CopyOnWriteArrayList<Triple<String, String, String?>>()
    val removeForces = CopyOnWriteArrayList<Boolean>()
    val renames = CopyOnWriteArrayList<Triple<String, String, String>>()
    val adopts = CopyOnWriteArrayList<Triple<String, String, String>>()
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
}
