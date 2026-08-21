@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.platform.project.projectIdOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async

/**
 * The real backend project directory for [project], resolved once and cached.
 *
 * In split mode the frontend `project.basePath` is a synthetic JetBrains Client path, so backend
 * calls that need the project root must go through this resolver instead.
 */
@Service(Service.Level.PROJECT)
class ProjectRoot(private val project: Project, cs: CoroutineScope) {
    private val root: Deferred<String> = cs.async(start = CoroutineStart.LAZY) {
        service<KiloWorkspaceService>().resolveProjectDirectory(project.projectIdOrNull(), project.basePath ?: "")
    }

    /** Blank when the root cannot be resolved. */
    suspend fun get(): String = root.await()
}
