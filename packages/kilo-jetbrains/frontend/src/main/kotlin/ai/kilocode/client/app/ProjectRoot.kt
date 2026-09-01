@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.platform.project.projectIdOrNull
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The real backend project directory for [project], resolved once and cached.
 *
 * In split mode the frontend `project.basePath` is a synthetic JetBrains Client path, so backend
 * calls that need the project root must go through this resolver instead.
 *
 * Only a genuine backend resolution is cached. A transient RPC failure would otherwise fall back to
 * the synthetic hint and poison the cache for the whole project lifetime, breaking every run/stats/
 * PR/gh call; instead the failure returns blank uncached so the next caller retries.
 */
@Service(Service.Level.PROJECT)
class ProjectRoot(private val project: Project) {
    private val lock = Mutex()

    @Volatile
    private var cached: String? = null

    /** Blank when the root cannot currently be resolved; retried on the next call. */
    suspend fun get(): String {
        cached?.let { return it }
        return lock.withLock {
            cached ?: run {
                val resolved = service<KiloWorkspaceService>()
                    .resolveProjectDirectoryOrNull(project.projectIdOrNull(), project.basePath ?: "")
                resolved?.also { cached = it } ?: ""
            }
        }
    }
}

/** The resolved backend project root, or null when it cannot currently be resolved. */
suspend fun Project.kiloRoot(): String? = service<ProjectRoot>().get().takeIf { it.isNotBlank() }
