package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.platform.project.ProjectId
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.concurrent.CopyOnWriteArrayList

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
    var models = ModelsWorkspaceDto()
    var modelsGate: CompletableDeferred<Unit>? = null
    var fileMatches = emptyList<WorkspaceFileDto>()
    var fileResolver: ((String) -> List<WorkspaceFileDto>)? = null
    var searchResult = FileSearchResultDto()
    var search: ((String) -> FileSearchResultDto)? = null
    var gitChanges: String? = null
    var openResult = true
    var localConfigPath = "/test/.kilo/kilo.jsonc"
    var globalConfigPath = "/config/kilo.jsonc"
    var localConfigDisplayPath = localConfigPath
    var globalConfigDisplayPath = globalConfigPath
    var localConfigExists = true
    var globalConfigExists = true
    var beforeLocalConfigTarget: (suspend () -> Unit)? = null
    var beforeGlobalConfigTarget: (suspend () -> Unit)? = null
    val fileCalls = CopyOnWriteArrayList<Pair<String, String>>()
    val searchQueries = CopyOnWriteArrayList<String>()
    val opened = CopyOnWriteArrayList<String>()
    val localConfigs = CopyOnWriteArrayList<String>()
    var globalConfigs = 0
    var localConfigPathCalls = 0
        private set
    var globalConfigPathCalls = 0
        private set

    override suspend fun resolveProjectDirectory(projectId: ProjectId?, hint: String): String {
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

    override suspend fun models(directory: String): ModelsWorkspaceDto {
        assertNotEdt("models")
        modelsGate?.await()
        return models
    }

    override suspend fun files(directory: String, path: String): List<WorkspaceFileDto> {
        assertNotEdt("files")
        fileCalls.add(directory to path)
        return fileResolver?.invoke(path) ?: fileMatches
    }

    override suspend fun searchFiles(directory: String, query: String, limit: Int): FileSearchResultDto {
        assertNotEdt("searchFiles")
        searchQueries.add(query)
        return search?.invoke(query) ?: searchResult
    }

    override suspend fun gitChanges(directory: String): String? {
        assertNotEdt("gitChanges")
        return gitChanges
    }

    override suspend fun openFile(path: String): Boolean {
        assertNotEdt("openFile")
        opened.add(path)
        return openResult
    }

    override suspend fun localConfigTarget(directory: String): ConfigTargetDto {
        assertNotEdt("localConfigTarget")
        localConfigPathCalls += 1
        beforeLocalConfigTarget?.invoke()
        return ConfigTargetDto(localConfigPath, localConfigDisplayPath, localConfigExists)
    }

    override suspend fun globalConfigTarget(): ConfigTargetDto {
        assertNotEdt("globalConfigTarget")
        globalConfigPathCalls += 1
        beforeGlobalConfigTarget?.invoke()
        return ConfigTargetDto(globalConfigPath, globalConfigDisplayPath, globalConfigExists)
    }

    override suspend fun openLocalConfig(directory: String): Boolean {
        assertNotEdt("openLocalConfig")
        localConfigs.add(directory)
        return openResult
    }

    override suspend fun openGlobalConfig(): Boolean {
        assertNotEdt("openGlobalConfig")
        globalConfigs += 1
        return openResult
    }
}
