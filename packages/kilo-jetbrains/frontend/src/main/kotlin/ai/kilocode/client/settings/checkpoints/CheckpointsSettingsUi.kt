package ai.kilocode.client.settings.checkpoints

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.BaseSettingsUi
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.components.service
import com.intellij.platform.project.ProjectId
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope

internal class CheckpointsSettingsUi(
    cs: CoroutineScope,
    private val app: KiloAppService = service(),
    private val workspaces: KiloWorkspaceService = service(),
    hint: String? = null,
    projectId: ProjectId? = null,
) : BaseSettingsUi<CheckpointsContent, CheckpointsDraft, ConfigPatchDto, CheckpointsResult, ConfigDto?>(
    cs,
    CheckpointsDraft(),
    app,
    workspaces,
    loginBanner = false,
) {
    private var effective: ConfigDto? = null

    init {
        startSettings(CheckpointsContent { updateDraft(it) })
        if (hint != null) loadProject(projectId, hint)
    }

    override fun change(from: CheckpointsDraft, to: CheckpointsDraft): ConfigPatchDto? = patch(from, to)

    override fun save(change: ConfigPatchDto, done: (CheckpointsResult?) -> Unit) {
        val root = projectDirectory
        if (root != null) {
            workspaces.updateConfigAsync(root, change) { config -> done(config?.let(::CheckpointsResult)) }
            return
        }
        app.updateConfigAsync(change) { state -> done(state?.config?.let(::CheckpointsResult)) }
    }

    override fun base(result: CheckpointsResult): CheckpointsDraft {
        effective = result.config
        return checkpointsDraft(result.config)
    }

    override fun draft(state: KiloAppStateDto): CheckpointsDraft = checkpointsDraft(effective ?: state.config)

    override fun saved(base: CheckpointsDraft, draft: CheckpointsDraft): Boolean = savedMatches(base, draft)

    override fun pendingText(): String = KiloBundle.message("settings.checkpoints.saving")

    override fun failedText(): String = KiloBundle.message("settings.checkpoints.save.failed")

    override suspend fun loadWorkspace(root: String): ConfigDto? = workspaces.config(root)

    override fun applyWorkspace(result: ConfigDto?) {
        effective = result
    }

    override fun logSaveStarted(change: ConfigPatchDto) = LOG.info("checkpoints settings save: started")

    override fun logSaveCompleted(change: ConfigPatchDto) = LOG.info("checkpoints settings save: completed")

    override fun logSaveFailed(change: ConfigPatchDto) = LOG.warn("checkpoints settings save: failed")

    override fun logSaveFailedAfterDispose(change: ConfigPatchDto) =
        LOG.warn("checkpoints settings save: failed after dispose")

    override fun logSaveCompletedAfterDispose(change: ConfigPatchDto) =
        LOG.info("checkpoints settings save: completed after dispose")

    @RequiresEdt
    override fun syncContent() {
        val ready = appState.status == KiloAppStatusDto.READY
        form.sync(draft, ready && !saving && (!hasProjectDirectory || workspaceLoaded))
        top.hideBanner()
        if (saving) {
            showProgress(KiloBundle.message("settings.checkpoints.saving"))
            return
        }
        if (hasProjectDirectory && !workspaceLoaded) {
            showProgress(KiloBundle.message("settings.checkpoints.loading"))
            return
        }
        val err = saveError
        if (err != null) {
            showError(err)
            return
        }
        if (!ready) {
            showProgress(KiloBundle.message("settings.cli.unavailable.message"))
            return
        }
        clearProgress()
    }

    private companion object {
        val LOG = KiloLog.create(CheckpointsSettingsUi::class.java)
    }
}

internal data class CheckpointsResult(val config: ConfigDto)

internal class CheckpointsContent(
    private val update: (CheckpointsDraft.() -> CheckpointsDraft) -> Unit,
) : BaseContentPanel() {
    private val enabled = SettingsToggle { value -> update { copy(enabled = value) } }

    init {
        section(
            KiloBundle.message("settings.checkpoints.displayName"),
            KiloBundle.message("settings.checkpoints.description"),
        ).row(SettingsRow(
            KiloBundle.message("settings.checkpoints.enable.title"),
            KiloBundle.message("settings.checkpoints.enable.description"),
            enabled,
        ))
    }

    @RequiresEdt
    fun sync(draft: CheckpointsDraft, available: Boolean) {
        enabled.isSelected = draft.enabled
        enabled.isEnabled = available
    }
}
