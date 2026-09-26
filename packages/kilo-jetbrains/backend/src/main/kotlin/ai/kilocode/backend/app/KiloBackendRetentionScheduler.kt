package ai.kilocode.backend.app

import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import java.util.concurrent.atomic.AtomicBoolean

@Service
class KiloBackendRetentionScheduler(private val cs: CoroutineScope) {
    private val started = AtomicBoolean()

    fun start() {
        if (!started.compareAndSet(false, true)) return
        cs.launch {
            retentionSchedule(
                attempt = {
                    val app = service<KiloBackendAppService>()
                    app.appState.first { it is KiloAppState.Ready }
                    app.retention.run(false)
                },
                wait = { delay(it) },
                failed = { LOG.warn("Automatic session cleanup failed", it) },
            )
        }
    }

    private companion object {
        val LOG = KiloLog.create(KiloBackendRetentionScheduler::class.java)
    }
}

class KiloBackendRetentionStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        service<KiloBackendRetentionScheduler>().start()
    }
}

internal suspend fun retentionSchedule(
    attempt: suspend () -> Unit,
    wait: suspend (Long) -> Unit,
    failed: (Throwable) -> Unit,
) {
    wait(RETENTION_INITIAL_DELAY_MS)
    while (currentCoroutineContext().isActive) {
        try {
            attempt()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            failed(e)
        }
        wait(RETENTION_INTERVAL_MS)
    }
}

internal const val RETENTION_INITIAL_DELAY_MS = 2 * 60_000L
internal const val RETENTION_INTERVAL_MS = 24 * 60 * 60_000L
