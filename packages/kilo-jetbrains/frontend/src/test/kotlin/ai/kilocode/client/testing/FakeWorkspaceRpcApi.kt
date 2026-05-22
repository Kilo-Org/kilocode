package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Fake [KiloWorkspaceRpcApi] for testing.
 *
 * Push workspace state changes via [state].
 * Directory resolution returns [directory].
 *
 * Every `suspend` method asserts it is NOT called on the EDT.
 */
class FakeWorkspaceRpcApi : KiloWorkspaceRpcApi {

    var directory = "/test"
    val state = MutableStateFlow(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING))
    var reloads = 0
        private set

    override suspend fun resolveProjectDirectory(hint: String): String {
        assertNotEdt("resolveProjectDirectory")
        return directory
    }

    override suspend fun state(directory: String): Flow<KiloWorkspaceStateDto> {
        assertNotEdt("state")
        return state
    }

    override suspend fun reload(directory: String) {
        assertNotEdt("reload")
        reloads += 1
    }
}
