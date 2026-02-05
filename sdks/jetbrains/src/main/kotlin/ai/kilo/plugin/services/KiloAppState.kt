package ai.kilo.plugin.services

import ai.kilo.plugin.api.KiloEventService
import ai.kilo.plugin.api.ServerEvent
import ai.kilo.plugin.model.*
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

/**
 * App-level state management for the Kilo plugin.
 *
 * Manages:
 * - Agents and providers configuration
 * - Current agent/model selection (used when sending messages)
 * - VCS information
 * - Attached files context
 * - Connection status
 *
 * This is separate from ChatUiStateManager which manages session/message data.
 */
class KiloAppState(
    private val apiClient: KiloApiClient,
    private val eventService: KiloEventService
) : Disposable {

    private val log = Logger.getInstance(KiloAppState::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // ==================== App Configuration ====================

    private val _providers = MutableStateFlow<ProviderListResponse?>(null)
    val providers: StateFlow<ProviderListResponse?> = _providers.asStateFlow()

    private val _agents = MutableStateFlow<List<Agent>>(emptyList())
    val agents: StateFlow<List<Agent>> = _agents.asStateFlow()

    private val _vcsInfo = MutableStateFlow<VcsInfo?>(null)
    val vcsInfo: StateFlow<VcsInfo?> = _vcsInfo.asStateFlow()

    // ==================== Current Selections ====================

    private val _selectedModel = MutableStateFlow<ModelRef?>(null)
    val selectedModel: StateFlow<ModelRef?> = _selectedModel.asStateFlow()

    private val _selectedAgent = MutableStateFlow<String?>(null)
    val selectedAgent: StateFlow<String?> = _selectedAgent.asStateFlow()

    private val _attachedFiles = MutableStateFlow<List<AttachedFile>>(emptyList())
    val attachedFiles: StateFlow<List<AttachedFile>> = _attachedFiles.asStateFlow()

    // ==================== Status ====================

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    val connectionStatus: StateFlow<KiloEventService.ConnectionStatus>
        get() = eventService.connectionStatus

    // ==================== Initialization ====================

    init {
        subscribeToVcsEvents()
    }

    suspend fun initialize() {
        _isLoading.value = true
        _error.value = null

        try {
            // Load providers and agents
            _providers.value = apiClient.listProviders()
            _agents.value = apiClient.listAgents()

            // Load VCS info
            try {
                _vcsInfo.value = apiClient.getVcsInfo()
            } catch (e: Exception) {
                log.debug("VCS info not available: ${e.message}")
            }

            log.info("KiloAppState initialized: ${_agents.value.size} agents, ${_providers.value?.all?.size ?: 0} providers")
        } catch (e: Exception) {
            log.error("Failed to initialize KiloAppState", e)
            _error.value = e.message
        } finally {
            _isLoading.value = false
        }
    }

    private fun subscribeToVcsEvents() {
        scope.launch {
            eventService.events.collect { event ->
                when (event) {
                    is ServerEvent.VcsBranchUpdated -> {
                        _vcsInfo.value = VcsInfo(branch = event.branch)
                    }
                    else -> { }
                }
            }
        }
    }

    // ==================== Selection Methods ====================

    fun setSelectedModel(model: ModelRef?) {
        _selectedModel.value = model
    }

    fun setSelectedAgent(agent: String?) {
        _selectedAgent.value = agent
    }

    // ==================== Attached Files ====================

    fun addFileToContext(file: AttachedFile) {
        _attachedFiles.update { files ->
            if (files.any {
                    it.absolutePath == file.absolutePath &&
                            it.startLine == file.startLine &&
                            it.endLine == file.endLine
                }) {
                files
            } else {
                files + file
            }
        }
    }

    fun removeFileFromContext(absolutePath: String, startLine: Int? = null, endLine: Int? = null) {
        _attachedFiles.update { files ->
            files.filter {
                !(it.absolutePath == absolutePath &&
                        it.startLine == startLine &&
                        it.endLine == endLine)
            }
        }
    }

    fun clearAttachedFiles() {
        _attachedFiles.value = emptyList()
    }

    // ==================== File Search ====================

    suspend fun searchFiles(query: String, limit: Int = 50): List<String> {
        return try {
            apiClient.searchFiles(query, limit)
        } catch (e: Exception) {
            log.error("Failed to search files", e)
            emptyList()
        }
    }

    // ==================== Error Handling ====================

    fun clearError() {
        _error.value = null
    }

    // ==================== Lifecycle ====================

    override fun dispose() {
        scope.cancel()
    }
}

/**
 * Data class for attached file context.
 */
data class AttachedFile(
    val absolutePath: String,
    val relativePath: String,
    val startLine: Int? = null,
    val endLine: Int? = null,
    val mime: String = "text/plain"
) {
    fun toFileUrl(): String {
        val base = "file://$absolutePath"
        return when {
            startLine != null && endLine != null -> "$base?start=$startLine&end=$endLine"
            startLine != null -> "$base?start=$startLine"
            else -> base
        }
    }

    fun toPromptPart(): FilePromptPart {
        return FilePromptPart(
            url = toFileUrl(),
            mime = mime,
            filename = relativePath
        )
    }
}
