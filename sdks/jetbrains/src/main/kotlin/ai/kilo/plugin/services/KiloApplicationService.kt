package ai.kilo.plugin.services

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger

/**
 * Application-level service for Kilo.
 * Manages global settings and configuration that apply across all projects.
 */
@Service(Service.Level.APP)
class KiloApplicationService : Disposable {
    private val log = Logger.getInstance(KiloApplicationService::class.java)

    // Global settings
    var defaultModel: String? = null
    var defaultAgent: String? = null

    init {
        log.info("Kilo application service initialized")
    }

    override fun dispose() {
        log.info("Kilo application service disposed")
    }

    companion object {
        fun getInstance(): KiloApplicationService {
            return com.intellij.openapi.application.ApplicationManager.getApplication()
                .getService(KiloApplicationService::class.java)
        }
    }
}
