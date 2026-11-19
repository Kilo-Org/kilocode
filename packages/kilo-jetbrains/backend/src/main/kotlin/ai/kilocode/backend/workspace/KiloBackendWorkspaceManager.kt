package ai.kilocode.backend.workspace

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.cli.KiloBackendCliManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.APP)
internal class KiloBackendWorkspaceManager(private val cs: CoroutineScope) {
    private val areas = ConcurrentHashMap<String, KiloBackendWorkspace>()

    fun get(directory: String): KiloBackendWorkspace = areas.computeIfAbsent(key(directory)) { path ->
        KiloBackendWorkspace(path, CoroutineScope(cs.coroutineContext + SupervisorJob(cs.coroutineContext[Job])),
            service<KiloBackendAppService>().events) { KiloWorkspaceData(service<KiloBackendCliManager>().client(), path) }
    }

    fun remove(directory: String) { areas.remove(key(directory))?.stop() }

    private fun key(directory: String): String = canonicalDirectory(directory)
}
