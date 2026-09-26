package ai.kilocode.client.settings.sandbox

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.BaseSettingsUi
import ai.kilocode.client.settings.base.SettingsInlineListPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.settings.base.SettingsToolbarAction
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.SandboxNetworkDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.Messages
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import javax.swing.DefaultComboBoxModel
import javax.swing.ListSelectionModel

internal class SandboxSettingsUi(
    cs: CoroutineScope,
    private val app: KiloAppService = service(),
    workspaces: KiloWorkspaceService = service(),
) : BaseSettingsUi<SandboxSettingsContent, SandboxDraft, ConfigPatchDto, KiloAppStateDto, Unit>(
    cs,
    SandboxDraft(),
    app,
    workspaces,
    loginBanner = false,
) {
    init {
        startSettings(SandboxSettingsContent { updateDraft(it) })
    }

    override fun change(from: SandboxDraft, to: SandboxDraft): ConfigPatchDto? = patch(from, to)

    override fun save(change: ConfigPatchDto, done: (KiloAppStateDto?) -> Unit) {
        app.updateConfigAsync(change, done)
    }

    override fun base(result: KiloAppStateDto): SandboxDraft = sandboxDraft(result.config)

    override fun draft(state: KiloAppStateDto): SandboxDraft = sandboxDraft(state.config)

    override fun pendingText(): String = KiloBundle.message("settings.sandbox.save.pending")

    override fun failedText(): String = KiloBundle.message("settings.sandbox.save.failed")

    override suspend fun loadWorkspace(root: String) = Unit

    override fun applyWorkspace(result: Unit) = Unit

    override fun logSaveStarted(change: ConfigPatchDto) = LOG.info("sandbox settings save: started")

    override fun logSaveCompleted(change: ConfigPatchDto) = LOG.info("sandbox settings save: completed")

    override fun logSaveFailed(change: ConfigPatchDto) = LOG.warn("sandbox settings save: failed")

    override fun logSaveFailedAfterDispose(change: ConfigPatchDto) = LOG.warn("sandbox settings save: failed after dispose")

    override fun logSaveCompletedAfterDispose(change: ConfigPatchDto) = LOG.info("sandbox settings save: completed after dispose")

    @RequiresEdt
    override fun syncContent() {
        val ready = appState.status == KiloAppStatusDto.READY
        form.sync(draft, ready && !saving)
        top.hideBanner()
        val err = saveError
        if (saving) {
            showProgress(KiloBundle.message("settings.sandbox.save.pending"))
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
        val LOG = KiloLog.create(SandboxSettingsUi::class.java)
    }
}

internal class SandboxSettingsContent(
    private val update: (SandboxDraft.() -> SandboxDraft) -> Unit,
) : BaseContentPanel() {
    private var syncing = false
    private val enabled = SettingsToggle { value -> update { copy(enabled = value) } }
    private val network = ComboBox(DefaultComboBoxModel(SandboxNetworkDto.entries.toTypedArray())).apply {
        renderer = SimpleListCellRenderer.create("") { value -> networkLabel(value) }
        addActionListener {
            if (!syncing) (selectedItem as? SandboxNetworkDto)?.let { value -> update { copy(network = value) } }
        }
    }
    private val hosts = SandboxValueList(
        empty = KiloBundle.message("settings.sandbox.hosts.empty"),
        label = KiloBundle.message("settings.sandbox.hosts.add"),
        prompt = KiloBundle.message("settings.sandbox.hosts.prompt"),
        normalize = ::normalizeDestination,
        add = { value -> update { copy(hosts = (hosts + value).distinct()) } },
        remove = { values -> update { copy(hosts = hosts - values.toSet()) } },
    )
    private val paths = SandboxValueList(
        empty = KiloBundle.message("settings.sandbox.paths.empty"),
        label = KiloBundle.message("settings.sandbox.paths.add"),
        prompt = KiloBundle.message("settings.sandbox.paths.prompt"),
        normalize = ::normalizePath,
        add = { value -> update { copy(paths = (paths + value).distinct()) } },
        remove = { values -> update { copy(paths = paths - values.toSet()) } },
    )

    init {
        section(
            KiloBundle.message("settings.sandbox.policy.title"),
            KiloBundle.message("settings.sandbox.description"),
        ).apply {
            row(SettingsRow(
                KiloBundle.message("settings.sandbox.enabled.title"),
                KiloBundle.message("settings.sandbox.enabled.description"),
                enabled,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.sandbox.network.title"),
                KiloBundle.message("settings.sandbox.network.description"),
                network,
            ))
            row(SettingsStackedRow(
                KiloBundle.message("settings.sandbox.hosts.title"),
                KiloBundle.message("settings.sandbox.hosts.description"),
                hosts,
            ))
            row(SettingsStackedRow(
                KiloBundle.message("settings.sandbox.paths.title"),
                KiloBundle.message("settings.sandbox.paths.description"),
                paths,
            ))
        }
    }

    @RequiresEdt
    fun sync(draft: SandboxDraft, editable: Boolean) {
        syncing = true
        enabled.isSelected = exposed(draft)
        network.selectedItem = effectiveNetwork(draft)
        syncing = false
        enabled.isEnabled = editable
        network.isEnabled = editable
        hosts.sync(draft.hosts, editable && effectiveNetwork(draft) == SandboxNetworkDto.DENY)
        paths.sync(draft.paths, editable)
    }
}

internal fun networkLabel(value: SandboxNetworkDto?): String = when (value) {
    SandboxNetworkDto.ALLOW -> KiloBundle.message("settings.sandbox.network.allow")
    SandboxNetworkDto.DENY -> KiloBundle.message("settings.sandbox.network.deny")
    null -> ""
}

internal class SandboxValueList(
    private val empty: String,
    private val label: String,
    private val prompt: String,
    private val normalize: (String) -> String?,
    private val add: (String) -> Unit,
    private val remove: (List<String>) -> Unit,
) : SettingsInlineListPanel(
    empty,
    ActiveListConfig.Equal,
    ListSelectionModel.MULTIPLE_INTERVAL_SELECTION,
    showSearch = false,
) {
    private var values = emptySet<String>()

    internal var input: () -> String? = {
        Messages.showInputDialog(this, prompt, label, null)
    }

    init {
        start()
    }

    @RequiresEdt
    fun sync(items: List<String>, enabled: Boolean) {
        values = items.toSet()
        setItems(items.map(::ValueItem), enabled)
    }

    override fun onCell(key: String, cellId: String) = Unit

    override fun toolbarActions(): List<AnAction> = listOf(
        SettingsToolbarAction(
            KiloBundle.message("settings.sandbox.add"),
            label,
            AllIcons.General.Add,
            { isEnabled },
        ) { promptAdd() },
        SettingsToolbarAction(
            KiloBundle.message("settings.sandbox.remove.action"),
            KiloBundle.message("settings.sandbox.remove"),
            AllIcons.General.Remove,
            { isEnabled && selectedKeys().isNotEmpty() },
        ) { removeSelected() },
    )

    private fun promptAdd() {
        val value = input()?.let(normalize) ?: return
        if (value in values) {
            selectKey(value)
            return
        }
        add(value)
    }

    private fun removeSelected() {
        val selected = selectedKeys()
        if (selected.isNotEmpty()) remove(selected)
    }

    private data class ValueItem(override val key: String) : ActiveListItem {
        override val title: String get() = key
    }
}
