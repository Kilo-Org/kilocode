package ai.kilocode.backend

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope

/**
 * Project-level backend service that provides the project's working
 * directory for scoping CLI API calls.
 *
 * Currently a thin shell — will hold project-scoped data loading
 * (providers, agents, config, etc.) in the future.
 */
@Service(Service.Level.PROJECT)
class KiloBackendProjectService(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    /** Project working directory sent as the `directory` parameter. */
    val directory: String
        get() = project.basePath ?: ""
}
