package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Fake [KiloWorktreeRpcApi] for testing. Serves canned [listed] entries and records calls.
 * Every `suspend` method asserts it is NOT called on the EDT.
 */
class FakeWorktreeRpcApi : KiloWorktreeRpcApi {
    val listed = CopyOnWriteArrayList<WorktreeDto>()
    val creates = CopyOnWriteArrayList<CreateWorktreeRequestDto>()
    val removes = CopyOnWriteArrayList<Triple<String, String, String?>>()
    var createResult: (CreateWorktreeRequestDto) -> CreateWorktreeResultDto = { req ->
        CreateWorktreeResultDto(WorktreeDto(req.branch, req.branch, req.branch, req.branch))
    }

    override suspend fun list(directory: String): WorktreeListDto {
        assertNotEdt("list")
        return WorktreeListDto(listed.toList())
    }

    override suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto {
        assertNotEdt("create")
        creates.add(request)
        return createResult(request)
    }

    override suspend fun remove(directory: String, path: String, branch: String?) {
        assertNotEdt("remove")
        removes.add(Triple(directory, path, branch))
    }
}
