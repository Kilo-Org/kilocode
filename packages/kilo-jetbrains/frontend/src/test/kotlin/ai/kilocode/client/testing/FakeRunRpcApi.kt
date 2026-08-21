package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloRunRpcApi
import ai.kilocode.rpc.dto.RunConfigDto
import ai.kilocode.rpc.dto.RunConfigListDto
import ai.kilocode.rpc.dto.RunResultDto
import ai.kilocode.rpc.dto.RunStateDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Fake [KiloRunRpcApi] for testing. Records the project directory every call receives so tests can
 * prove the frontend sends the resolved backend root. Every `suspend` method asserts it is NOT
 * called on the EDT.
 */
class FakeRunRpcApi : KiloRunRpcApi {
    var configs = emptyList<RunConfigDto>()
    var error: String? = null
    var result = RunResultDto(ok = true)
    val states = MutableStateFlow(emptyList<RunStateDto>())
    val configDirs = CopyOnWriteArrayList<String>()
    val stateDirs = CopyOnWriteArrayList<String>()
    val runs = CopyOnWriteArrayList<Triple<String, String, String>>()
    val stops = CopyOnWriteArrayList<Triple<String, String, String>>()
    val focuses = CopyOnWriteArrayList<Triple<String, String, String>>()

    override suspend fun configs(directory: String): RunConfigListDto {
        assertNotEdt("configs")
        configDirs.add(directory)
        return RunConfigListDto(configs, error)
    }

    override suspend fun run(directory: String, id: String, worktree: String): RunResultDto {
        assertNotEdt("run")
        runs.add(Triple(directory, id, worktree))
        return result
    }

    override suspend fun stop(directory: String, id: String, worktree: String): Boolean {
        assertNotEdt("stop")
        stops.add(Triple(directory, id, worktree))
        return true
    }

    override suspend fun focus(directory: String, id: String, worktree: String): Boolean {
        assertNotEdt("focus")
        focuses.add(Triple(directory, id, worktree))
        return true
    }

    override suspend fun states(directory: String): Flow<List<RunStateDto>> {
        assertNotEdt("states")
        stateDirs.add(directory)
        return states
    }
}
