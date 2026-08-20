package ai.kilocode.backend.rpc

import ai.kilocode.backend.run.WorktreeRunManager
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloRunRpcApi
import ai.kilocode.rpc.dto.RunConfigListDto
import ai.kilocode.rpc.dto.RunResultDto
import ai.kilocode.rpc.dto.RunStateDto
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.io.FileUtil
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * Backend implementation of [KiloRunRpcApi]. Resolves the open project owning [directory]
 * (the main repository root of the Agent Manager surface) and delegates to its
 * project-level [WorktreeRunManager].
 */
class KiloRunRpcApiImpl : KiloRunRpcApi {

    companion object {
        private val LOG = KiloLog.create(KiloRunRpcApiImpl::class.java)
    }

    override suspend fun configs(directory: String): RunConfigListDto {
        val project = resolve(directory) ?: return RunConfigListDto(error = "no open project for $directory")
        return project.getService(WorktreeRunManager::class.java).configs()
    }

    override suspend fun run(directory: String, id: String, worktree: String): RunResultDto {
        val project = resolve(directory) ?: return RunResultDto(error = "no open project for $directory")
        return project.getService(WorktreeRunManager::class.java).run(id, worktree)
    }

    override suspend fun stop(directory: String, id: String, worktree: String): Boolean {
        val project = resolve(directory) ?: return false
        return project.getService(WorktreeRunManager::class.java).stop(id, worktree)
    }

    override suspend fun focus(directory: String, id: String, worktree: String): Boolean {
        val project = resolve(directory) ?: return false
        return project.getService(WorktreeRunManager::class.java).focus(id, worktree)
    }

    override suspend fun states(directory: String): Flow<List<RunStateDto>> {
        val project = resolve(directory) ?: run {
            LOG.warn("worktree run states: no open project for $directory")
            return flowOf(emptyList())
        }
        return project.getService(WorktreeRunManager::class.java).states
    }

    private fun resolve(directory: String): Project? {
        return ProjectManager.getInstance().openProjects.firstOrNull {
            !it.isDefault && !it.isDisposed &&
                (FileUtil.pathsEqual(it.basePath, directory) || FileUtil.pathsEqual(it.presentableUrl, directory))
        }
    }
}
