package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseSettingsUi
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.components.service
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import java.awt.BorderLayout
import javax.swing.event.DocumentEvent

internal class AutoApproveSettingsUi(
    cs: CoroutineScope,
    private val app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
    private val picker: LevelPicker = PopupLevelPicker,
) : BaseSettingsUi<AutoApproveContent, PermissionDraft, ConfigPatchDto, KiloAppStateDto, Unit>(
    cs,
    PermissionDraft(),
    app,
    workspaces,
    loginBanner = false,
) {
    private val search = SearchTextField(false)

    init {
        search.textEditor.emptyText.text = KiloBundle.message("settings.autoApprove.filter")
        search.border = JBUI.Borders.empty(UiStyle.Gap.md(), UiStyle.Gap.pad())
        search.textEditor.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) = form.filter(search.text)
        })
        content.add(search, BorderLayout.NORTH)
        startSettings(AutoApproveContent({ updateDraft(it) }, picker))
    }

    override fun change(from: PermissionDraft, to: PermissionDraft): ConfigPatchDto? = patch(from, to)

    override fun save(change: ConfigPatchDto, done: (KiloAppStateDto?) -> Unit) {
        app.updateConfigAsync(change, done)
    }

    override fun base(result: KiloAppStateDto): PermissionDraft = permissionDraft(result.config)

    override fun draft(state: KiloAppStateDto): PermissionDraft = permissionDraft(state.config)

    override fun saved(base: PermissionDraft, draft: PermissionDraft): Boolean = savedMatches(base, draft)

    override fun pendingText(): String = KiloBundle.message("settings.autoApprove.save.pending")

    override fun failedText(): String = KiloBundle.message("settings.autoApprove.save.failed")

    override suspend fun loadWorkspace(root: String) = Unit

    override fun applyWorkspace(result: Unit) = Unit

    override fun logSaveStarted(change: ConfigPatchDto) = LOG.info("auto-approve settings save: started")

    override fun logSaveCompleted(change: ConfigPatchDto) = LOG.info("auto-approve settings save: completed")

    override fun logSaveFailed(change: ConfigPatchDto) = LOG.warn("auto-approve settings save: failed")

    override fun logSaveFailedAfterDispose(change: ConfigPatchDto) = LOG.warn("auto-approve settings save: failed after dispose")

    override fun logSaveCompletedAfterDispose(change: ConfigPatchDto) = LOG.info("auto-approve settings save: completed after dispose")

    @RequiresEdt
    override fun syncContent() {
        val ready = appState.status == KiloAppStatusDto.READY
        val editable = ready && !saving
        form.sync(draft, editable)
        top.hideBanner()
        val err = saveError
        if (saving) {
            showProgress(KiloBundle.message("settings.autoApprove.save.pending"))
            return
        }
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
        val LOG = KiloLog.create(AutoApproveSettingsUi::class.java)
    }
}
