package ai.kilocode.backend.plugin

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.log.KiloLog
import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.components.serviceIfCreated

class KiloBackendAppLifecycleListener : AppLifecycleListener {
    private val log = KiloLog.create(KiloBackendAppLifecycleListener::class.java)

    override fun appWillBeClosed(isRestart: Boolean) {
        log.info("appWillBeClosed(isRestart=$isRestart) — stopping Kilo CLI")
        runCatching {
            serviceIfCreated<KiloBackendAppService>()?.shutdown()
            serviceIfCreated<KiloBackendCliManager>()?.shutdown(fast = true)
        }.onFailure { log.warn("Failed to stop CLI on app close", it) }
    }
}
