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
    var buildable = false

    /** When set, every call throws it after recording, so error/cancellation mapping can be tested. */
    var fail: Throwable? = null
    val configDirs = CopyOnWriteArrayList<String>()
    val stateDirs = CopyOnWriteArrayList<String>()
    val builds = CopyOnWriteArrayList<Triple<String, String, Boolean>>()
    val runs = CopyOnWriteArrayList<Triple<String, String, String>>()
    val stops = CopyOnWriteArrayList<Triple<String, String, String>>()
    val focuses = CopyOnWriteArrayList<Triple<String, String, String>>()
    val releases = CopyOnWriteArrayList<Pair<String, String>>()
    var beforeRelease: suspend () -> Unit = {}

    override suspend fun configs(directory: String): RunConfigListDto {
        assertNotEdt("configs")
        configDirs.add(directory)
        fail?.let { throw it }
        return RunConfigListDto(configs, error, buildable)
    }

    override suspend fun build(directory: String, worktree: String, clean: Boolean): RunResultDto {
        assertNotEdt("build")
        builds.add(Triple(directory, worktree, clean))
        fail?.let { throw it }
        return result
    }

    override suspend fun run(directory: String, id: String, worktree: String): RunResultDto {
        assertNotEdt("run")
        runs.add(Triple(directory, id, worktree))
        fail?.let { throw it }
        return result
    }

    override suspend fun stop(directory: String, id: String, worktree: String): Boolean {
        assertNotEdt("stop")
        stops.add(Triple(directory, id, worktree))
        fail?.let { throw it }
        return true
    }

    override suspend fun focus(directory: String, id: String, worktree: String): Boolean {
        assertNotEdt("focus")
        focuses.add(Triple(directory, id, worktree))
        fail?.let { throw it }
        return true
    }

    override suspend fun release(directory: String, worktree: String): Boolean {
        assertNotEdt("release")
        releases.add(directory to worktree)
        fail?.let { throw it }
        beforeRelease()
        return true
    }

    override suspend fun states(directory: String): Flow<List<RunStateDto>> {
        assertNotEdt("states")
        stateDirs.add(directory)
        fail?.let { throw it }
        return states
    }
}
