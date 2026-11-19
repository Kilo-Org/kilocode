@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.workspace.KiloWorktreeIndexSettings
import ai.kilocode.log.KiloLog
import ai.kilocode.log.LogConfig
import ai.kilocode.rpc.KiloAppRpcApi
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.LogConfigDto
import ai.kilocode.rpc.dto.LogFileDto
import ai.kilocode.rpc.dto.ModelFavoriteUpdateDto
import ai.kilocode.rpc.dto.ModelSelectionUpdateDto
import ai.kilocode.rpc.dto.ModelVariantUpdateDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.writeAction
import com.intellij.openapi.components.service
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.RootsChangeRescanningInfo
import com.intellij.openapi.roots.ex.ProjectRootManagerEx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.file.Files

class KiloAppRpcApiImpl : KiloAppRpcApi {
    private val app get() = service<KiloBackendAppService>()
    private val cli get() = service<KiloBackendCliManager>()

    override suspend fun connect() = app.connect()
    override suspend fun state() = app.appState
    override suspend fun health() = app.health()
    override suspend fun cliVersion() = cli.version
    override suspend fun cliPlatform() = cli.platform
    override suspend fun cliBundled() = cli.bundled
    override suspend fun retry() = app.retry()
    override suspend fun restart() = app.restart()
    override suspend fun reinstall() = app.reinstall()

    override suspend fun modelState() = app.models.state()
    override suspend fun updateModelFavorite(update: ModelFavoriteUpdateDto) = app.models.favorite(update)
    override suspend fun updateModelSelection(update: ModelSelectionUpdateDto) = app.models.selection(update)
    override suspend fun updateModelVariant(update: ModelVariantUpdateDto) = app.models.variant(update)
    override suspend fun updateConfig(patch: ConfigPatchDto) = app.updateConfig(patch)
    override suspend fun retentionStatus() = app.retention.status()
    override suspend fun runRetention(force: Boolean) = app.retention.run(force)
    override suspend fun applyLogConfig(config: LogConfigDto) = LogConfig.apply(config.level, config.contentMode, config.previewMax)

    override suspend fun indexWorktrees() = KiloWorktreeIndexSettings.get()

    override suspend fun setIndexWorktrees(value: Boolean) {
        if (KiloWorktreeIndexSettings.get() == value) return
        KiloWorktreeIndexSettings.set(value)
        if (ApplicationManager.getApplication() == null) return
        ProjectManager.getInstance().openProjects.forEach { project ->
            writeAction {
                if (!project.isDisposed) ProjectRootManagerEx.getInstanceEx(project)
                    .makeRootsChange({}, RootsChangeRescanningInfo.RESCAN_DEPENDENCIES_IF_NEEDED)
            }
        }
    }

    override suspend fun backendLogFile(): LogFileDto? = withContext(Dispatchers.IO) {
        val path = KiloLog.logFile()
        if (Files.exists(path)) LogFileDto(path.fileName.toString(), Files.readString(path)) else null
    }

    override suspend fun refreshProfile() = app.refreshProfile()
    override suspend fun startLogin(directory: String?) = app.startLogin(directory)
    override suspend fun completeLogin(directory: String?) = app.completeLogin(directory)
    override suspend fun logout() = app.logout()
    override suspend fun setOrganization(organizationId: String?) = app.setOrganization(organizationId)

}
