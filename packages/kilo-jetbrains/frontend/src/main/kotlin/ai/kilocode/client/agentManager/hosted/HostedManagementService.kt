package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.ide.util.PropertiesComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest

/**
 * IDE-local Agent Manager state for hosted workspaces: which workspaces this project removed,
 * which child sessions are closed, and which child was selected. Cloud remains authoritative for
 * workspaces and sessions; nothing here duplicates Cloud metadata or transcripts.
 */
@Service(Service.Level.PROJECT)
class HostedManagementService internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    @Serializable
    data class Preferences(
        val excluded: Set<String> = emptySet(),
        val closed: Map<String, Set<String>> = emptyMap(),
        val selected: Map<String, String> = emptyMap(),
        val visibleList: Set<String> = emptySet(),
        val pendingDelete: Set<String> = emptySet(),
        val dismissed: Set<String> = emptySet(),
    )

    private data class Scope(val account: String, val organization: String, val repository: String)

    private val json = Json { ignoreUnknownKeys = true }
    private val _preferences = MutableStateFlow(Preferences())
    val preferences: StateFlow<Preferences> = _preferences.asStateFlow()
    private var loaded = ""

    init {
        val app = service<KiloAppService>()
        cs.launch {
            app.state.collect {
                val key = scopeKey()
                if (key == loaded) return@collect
                withContext(Dispatchers.Main) {
                    if (key == loaded) return@withContext
                    loaded = key
                    _preferences.value = read(key)
                    service<HostedWorkspaceCache>().clear()
                }
            }
        }
    }

    fun refreshScope() {
        loaded = scopeKey()
        _preferences.value = read(loaded)
    }

    fun visible(items: List<HostedWorkspaceDto>): List<HostedWorkspaceDto> =
        items.filterNot { it.ref.key in _preferences.value.excluded }

    fun excluded(ref: HostedWorkspaceRefDto): Boolean = ref.key in current().excluded

    fun restore(ref: HostedWorkspaceRefDto) {
        write(current().copy(excluded = current().excluded - ref.key))
    }

    fun remove(ref: HostedWorkspaceRefDto) {
        write(current().copy(excluded = current().excluded + ref.key))
    }

    fun closed(ref: HostedWorkspaceRefDto): Set<String> = current().closed[ref.key].orEmpty()

    fun close(ref: HostedWorkspaceRefDto, sessionID: String) {
        val closed = current().closed + (ref.key to (closed(ref) + sessionID))
        write(current().copy(closed = closed, selected = current().selected - ref.key))
    }

    fun reopen(ref: HostedWorkspaceRefDto, sessionID: String) {
        val closed = current().closed + (ref.key to (closed(ref) - sessionID))
        write(current().copy(closed = closed.filterValues { it.isNotEmpty() }))
    }

    fun selected(ref: HostedWorkspaceRefDto): String? = current().selected[ref.key]

    fun select(ref: HostedWorkspaceRefDto, sessionID: String?) {
        val selected = if (sessionID == null) current().selected - ref.key else current().selected + (ref.key to sessionID)
        write(current().copy(selected = selected))
    }

    fun listVisible(ref: HostedWorkspaceRefDto): Boolean = ref.key in current().visibleList

    fun saveListVisible(ref: HostedWorkspaceRefDto, visible: Boolean) {
        val keys = if (visible) current().visibleList + ref.key else current().visibleList - ref.key
        write(current().copy(visibleList = keys))
    }

    fun pendingDelete(ref: HostedWorkspaceRefDto): Boolean = ref.key in current().pendingDelete

    fun markPendingDelete(ref: HostedWorkspaceRefDto) {
        write(current().copy(pendingDelete = current().pendingDelete + ref.key))
    }

    fun clearDelete(ref: HostedWorkspaceRefDto) {
        write(current().copy(pendingDelete = current().pendingDelete - ref.key, dismissed = current().dismissed - ref.key))
    }

    fun dismissed(ref: HostedWorkspaceRefDto): Boolean = ref.key in current().dismissed

    fun dismiss(ref: HostedWorkspaceRefDto) {
        write(
            current().copy(
                dismissed = current().dismissed + ref.key,
                excluded = current().excluded + ref.key,
                pendingDelete = current().pendingDelete - ref.key,
            ),
        )
    }

    fun forget(ref: HostedWorkspaceRefDto) {
        val key = ref.key
        val closed = current().closed - key
        val selected = current().selected - key
        write(
            current().copy(
                excluded = current().excluded - key,
                closed = closed,
                selected = selected,
                visibleList = current().visibleList - key,
                pendingDelete = current().pendingDelete - key,
                dismissed = current().dismissed - key,
            ),
        )
    }

    private fun current(): Preferences = _preferences.value

    private fun read(key: String): Preferences {
        val raw = PropertiesComponent.getInstance(project).getValue(storageKey(key)) ?: return Preferences()
        return runCatching { json.decodeFromString<Preferences>(raw) }.getOrElse { Preferences() }
    }

    private fun write(value: Preferences) {
        if (loaded.isBlank()) loaded = scopeKey()
        _preferences.value = value
        PropertiesComponent.getInstance(project).setValue(storageKey(loaded), json.encodeToString(value))
    }

    private fun storageKey(scope: String): String = "kilo.hosted.management.$scope"

    private fun scopeKey(): String {
        val app = runCatching { service<KiloAppService>() }.getOrNull()
        val profile = app?.state?.value?.profile
        val scope = Scope(
            account = profile?.email.orEmpty(),
            organization = profile?.currentOrgId.orEmpty(),
            repository = project.basePath.orEmpty(),
        )
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("${scope.account}\u0000${scope.organization}\u0000${scope.repository}".toByteArray())
        return digest.take(12).joinToString("") { "%02x".format(it) }
    }
}
