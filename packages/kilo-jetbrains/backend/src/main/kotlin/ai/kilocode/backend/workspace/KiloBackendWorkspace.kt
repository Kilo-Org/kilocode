package ai.kilocode.backend.workspace

import ai.kilocode.rpc.dto.KiloWorkspaceLoadProgressDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transform
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.nio.file.Files
import java.nio.file.Path

internal class KiloBackendWorkspace(
    private val directory: String,
    private val scope: CoroutineScope,
    events: Flow<JsonObject>,
    private val data: suspend () -> KiloWorkspaceData,
) {
    private val generation = MutableStateFlow(0L)
    private val changes = events.filter { event ->
        val type = event.text("type")
        type == "server.connected" || type in catalogEvents && event.obj("location")?.text("directory") == directory
    }
    val state = merge(generation.map { Unit }, changes.map { Unit }).conflate().transform {
        val remote = RemoteDirectory.detect(directory)
        if (remote != null) emit(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.UNSUPPORTED, error = remote))
        else if (!withContext(Dispatchers.IO) { Files.isDirectory(Path.of(directory)) })
            emit(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.MISSING, error = directory))
        else {
            emit(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.LOADING, progress = KiloWorkspaceLoadProgressDto()))
            emit(loadResource { snapshot(data()) }.getOrElse {
                KiloWorkspaceStateDto(KiloWorkspaceStatusDto.ERROR, error = it.message, errors = listOf(LoadErrorDto("workspace", detail = it.message)))
            })
        }
    }.stateIn(scope, SharingStarted.WhileSubscribed(5_000), KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING))

    fun reload() { generation.update { it + 1 } }
    fun stop() = scope.cancel()

    private suspend fun snapshot(data: KiloWorkspaceData) = coroutineScope {
        val models = async { data.models() }
        val commands = async { loadResource { data.commands() } }
        val skills = async { loadResource { data.skills() } }
        val rows = models.await()
        val shortcuts = commands.await()
        val available = skills.await()
        val errors = rows.errors + listOfNotNull(
            shortcuts.exceptionOrNull()?.let { LoadErrorDto("commands", detail = it.message) },
            available.exceptionOrNull()?.let { LoadErrorDto("skills", detail = it.message) },
        )
        KiloWorkspaceStateDto(if (errors.isEmpty()) KiloWorkspaceStatusDto.READY else KiloWorkspaceStatusDto.ERROR,
            providers = rows.providers, agents = rows.agents, commands = shortcuts.getOrNull().orEmpty(), skills = available.getOrNull().orEmpty(),
            errors = errors, error = errors.takeIf { it.isNotEmpty() }?.joinToString { it.resource + ": " + it.detail })
    }

    private companion object {
        val catalogEvents = setOf("location.shutdown", "config.updated", "provider.updated", "model.updated", "agent.updated",
            "command.updated", "skill.updated", "rpc.kilocode.gateway.catalog")
    }
}
