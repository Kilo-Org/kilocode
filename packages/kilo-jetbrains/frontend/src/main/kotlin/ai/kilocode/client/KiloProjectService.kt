@file:Suppress("UnstableApiUsage")

package ai.kilocode.client

import ai.kilocode.rpc.KiloProjectRpcApi
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Project-level frontend service that provides reactive access
 * to project-scoped data (providers, agents, commands, skills).
 *
 * Communicates with the backend via [KiloProjectRpcApi]. The flow
 * is collected eagerly so that data is available as soon as the
 * backend finishes loading.
 */
@Service(Service.Level.PROJECT)
class KiloProjectService(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    companion object {
        private val LOG = Logger.getInstance(KiloProjectService::class.java)
        private val init = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING)
    }

    private val directory: String get() = project.basePath ?: ""

    val state: StateFlow<KiloWorkspaceStateDto> = flow {
        durable {
            KiloProjectRpcApi.getInstance()
                .state(directory)
                .collect { emit(it) }
        }
    }.stateIn(cs, SharingStarted.Eagerly, init)

    /** Trigger a full reload of all project data. */
    fun reload() {
        cs.launch {
            try {
                durable { KiloProjectRpcApi.getInstance().reload(directory) }
            } catch (e: Exception) {
                LOG.warn("project data reload failed", e)
            }
        }
    }
}
