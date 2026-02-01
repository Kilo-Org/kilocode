package ai.kilo.plugin.services

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Project-level service that manages the Kilo integration for a specific project.
 * Coordinates the server, API client, event service, and state management.
 */
@Service(Service.Level.PROJECT)
class KiloProjectService(private val project: Project) : Disposable {
    private val log = Logger.getInstance(KiloProjectService::class.java)
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private var serverService: KiloServerService? = null
    private var apiClient: KiloApiClient? = null
    private var eventService: KiloEventService? = null
    private var stateService: KiloStateService? = null

    private val initMutex = Mutex()
    private var initDeferred: Deferred<Result<KiloStateService>>? = null

    var initialized = false
        private set

    val state: KiloStateService?
        get() = stateService

    val api: KiloApiClient?
        get() = apiClient

    /**
     * Initialize the Kilo services for this project.
     * Starts the server and sets up all necessary connections.
     *
     * Thread-safe: multiple callers will share the same initialization,
     * all waiting for the single init to complete.
     *
     * @return Result containing the KiloStateService on success
     */
    suspend fun initialize(): Result<KiloStateService> {
        val deferred = initMutex.withLock {
            initDeferred ?: scope.async { doInitialize() }.also { initDeferred = it }
        }
        return deferred.await()
    }

    private suspend fun doInitialize(): Result<KiloStateService> = runCatching {
        log.info("Initializing Kilo for project ${project.name}")

        // Start server
        serverService = KiloServerService.getInstance(project)
        serverService!!.start().getOrThrow()

        val baseUrl = serverService!!.baseUrl
        val directory = project.basePath ?: System.getProperty("user.home")

        // Create API client
        apiClient = KiloApiClient(baseUrl, directory)

        // Create and connect event service
        eventService = KiloEventService(apiClient!!.getEventStreamUrl())
        eventService!!.connect()

        // Create state service
        stateService = KiloStateService(apiClient!!, eventService!!)

        // Initialize state
        stateService!!.initialize()

        initialized = true
        log.info("Kilo initialized successfully for project ${project.name}")

        stateService!!
    }.onFailure {
        log.error("Failed to initialize Kilo", it)
    }

    /**
     * Shut down all Kilo services.
     */
    fun shutdown() {
        log.info("Shutting down Kilo for project ${project.name}")

        stateService?.dispose()
        stateService = null

        eventService?.dispose()
        eventService = null

        apiClient?.close()
        apiClient = null

        serverService?.stop()
        serverService = null

        initialized = false
        initDeferred = null
    }

    /**
     * Restart all services.
     */
    suspend fun restart(): Result<KiloStateService> {
        shutdown()
        delay(500)
        return initialize()
    }

    override fun dispose() {
        scope.cancel()
        shutdown()
    }

    companion object {
        fun getInstance(project: Project): KiloProjectService {
            return project.getService(KiloProjectService::class.java)
        }
    }
}
