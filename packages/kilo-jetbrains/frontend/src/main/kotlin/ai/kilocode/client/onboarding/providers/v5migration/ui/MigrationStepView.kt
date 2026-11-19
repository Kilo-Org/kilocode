package ai.kilocode.client.onboarding.providers.v5migration.ui

import ai.kilocode.client.onboarding.OnboardingRunState
import ai.kilocode.client.onboarding.OnboardingStepView
import ai.kilocode.client.onboarding.providers.v5migration.MigrationItemUiProgress
import ai.kilocode.client.onboarding.providers.v5migration.MigrationSelectionBuilder
import ai.kilocode.client.onboarding.providers.v5migration.MigrationSettingsUiSelections
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiController
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiPhase
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiSelections
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiState
import ai.kilocode.client.onboarding.providers.v5migration.groupStatus
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.MigrationItemCategoryDto
import ai.kilocode.rpc.dto.MigrationItemStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import javax.swing.JComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Renders the v5 migration category rows + keep-legacy checkbox as an [OnboardingStepView].
 *
 * Reuses [MigrationItemRow] / [MigrationStatusIcon] unchanged and delegates the actual run to
 * [migration]; the dialog chrome (rail, header, footer buttons) comes from
 * [ai.kilocode.client.onboarding.ui.OnboardingDialog], not from this view.
 */
class MigrationStepView(private val migration: MigrationUiController) :
    BorderLayoutPanel(), OnboardingStepView, Disposable {

    // ModalityState.any(): this view is hosted inside a modal dialog, so plain Dispatchers.EDT
    // work would be queued behind the modal and never run until the dialog closes.
    private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

    private val cs = CoroutineScope(SupervisorJob() + edt)

    private val rows = mutableMapOf<MigrationItemCategoryDto, MigrationItemRow>()
    private val settingsRow = MigrationItemRow(KiloBundle.message("migration.row.settings"), MigrationItemCategoryDto.settings)
    private val providerRow = MigrationItemRow(KiloBundle.message("migration.row.providers"), MigrationItemCategoryDto.provider)
    private val mcpRow = MigrationItemRow(KiloBundle.message("migration.row.mcp"), MigrationItemCategoryDto.mcpServer)
    private val modesRow = MigrationItemRow(KiloBundle.message("migration.row.modes"), MigrationItemCategoryDto.customMode)
    private val sessionsRow = MigrationItemRow(KiloBundle.message("migration.row.sessions"), MigrationItemCategoryDto.session)
    private val modelRow = MigrationItemRow(KiloBundle.message("migration.row.model"), MigrationItemCategoryDto.defaultModel)

    private val keepBox = JBCheckBox(KiloBundle.message("migration.keep_legacy_settings"), true)

    private val emptyLabel = JBLabel(KiloBundle.message("migration.empty")).apply {
        foreground = UiStyle.Colors.weak()
    }

    private var detection: LegacyMigrationDetectionDto? = null

    private val _run = MutableStateFlow<OnboardingRunState>(OnboardingRunState.Idle)
    override val run: StateFlow<OnboardingRunState> = _run.asStateFlow()

    private val _ready = MutableStateFlow(false)
    override val ready: StateFlow<Boolean> = _ready.asStateFlow()

    override val component: JComponent get() = this

    init {
        isOpaque = false

        rows[MigrationItemCategoryDto.provider] = providerRow
        rows[MigrationItemCategoryDto.mcpServer] = mcpRow
        rows[MigrationItemCategoryDto.customMode] = modesRow
        rows[MigrationItemCategoryDto.session] = sessionsRow
        rows[MigrationItemCategoryDto.defaultModel] = modelRow
        rows[MigrationItemCategoryDto.settings] = settingsRow

        for (row in rows.values) row.onSelectionChanged = { _ -> syncReady() }

        addToCenter(
            Stack.vertical(gap = UiStyle.Gap.xs())
                .next(emptyLabel)
                .next(providerRow)
                .next(mcpRow)
                .next(modesRow)
                .next(sessionsRow)
                .next(modelRow)
                .next(settingsRow),
        )
        addToBottom(
            Stack.horizontal().next(keepBox).apply {
                border = JBUI.Borders.emptyTop(UiStyle.Gap.lg())
            },
        )

        // Seed synchronously so the very first paint already has row visibility, default
        // selections, and run/ready state applied. The collector below only carries later
        // transitions (progress, done, error).
        apply(migration.state.value)
        cs.launch { migration.state.collect { apply(it) } }
    }

    @RequiresEdt
    override fun start() {
        migration.start(currentSelections())
    }

    @RequiresEdt
    override fun done() {
        migration.finish()
    }

    override fun dispose() {
        cs.cancel()
    }

    @RequiresEdt
    private fun apply(state: MigrationUiState) {
        val needed = state as? MigrationUiState.Needed ?: return
        val det = needed.detection
        if (detection != det) {
            detection = det
            applyDefaults(det)
        }

        providerRow.isVisible = det.providers.any { it.supported }
        mcpRow.isVisible = det.mcpServers.isNotEmpty()
        modesRow.isVisible = det.customModes.isNotEmpty()
        sessionsRow.isVisible = det.sessions.isNotEmpty()
        modelRow.isVisible = det.defaultModel != null
        settingsRow.isVisible = det.settings != null
        emptyLabel.isVisible = !det.hasData
        keepBox.isVisible = needed.phase == MigrationUiPhase.selecting

        for (row in rows.values) row.updatePhase(needed.phase)

        updateRowProgress(MigrationItemCategoryDto.provider, needed.progress)
        updateRowProgress(MigrationItemCategoryDto.mcpServer, needed.progress)
        updateRowProgress(MigrationItemCategoryDto.customMode, needed.progress)
        updateRowProgress(MigrationItemCategoryDto.session, needed.progress)
        updateRowProgress(MigrationItemCategoryDto.defaultModel, needed.progress)
        updateRowProgress(MigrationItemCategoryDto.settings, needed.progress)

        syncReady()
        _run.value = when (needed.phase) {
            MigrationUiPhase.selecting -> OnboardingRunState.Idle
            MigrationUiPhase.migrating -> OnboardingRunState.Running
            MigrationUiPhase.done -> OnboardingRunState.Done
            MigrationUiPhase.error -> OnboardingRunState.Failed(
                needed.results.firstOrNull { it.status == MigrationItemStatusDto.error }?.message
                    ?: KiloBundle.message("onboarding.migration.failed"),
            )
        }
        revalidate()
        repaint()
    }

    private fun applyDefaults(det: LegacyMigrationDetectionDto) {
        val defaults = MigrationSelectionBuilder.defaults(det)
        providerRow.selected = defaults.providers.isNotEmpty()
        mcpRow.selected = defaults.mcpServers.isNotEmpty()
        modesRow.selected = defaults.customModes.isNotEmpty()
        sessionsRow.selected = defaults.sessions.isNotEmpty()
        modelRow.selected = defaults.defaultModel
        settingsRow.selected = defaults.settings.autoApproval.commandRules ||
            defaults.settings.autoApproval.readPermission ||
            defaults.settings.autoApproval.writePermission ||
            defaults.settings.autoApproval.executePermission ||
            defaults.settings.autoApproval.mcpPermission ||
            defaults.settings.autoApproval.taskPermission ||
            defaults.settings.language ||
            defaults.settings.autocomplete
        keepBox.isSelected = defaults.keepLegacySettingsFile
    }

    private fun syncReady() {
        _ready.value = rows.values.any { it.isVisible && it.selected }
    }

    private fun updateRowProgress(category: MigrationItemCategoryDto, items: List<MigrationItemUiProgress>) {
        val row = rows[category] ?: return
        val categoryItems = items.filter { it.category == category }
        if (categoryItems.isEmpty()) {
            row.updateProgress(null)
            return
        }
        val status = groupStatus(categoryItems)
        row.updateProgress(MigrationItemUiProgress(category.name, category, status))
    }

    private fun currentSelections(): MigrationUiSelections {
        val det = detection ?: return MigrationUiSelections(keepLegacySettingsFile = keepBox.isSelected)
        val providers = if (providerRow.selected) det.providers.filter { it.supported && it.hasApiKey }.map { it.profileName } else emptyList()
        val mcpServers = if (mcpRow.selected) det.mcpServers.map { it.name } else emptyList()
        val modes = if (modesRow.selected) det.customModes.map { it.slug } else emptyList()
        val sessions = if (sessionsRow.selected) det.sessions.map { it.id } else emptyList()
        val defaults = MigrationSelectionBuilder.defaults(det)
        return MigrationUiSelections(
            providers = providers,
            mcpServers = mcpServers,
            customModes = modes,
            sessions = sessions,
            defaultModel = modelRow.selected,
            settings = if (settingsRow.selected) defaults.settings else MigrationSettingsUiSelections(),
            keepLegacySettingsFile = keepBox.isSelected,
        )
    }
}
