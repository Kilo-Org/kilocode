package ai.kilocode.client.settings.checkpoints

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.BaseSettingsUi
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.RetentionStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.ComponentValidator
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.util.text.DateFormatUtil
import com.intellij.platform.project.ProjectId
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.components.fields.IntegerField
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JButton
import javax.swing.event.DocumentEvent

internal class CheckpointsSettingsUi(
    cs: CoroutineScope,
    private val app: KiloAppService = service(),
    private val workspaces: KiloWorkspaceService = service(),
    hint: String? = null,
    projectId: ProjectId? = null,
    private val confirm: (() -> Boolean)? = null,
) : BaseSettingsUi<CheckpointsContent, CheckpointsDraft, CheckpointsChange, CheckpointsResult, ConfigDto?>(
    cs,
    CheckpointsDraft(),
    app,
    workspaces,
    loginBanner = false,
) {
    private var effective: ConfigDto? = null
    private var retention: RetentionStatusDto? = null
    private var pending = false
    private var retentionError = false
    private var retentionPoll: kotlinx.coroutines.Job? = null

    init {
        startSettings(CheckpointsContent(this, { updateDraft(it) }, ::runCleanup, ::syncContent))
        if (hint != null) loadProject(projectId, hint)
        startRetentionPoll()
    }

    override fun change(from: CheckpointsDraft, to: CheckpointsDraft): CheckpointsChange? = patch(from, to)

    override fun save(change: CheckpointsChange, done: (CheckpointsResult?) -> Unit) {
        saveSnapshot(change) { snapshot ->
            if (snapshot == null) {
                done(null)
                return@saveSnapshot
            }
            val policy = change.retention
            if (policy == null) {
                done(CheckpointsResult(snapshot, appState.config ?: ConfigDto()))
                return@saveSnapshot
            }
            app.updateConfigAsync(ConfigPatchDto(retention = policy)) { state ->
                val global = state?.config
                done(global?.let { CheckpointsResult(snapshot, it) })
            }
        }
    }

    private fun saveSnapshot(change: CheckpointsChange, done: (ConfigDto?) -> Unit) {
        val snapshot = change.snapshot
        if (snapshot == null) {
            done(effective ?: appState.config ?: ConfigDto())
            return
        }
        val patch = ConfigPatchDto(snapshot = snapshot)
        val root = projectDirectory
        if (root != null) {
            workspaces.updateConfigAsync(root, patch, done)
            return
        }
        app.updateConfigAsync(patch) { state -> done(state?.config) }
    }

    override fun base(result: CheckpointsResult): CheckpointsDraft {
        effective = result.effective
        return checkpointsDraft(result.effective, result.global)
    }

    override fun draft(state: KiloAppStateDto): CheckpointsDraft =
        checkpointsDraft(effective ?: state.config, state.config)

    override fun saved(base: CheckpointsDraft, draft: CheckpointsDraft): Boolean = savedMatches(base, draft)

    override fun pendingText(): String = KiloBundle.message("settings.checkpoints.saving")

    override fun failedText(): String = KiloBundle.message("settings.checkpoints.save.failed")

    override suspend fun loadWorkspace(root: String): ConfigDto? = workspaces.config(root)

    override fun applyWorkspace(result: ConfigDto?) {
        effective = result
    }

    override fun restoreFields() {
        form.restore()
    }

    override fun logSaveStarted(change: CheckpointsChange) = LOG.info("checkpoints settings save: started")
    override fun logSaveCompleted(change: CheckpointsChange) = LOG.info("checkpoints settings save: completed")
    override fun logSaveFailed(change: CheckpointsChange) = LOG.warn("checkpoints settings save: failed")
    override fun logSaveFailedAfterDispose(change: CheckpointsChange) = LOG.warn("checkpoints settings save: failed after dispose")
    override fun logSaveCompletedAfterDispose(change: CheckpointsChange) = LOG.info("checkpoints settings save: completed after dispose")

    @RequiresEdt
    override fun syncContent() {
        val ready = appState.status == KiloAppStatusDto.READY
        val available = ready && !saving && (!hasProjectDirectory || workspaceLoaded)
        form.sync(draft, available, modified(), saving, retention, pending, retentionError)
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

    @RequiresEdt
    private fun runCleanup() {
        val accepted = confirm?.invoke() ?: Messages.showYesNoDialog(
            this,
            KiloBundle.message("settings.checkpoints.cleanup.confirm.message"),
            KiloBundle.message("settings.checkpoints.cleanup.confirm.title"),
            Messages.getWarningIcon(),
        ) == Messages.YES
        if (!accepted) return
        pending = true
        retentionError = false
        syncContent()
        startRetentionPoll()
        LOG.info("manual session cleanup: confirmed")
        jobs += app.runRetentionAsync(true) { result ->
            ApplicationManager.getApplication().invokeLater({
                if (isDisposed) return@invokeLater
                pending = false
                if (result != null) {
                    retention = result
                } else {
                    retentionError = true
                    KiloNotifications.error(
                        null,
                        KiloBundle.message("settings.checkpoints.cleanup.error.title"),
                        KiloBundle.message("settings.checkpoints.cleanup.error.message"),
                    )
                }
                syncContent()
            }, ModalityState.any())
        }
    }

    @RequiresEdt
    private fun startRetentionPoll() {
        if (retentionPoll?.isActive == true) return
        val job = scope.launch {
            do {
                val status = app.retentionStatus()
                val active = withContext(UI) {
                    if (status != null) {
                        retention = status
                        retentionError = false
                    } else {
                        retentionError = true
                    }
                    syncContent()
                    pending || status?.progress != null
                }
                if (active) delay(RETENTION_POLL_MS)
            } while (active && isActive)
        }
        retentionPoll = job
        jobs += job
    }

    private companion object {
        const val RETENTION_POLL_MS = 1_000L
        val LOG = KiloLog.create(CheckpointsSettingsUi::class.java)
        val UI = Dispatchers.EDT + ModalityState.any().asContextElement()
    }
}

internal data class CheckpointsResult(val effective: ConfigDto, val global: ConfigDto)

internal class CheckpointsContent(
    parent: Disposable,
    private val update: (CheckpointsDraft.() -> CheckpointsDraft) -> Unit,
    cleanupAction: () -> Unit,
    refresh: () -> Unit,
) : BaseContentPanel() {
    private val snapshot = SettingsToggle { value -> update { copy(snapshot = value) } }.apply {
        name = "checkpoint-snapshots"
    }
    private val cleanup = SettingsToggle { value -> update { copy(cleanup = value) } }.apply {
        name = "checkpoint-cleanup"
    }
    private val days = RetentionDaysField(parent, { value -> update { copy(days = value) } }, refresh)
    private val runButton = JButton(KiloBundle.message("settings.checkpoints.cleanup.run")).apply {
        name = "checkpoint-cleanup-run"
        addActionListener { cleanupAction() }
    }
    private val last = SettingsRow(KiloBundle.message("settings.checkpoints.cleanup.last"), value = runButton)

    init {
        section(
            KiloBundle.message("settings.checkpoints.displayName"),
            KiloBundle.message("settings.checkpoints.description"),
        ).row(SettingsRow(
            KiloBundle.message("settings.checkpoints.enable.title"),
            KiloBundle.message("settings.checkpoints.enable.description"),
            snapshot,
        ))
        section(
            KiloBundle.message("settings.checkpoints.cleanup.section"),
            KiloBundle.message("settings.checkpoints.cleanup.description"),
        ).row(SettingsRow(
            KiloBundle.message("settings.checkpoints.cleanup.enable.title"),
            KiloBundle.message("settings.checkpoints.cleanup.enable.description"),
            cleanup,
        )).row(SettingsRow(
            KiloBundle.message("settings.checkpoints.cleanup.days.title"),
            KiloBundle.message("settings.checkpoints.cleanup.days.description"),
            days,
        )).row(last)
    }

    @RequiresEdt
    fun sync(
        draft: CheckpointsDraft,
        available: Boolean,
        dirty: Boolean,
        saving: Boolean,
        status: RetentionStatusDto?,
        pending: Boolean,
        error: Boolean,
    ) {
        snapshot.isSelected = draft.snapshot
        snapshot.isEnabled = available
        cleanup.isSelected = draft.cleanup
        cleanup.isEnabled = available
        days.sync(draft.days)
        days.isEnabled = available && draft.cleanup
        val running = pending || status?.progress != null
        runButton.isEnabled = available && draft.cleanup && days.valid() && !dirty && !running
        runButton.text = KiloBundle.message(if (running) "settings.checkpoints.cleanup.running" else "settings.checkpoints.cleanup.run")
        last.update(
            KiloBundle.message("settings.checkpoints.cleanup.last"),
            statusText(status, pending, error),
            runButton,
        )
    }

    fun restore() {
        days.restore()
    }

    private fun statusText(status: RetentionStatusDto?, pending: Boolean, error: Boolean): String {
        val progress = status?.progress
        if (progress != null) return if (progress.phase == "scanning") {
            KiloBundle.message("settings.checkpoints.cleanup.progress.scanning", progress.processed, progress.total)
        } else {
            KiloBundle.message(
                "settings.checkpoints.cleanup.progress.deleting",
                progress.processed,
                progress.total,
                progress.deleted,
                progress.failed,
            )
        }
        if (pending) return KiloBundle.message("settings.checkpoints.cleanup.starting")
        val result = status?.last
        if (result == null && error) return KiloBundle.message("settings.checkpoints.cleanup.status.error")
        if (result == null) return KiloBundle.message("settings.checkpoints.cleanup.never")
        return KiloBundle.message(
            "settings.checkpoints.cleanup.last.details",
            DateFormatUtil.formatDateTime(result.at),
            result.deleted,
            result.scanned,
            result.skippedActive,
            result.failed,
            String.format("%.1f", maxOf(100L, result.durationMs) / 1000.0),
        )
    }
}

private class RetentionDaysField(
    parent: Disposable,
    private val change: (Int) -> Unit,
    private val refresh: () -> Unit,
) : IntegerField(KiloBundle.message("settings.checkpoints.cleanup.days.title"), 1, Int.MAX_VALUE) {
    private var synced = false

    init {
        name = "checkpoint-cleanup-days"
        columns = 8
        isCanBeEmpty = true
        defaultValue = 30
        document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                val value = text.trim().takeIf { it.matches(Regex("^\\d+$")) }?.toIntOrNull()
                if (value != null && value >= 1) change(value)
                ApplicationManager.getApplication().invokeLater(refresh)
            }
        })
        ComponentValidator(parent)
            .withValidator {
                if (valid()) null else ValidationInfo(
                    KiloBundle.message("settings.checkpoints.cleanup.days.invalid"),
                    this,
                )
            }
            .andRegisterOnDocumentListener(this)
            .installOn(this)
    }

    fun valid(): Boolean {
        val value = text.trim()
        return value.matches(Regex("^\\d+$")) && value.toIntOrNull()?.let { it >= 1 } == true
    }

    fun sync(value: Int) {
        if (synced && !valid()) return
        if ((!synced || !hasFocus()) && text != value.toString()) text = value.toString()
        synced = true
    }

    fun restore() {
        synced = false
    }
}
